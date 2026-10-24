#!/usr/bin/env python3
"""Verify the v0.9 clean-recovery fixtures without writing to the repository."""

from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path


DEFAULT_ROOT = Path(__file__).resolve().parents[2]
RECORD_FILES = {
    1: Path("sequencer/batch-1-record.txt"),
    # run_sequencer.py writes this stable filename for every invocation.
    2: Path("sequencer/batch-exec-record.txt"),
}
RECORD_KEYS = ("PREVSTATE", "TXROOT", "STATE", "TRANSITION", "BATCH")


class VerificationError(Exception):
    """An input or commitment did not match the existing prototype rules."""


def read_bytes(root: Path, relative_path: Path) -> bytes:
    path = root / relative_path
    try:
        return path.read_bytes()
    except OSError as exc:
        raise VerificationError(f"cannot read {relative_path}: {exc}") from exc


def read_text(root: Path, relative_path: Path) -> str:
    try:
        return read_bytes(root, relative_path).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise VerificationError(f"cannot decode {relative_path} as UTF-8: {exc}") from exc


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def parse_transactions(text: str, source: Path) -> list[tuple[str, str, int, int]]:
    """Parse the v0.7 fixture field order used by the existing executor."""
    lines = text.splitlines()
    if not lines or any(not line or line != line.strip() for line in lines):
        raise VerificationError(f"{source}: expected non-empty, trimmed transaction lines")

    transactions = []
    previous_id = None
    expected_keys = ("id", "from", "to", "amount", "nonce")

    for line_number, line in enumerate(lines, 1):
        parts = line.split("|")
        if len(parts) != 7 or parts[:2] != ["BTCSL2TX", "v0.7"]:
            raise VerificationError(
                f"{source}:{line_number}: expected BTCSL2TX|v0.7 transaction format"
            )

        values = {}
        for part, expected_key in zip(parts[2:], expected_keys):
            key, separator, value = part.partition("=")
            if not separator or key != expected_key or not value:
                raise VerificationError(
                    f"{source}:{line_number}: expected {expected_key}=... in v0.7 field order"
                )
            values[key] = value

        try:
            transaction_id = int(values["id"])
            amount = int(values["amount"])
        except ValueError as exc:
            raise VerificationError(
                f"{source}:{line_number}: id and amount must be integers"
            ) from exc

        if previous_id is not None and transaction_id < previous_id:
            raise VerificationError(f"{source}: transactions are not in sequencer id order")
        previous_id = transaction_id
        transactions.append((values["from"], values["to"], amount, transaction_id))

    return transactions


def load_state(text: str, source: Path) -> dict[str, int]:
    state = {}
    for line_number, line in enumerate(text.splitlines(), 1):
        name, separator, balance_text = line.strip().partition("=")
        if not separator or not name:
            raise VerificationError(f"{source}:{line_number}: expected account=balance")
        try:
            state[name] = int(balance_text)
        except ValueError as exc:
            raise VerificationError(f"{source}:{line_number}: balance must be an integer") from exc
    if not state:
        raise VerificationError(f"{source}: state must contain at least one account")
    return state


def canonical_state_bytes(state: dict[str, int]) -> bytes:
    return "".join(f"{name}={state[name]}\n" for name in sorted(state)).encode("utf-8")


def apply_batch(
    state: dict[str, int],
    transaction_text: str,
    source: Path,
) -> tuple[dict[str, int], str]:
    transactions = parse_transactions(transaction_text, source)
    transaction_hashes = []

    for sender, receiver, amount, _transaction_id in transactions:
        if amount <= 0:
            raise VerificationError(f"{source}: transaction amount must be positive")
        if sender not in state or receiver not in state:
            raise VerificationError(f"{source}: transaction references an unknown account")
        if state[sender] < amount:
            raise VerificationError(f"{source}: transaction has insufficient sender balance")

        state[sender] -= amount
        state[receiver] += amount

    # run_sequencer.py writes each ordered transaction as line + one LF byte.
    for line in transaction_text.splitlines():
        transaction_hashes.append(sha256((line + "\n").encode("utf-8")))
    txroot = sha256(b"".join(transaction_hashes)).hex()
    return state, txroot


def parse_record(text: str, source: Path) -> dict[str, str]:
    record = {}
    for line_number, line in enumerate(text.splitlines(), 1):
        if not line or "=" not in line:
            raise VerificationError(f"{source}:{line_number}: expected KEY=VALUE")
        key, value = line.split("=", 1)
        if key in record:
            raise VerificationError(f"{source}:{line_number}: duplicate key {key}")
        record[key] = value
    if set(record) != set(RECORD_KEYS):
        missing = sorted(set(RECORD_KEYS) - set(record))
        extra = sorted(set(record) - set(RECORD_KEYS))
        raise VerificationError(f"{source}: record keys differ (missing={missing}, extra={extra})")
    return record


def derive_commitments(
    batch_number: int,
    previous_state_root: str,
    txroot: str,
    state_root: str,
) -> dict[str, str]:
    transition = sha256(bytes.fromhex(previous_state_root) + bytes.fromhex(txroot)).hex()
    canonical = (
        f"BTCSL2BATCH|v0.6|batch={batch_number}|"
        f"prev={previous_state_root}|txroot={txroot}|state={state_root}|"
        f"transition={transition}"
    )
    batch_hash = sha256(canonical.encode("utf-8")).hex()
    return {
        "PREVSTATE": previous_state_root,
        "TXROOT": txroot,
        "STATE": state_root,
        "TRANSITION": transition,
        "BATCH": batch_hash,
    }


def verify_record(batch_number: int, expected: dict[str, str], record: dict[str, str]) -> None:
    failures = []
    for key in RECORD_KEYS:
        if record[key] == expected[key]:
            print(f"BATCH {batch_number} {key}: PASS {expected[key]}")
        else:
            print(
                f"BATCH {batch_number} {key}: FAIL "
                f"expected={expected[key]} actual={record[key]}"
            )
            failures.append(key)
    if failures:
        raise VerificationError(
            f"batch {batch_number} commitment mismatch in {', '.join(failures)}"
        )


def parse_publication(text: str, source: Path) -> list[str]:
    # The existing fixture is one line: its data separator is the first |data=,
    # and transaction boundaries are represented by the two literal characters \ and n.
    line = text[:-1] if text.endswith("\n") else text
    if "\n" in line or "\r" in line:
        raise VerificationError(f"{source}: expected one physical publication line")
    header, separator, body = line.partition("|data=")
    if not separator or header != "BTCSL2|v0.9|chain=regtest-l2|batch=2":
        raise VerificationError(f"{source}: publication header does not match the v0.9 fixture")
    transactions = body.split("\\n")
    if not body or any(not transaction for transaction in transactions):
        raise VerificationError(f"{source}: publication data is empty or malformed")
    return transactions


def parse_v08_payload(text: str, source: Path) -> dict[str, str]:
    line = text[:-1] if text.endswith("\n") else text
    parts = line.split("|")
    if len(parts) != 9 or parts[:2] != ["BTCSL2", "v0.8"]:
        raise VerificationError(f"{source}: expected the existing v0.8 commitment payload")
    expected_keys = ("chain", "batch", "prev", "txroot", "state", "transition", "batch")
    values = []
    for part, expected_key in zip(parts[2:], expected_keys):
        key, separator, value = part.partition("=")
        if not separator or key != expected_key or not value:
            raise VerificationError(f"{source}: malformed or out-of-order payload field")
        values.append(value)
    fields = {
        "chain": values[0],
        "batch_number": values[1],
        "prev": values[2],
        "txroot": values[3],
        "state": values[4],
        "transition": values[5],
        # The fixture uses the key "batch" both for the number and the batch hash.
        "batch_hash": values[6],
    }
    if fields["chain"] != "regtest-l2" or fields["batch_number"] != "2":
        raise VerificationError(f"{source}: unexpected chain or batch number")
    return fields


def verify_v08_payload(root: Path, expected: dict[str, str]) -> None:
    source = Path("settlement/v08/batch-2-payload.txt")
    fields = parse_v08_payload(read_text(root, source), source)
    mapping = {
        "prev": "PREVSTATE",
        "txroot": "TXROOT",
        "state": "STATE",
        "transition": "TRANSITION",
        "batch_hash": "BATCH",
    }
    failures = []
    for payload_key, commitment_key in mapping.items():
        actual = fields.get(payload_key)
        if actual == expected[commitment_key]:
            print(f"V0.8 PAYLOAD {payload_key}: PASS {actual}")
        else:
            print(
                f"V0.8 PAYLOAD {payload_key}: FAIL "
                f"expected={expected[commitment_key]} actual={actual}"
            )
            failures.append(payload_key)
    if failures:
        raise VerificationError(f"v0.8 payload mismatch in {', '.join(failures)}")


def verify_recovery(root: Path, requested_batch: int) -> None:
    genesis_path = Path("settlement/v09/clean-recovery/genesis-state.txt")
    batch1_path = Path("settlement/v09/clean-recovery/batch-1-data.txt")
    clean_batch2_path = Path("settlement/v09/clean-recovery/batch-2-data.txt")
    published_batch2_path = Path("settlement/v09/batch-2-data.txt")
    publication_path = Path("settlement/v09/batch-2-publication.txt")

    genesis_bytes = read_bytes(root, genesis_path)
    try:
        genesis_text = genesis_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise VerificationError(f"cannot decode {genesis_path} as UTF-8: {exc}") from exc
    batch1_text = read_text(root, batch1_path)
    clean_batch2_text = read_text(root, clean_batch2_path)
    published_batch2_text = read_text(root, published_batch2_path)
    publication_transactions = parse_publication(read_text(root, publication_path), publication_path)

    batch2_clean_lines = clean_batch2_text.splitlines()
    batch2_published_lines = published_batch2_text.splitlines()
    if publication_transactions != batch2_clean_lines:
        raise VerificationError(f"{publication_path}: data differs from {clean_batch2_path}")
    if publication_transactions != batch2_published_lines:
        raise VerificationError(f"{publication_path}: data differs from {published_batch2_path}")
    print("V0.9 PUBLICATION DATA: PASS matches both batch 2 recovery fixtures")

    state = load_state(genesis_text, genesis_path)
    previous_state_root = sha256(genesis_bytes).hex()

    batches = {1: (batch1_text, batch1_path), 2: ("\n".join(publication_transactions), publication_path)}
    for batch_number in range(1, requested_batch + 1):
        transaction_text, transaction_source = batches[batch_number]
        state, txroot = apply_batch(state, transaction_text, transaction_source)
        state_bytes = canonical_state_bytes(state)
        state_root = sha256(state_bytes).hex()
        expected = derive_commitments(batch_number, previous_state_root, txroot, state_root)

        record_path = RECORD_FILES[batch_number]
        record = parse_record(read_text(root, record_path), record_path)
        verify_record(batch_number, expected, record)

        if batch_number == 2:
            verify_v08_payload(root, expected)

        previous_state_root = state_root

    print(
        f"CLEAN RECOVERY PASS: replayed batches 1..{requested_batch} from genesis; "
        f"explicit batch number={requested_batch}"
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Replay v0.7 batches from the v0.9 clean-recovery fixtures and verify commitments."
    )
    parser.add_argument(
        "--batch-number",
        type=int,
        choices=(1, 2),
        required=True,
        help="explicit replay horizon and batch number used in the commitment hash",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=DEFAULT_ROOT,
        help="project root containing the existing fixtures (defaults to this repository)",
    )
    args = parser.parse_args()

    try:
        verify_recovery(args.root.resolve(), args.batch_number)
    except (VerificationError, ValueError) as exc:
        print(f"VERIFICATION FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
