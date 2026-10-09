"""Byte-exact v0.9 batch construction and verification.

This module is deliberately separate from the historical execution and
recovery verifiers. Its profiles are trusted local configuration; activation
is never selected from an envelope. Use ``verify_profile_history`` as the
standalone verifier: the single-batch API only verifies a profile's activation
batch, and its private step helper is reserved for consecutive history replay.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Mapping


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PROFILE_FILE = Path(__file__).with_name("profiles.json")
PROTOTYPE_CHAIN_ID = "regtest-l2"

U64_MAX = (1 << 64) - 1
U256_MAX = (1 << 256) - 1
MAX_CHAIN_ID_BYTES = 64
MAX_ACCOUNT_BYTES = 64
MAX_ACCOUNTS = 4096
MAX_STATE_BYTES = 1_048_576
MAX_TRANSACTIONS = 2048
MAX_TX_RECORD_BYTES = 512  # Includes the record's final LF.
MAX_DATA_BYTES = 1_048_576
MAX_DATA_HEX_CHARS = 2_097_152
# 484 bytes of fixed envelope overhead at the maximum chain/batch widths,
# plus two hex characters for each maximum decoded data byte.
MAX_ENVELOPE_BYTES = 2_097_636

_UINT_RE = re.compile(rb"(?:0|[1-9][0-9]*)\Z")
_HASH_RE = re.compile(rb"[0-9a-f]{64}\Z")
_ACCOUNT_RE = re.compile(rb"[a-z][a-z0-9_]{0,63}\Z")
_CHAIN_RE = re.compile(rb"[a-z0-9][a-z0-9-]{0,63}\Z")
_TX_KEYS = (b"id", b"from", b"to", b"amount", b"nonce")
_RECORD_KEYS = ("PREVSTATE", "TXROOT", "STATE", "TRANSITION", "BATCH")
_ENVELOPE_KEYS = (
    "chain",
    "batch",
    "prev",
    "txroot",
    "state",
    "transition",
    "batch_hash",
    "data_hex",
)


class ProtocolError(ValueError):
    """A profile, batch, or commitment violates the v0.9 rules."""


@dataclass(frozen=True)
class Profile:
    name: str
    chain_id: str
    activation_batch: int
    parent_batch_number: int
    parent_batch_hash: str | None
    parent_state_hash: str
    state_file: str
    legacy_record_file: str | None = None
    legacy_payload_file: str | None = None


@dataclass(frozen=True)
class Transaction:
    transaction_id: int
    sender: str
    receiver: str
    amount: int
    nonce: int
    line: bytes


@dataclass(frozen=True)
class BatchResult:
    envelope: bytes
    state: dict[str, int]
    batch_number: int
    fields: dict[str, str]


def sha256(data: bytes) -> bytes:
    return hashlib.sha256(data).digest()


def sha256_hex(data: bytes) -> str:
    return sha256(data).hex()


def _parse_uint(
    raw: bytes,
    *,
    maximum: int,
    field: str,
    minimum: int = 0,
) -> int:
    if not _UINT_RE.fullmatch(raw):
        raise ProtocolError(f"{field} is not a canonical unsigned decimal integer")
    maximum_raw = str(maximum).encode("ascii")
    if len(raw) > len(maximum_raw) or (
        len(raw) == len(maximum_raw) and raw > maximum_raw
    ):
        raise ProtocolError(f"{field} is outside the permitted range")
    value = int(raw)
    if value < minimum or value > maximum:
        raise ProtocolError(f"{field} is outside the permitted range")
    return value


def _check_hash(raw: bytes, field: str) -> str:
    if not _HASH_RE.fullmatch(raw):
        raise ProtocolError(f"{field} must be 64 lowercase hexadecimal characters")
    return raw.decode("ascii")


def _check_hash_text(value: str, field: str) -> str:
    try:
        raw = value.encode("ascii")
    except UnicodeEncodeError as exc:
        raise ProtocolError(f"{field} must be ASCII lowercase hexadecimal") from exc
    return _check_hash(raw, field)


def _check_chain_id(raw: bytes) -> str:
    if len(raw) > MAX_CHAIN_ID_BYTES or not _CHAIN_RE.fullmatch(raw):
        raise ProtocolError("chain_id does not match the v0.9 ASCII grammar or length limit")
    value = raw.decode("ascii")
    if value != PROTOTYPE_CHAIN_ID:
        raise ProtocolError(f"chain_id must be {PROTOTYPE_CHAIN_ID!r} for this prototype")
    return value


def _check_account(raw: bytes, field: str = "account") -> str:
    if len(raw) > MAX_ACCOUNT_BYTES or not _ACCOUNT_RE.fullmatch(raw):
        raise ProtocolError(f"{field} does not match the v0.9 account grammar or length limit")
    return raw.decode("ascii")


def _profile_path(root: Path, relative_path: str) -> Path:
    relative = Path(relative_path)
    if relative.is_absolute():
        raise ProtocolError("profile file paths must be relative to the project root")
    base = root.resolve()
    path = (base / relative).resolve()
    try:
        path.relative_to(base)
    except ValueError as exc:
        raise ProtocolError("profile file path escapes the project root") from exc
    return path


def available_profiles() -> tuple[str, ...]:
    try:
        config = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProtocolError(f"cannot read v0.9 profile configuration: {exc}") from exc
    profiles = config.get("profiles") if isinstance(config, dict) else None
    if not isinstance(profiles, dict):
        raise ProtocolError("v0.9 profile configuration must contain a profiles object")
    return tuple(profiles)


def _read_legacy_record(path: Path) -> dict[str, str]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ProtocolError(f"cannot read migration parent record: {exc}") from exc
    if not raw.isascii() or b"\r" in raw:
        raise ProtocolError("migration parent record must be ASCII with LF line endings")
    lines = raw.split(b"\n")
    if lines[-1] == b"":
        lines.pop()
    if not lines or any(not line for line in lines):
        raise ProtocolError("migration parent record contains an empty line")
    record: dict[str, str] = {}
    ordered_keys: list[str] = []
    for line in lines:
        if line.count(b"=") != 1:
            raise ProtocolError("migration parent record has a malformed key=value line")
        key_raw, value_raw = line.split(b"=", 1)
        key = key_raw.decode("ascii")
        if not value_raw or key in record:
            raise ProtocolError("migration parent record has an empty value or duplicate key")
        record[key] = value_raw.decode("ascii")
        ordered_keys.append(key)
    if tuple(ordered_keys) != _RECORD_KEYS:
        raise ProtocolError("migration parent record keys are missing or out of order")
    return record


def _read_legacy_v08_payload(path: Path) -> dict[str, str]:
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise ProtocolError(f"cannot read migration parent payload: {exc}") from exc
    if raw.endswith(b"\n"):
        raw = raw[:-1]
    if not raw or b"\n" in raw or b"\r" in raw or not raw.isascii():
        raise ProtocolError("migration v0.8 payload must be one ASCII record")
    parts = raw.split(b"|")
    expected = (
        b"chain",
        b"batch",
        b"prev",
        b"txroot",
        b"state",
        b"transition",
        b"batch",
    )
    if len(parts) != 9 or parts[:2] != [b"BTCSL2", b"v0.8"]:
        raise ProtocolError("migration parent payload is not the expected v0.8 record")
    values: list[str] = []
    for part, expected_key in zip(parts[2:], expected):
        if part.count(b"=") != 1:
            raise ProtocolError("migration parent payload has a malformed field")
        key, value = part.split(b"=", 1)
        if key != expected_key or not value:
            raise ProtocolError("migration parent payload fields are missing or out of order")
        values.append(value.decode("ascii"))
    return {
        "chain": values[0],
        "batch_number": values[1],
        "prev": values[2],
        "txroot": values[3],
        "state": values[4],
        "transition": values[5],
        "batch_hash": values[6],
    }


def _verify_migration_anchor(profile: Profile, root: Path) -> None:
    if profile.parent_batch_hash is None:
        raise ProtocolError("migration profile is missing its parent batch hash")
    if profile.legacy_record_file is None or profile.legacy_payload_file is None:
        raise ProtocolError("migration profile is missing its legacy record or payload path")

    record = _read_legacy_record(_profile_path(root, profile.legacy_record_file))
    for key in ("PREVSTATE", "TXROOT", "STATE", "TRANSITION", "BATCH"):
        _check_hash(record[key].encode("ascii"), key)

    if record["STATE"] != profile.parent_state_hash:
        raise ProtocolError("migration parent record state does not match the configured anchor")
    if record["BATCH"] != profile.parent_batch_hash:
        raise ProtocolError("migration parent record hash does not match the configured anchor")

    previous = bytes.fromhex(record["PREVSTATE"])
    txroot = bytes.fromhex(record["TXROOT"])
    expected_transition = sha256(previous + txroot).hex()
    if record["TRANSITION"] != expected_transition:
        raise ProtocolError("migration parent transition does not match the legacy rule")

    legacy_preimage = (
        f"BTCSL2BATCH|v0.6|batch={profile.parent_batch_number}|"
        f"prev={record['PREVSTATE']}|txroot={record['TXROOT']}|"
        f"state={record['STATE']}|transition={record['TRANSITION']}"
    ).encode("ascii")
    if sha256_hex(legacy_preimage) != profile.parent_batch_hash:
        raise ProtocolError("migration parent does not match the no-final-LF sequencer rule")

    payload = _read_legacy_v08_payload(_profile_path(root, profile.legacy_payload_file))
    expected_payload = {
        "chain": profile.chain_id,
        "batch_number": str(profile.parent_batch_number),
        "prev": record["PREVSTATE"],
        "txroot": record["TXROOT"],
        "state": record["STATE"],
        "transition": record["TRANSITION"],
        "batch_hash": record["BATCH"],
    }
    if payload != expected_payload:
        raise ProtocolError("v0.8 parent payload does not match the pinned migration record")


def load_profile(
    name: str,
    *,
    root: Path = PROJECT_ROOT,
) -> tuple[Profile, dict[str, int]]:
    try:
        config = json.loads(PROFILE_FILE.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ProtocolError(f"cannot read v0.9 profile configuration: {exc}") from exc
    if not isinstance(config, dict) or not isinstance(config.get("profiles"), dict):
        raise ProtocolError("v0.9 profile configuration must contain a profiles object")
    entry = config["profiles"].get(name)
    if not isinstance(entry, dict):
        raise ProtocolError(f"unknown v0.9 profile {name!r}")

    try:
        chain_id_raw = entry["chain_id"].encode("ascii")
        chain_id = _check_chain_id(chain_id_raw)
        activation = entry["activation_batch"]
        parent_number = entry["parent_batch_number"]
        state_file = entry["state_file"]
        parent_hash_value = entry["parent_batch_hash"]
        parent_state_value = entry["parent_state_hash"]
    except (KeyError, AttributeError, UnicodeError) as exc:
        raise ProtocolError(f"profile {name!r} is missing or has invalid fields") from exc

    if (
        not isinstance(activation, int)
        or isinstance(activation, bool)
        or not 1 <= activation <= U64_MAX
        or not isinstance(parent_number, int)
        or isinstance(parent_number, bool)
        or not 0 <= parent_number <= U64_MAX
        or activation != parent_number + 1
    ):
        raise ProtocolError("profile activation must be the batch immediately after its parent")
    if not isinstance(state_file, str) or not state_file:
        raise ProtocolError("profile state_file must be a non-empty relative path")
    if not isinstance(parent_state_value, str):
        raise ProtocolError("profile parent_state_hash must be a lowercase hash")
    parent_state_hash = _check_hash_text(parent_state_value, "parent_state_hash")
    if parent_hash_value is None:
        parent_batch_hash = None
    elif isinstance(parent_hash_value, str):
        parent_batch_hash = _check_hash_text(parent_hash_value, "parent_batch_hash")
    else:
        raise ProtocolError("profile parent_batch_hash must be a lowercase hash or null")

    legacy_record_file = entry.get("legacy_record_file")
    legacy_payload_file = entry.get("legacy_payload_file")
    if name == "clean-genesis":
        if activation != 1 or parent_number != 0 or parent_batch_hash is not None:
            raise ProtocolError("clean-genesis profile must activate at batch 1 from genesis")
        if legacy_record_file is not None or legacy_payload_file is not None:
            raise ProtocolError("clean-genesis profile must not specify legacy parent files")
    elif name == "existing-history-migration":
        if parent_batch_hash is None or not isinstance(legacy_record_file, str) or not isinstance(
            legacy_payload_file, str
        ):
            raise ProtocolError("migration profile requires pinned legacy parent files and hash")
    else:
        raise ProtocolError("only the configured prototype profiles are supported")

    profile = Profile(
        name=name,
        chain_id=chain_id,
        activation_batch=activation,
        parent_batch_number=parent_number,
        parent_batch_hash=parent_batch_hash,
        parent_state_hash=parent_state_hash,
        state_file=state_file,
        legacy_record_file=legacy_record_file,
        legacy_payload_file=legacy_payload_file,
    )

    state_bytes = _profile_path(root, profile.state_file).read_bytes()
    state = parse_state(state_bytes)
    if canonical_state_bytes(state) != state_bytes:
        raise ProtocolError("profile state file is not byte-canonical")
    if sha256_hex(state_bytes) != profile.parent_state_hash:
        raise ProtocolError("profile state file does not match its pinned parent state hash")
    if profile.name == "existing-history-migration":
        _verify_migration_anchor(profile, root)
    return profile, state


def parse_state(state_bytes: bytes) -> dict[str, int]:
    if not isinstance(state_bytes, bytes):
        raise ProtocolError("state must be bytes")
    if not state_bytes or len(state_bytes) > MAX_STATE_BYTES:
        raise ProtocolError("state is empty or exceeds the 1 MiB limit")
    if not state_bytes.isascii() or b"\r" in state_bytes or not state_bytes.endswith(b"\n"):
        raise ProtocolError("state must be ASCII, LF-terminated, and contain no CR")
    raw_lines = state_bytes.split(b"\n")
    if raw_lines[-1] != b"":
        raise ProtocolError("state must end in exactly one LF")
    lines = raw_lines[:-1]
    if not lines or any(not line for line in lines):
        raise ProtocolError("state contains an empty line")
    if len(lines) > MAX_ACCOUNTS:
        raise ProtocolError("state exceeds the 4096-account limit")

    state: dict[str, int] = {}
    previous_account: bytes | None = None
    for line in lines:
        if line.count(b"=") != 1:
            raise ProtocolError("state line must contain exactly one equals sign")
        account_raw, balance_raw = line.split(b"=", 1)
        account = _check_account(account_raw, "state account")
        if previous_account is not None and account_raw <= previous_account:
            raise ProtocolError("state accounts must be unique and strictly sorted")
        balance = _parse_uint(balance_raw, maximum=U256_MAX, field="state balance")
        state[account] = balance
        previous_account = account_raw
    return state


def canonical_state_bytes(state: Mapping[str, int]) -> bytes:
    if not isinstance(state, Mapping) or not state:
        raise ProtocolError("state must contain at least one account")
    if len(state) > MAX_ACCOUNTS:
        raise ProtocolError("state exceeds the 4096-account limit")
    encoded_accounts: list[tuple[bytes, str]] = []
    for account in state:
        if not isinstance(account, str):
            raise ProtocolError("state account keys must be ASCII strings")
        try:
            account_raw = account.encode("ascii")
        except UnicodeEncodeError as exc:
            raise ProtocolError("state account keys must be ASCII strings") from exc
        _check_account(account_raw, "state account")
        encoded_accounts.append((account_raw, account))

    lines: list[bytes] = []
    for account_raw, account in sorted(encoded_accounts):
        balance = state[account]
        if not isinstance(balance, int) or isinstance(balance, bool) or not 0 <= balance <= U256_MAX:
            raise ProtocolError("state balance is outside the uint256 range")
        lines.append(account_raw + b"=" + str(balance).encode("ascii") + b"\n")
    result = b"".join(lines)
    if len(result) > MAX_STATE_BYTES:
        raise ProtocolError("state exceeds the 1 MiB limit")
    return result


def parse_transaction_data(
    data: bytes,
    *,
    require_sorted: bool = True,
) -> list[Transaction]:
    if not isinstance(data, bytes):
        raise ProtocolError("transaction data must be bytes")
    if not data or len(data) > MAX_DATA_BYTES:
        raise ProtocolError("transaction data is empty or exceeds the 1 MiB limit")
    if not data.isascii() or b"\r" in data or not data.endswith(b"\n"):
        raise ProtocolError("transaction data must be ASCII, LF-terminated, and contain no CR")
    raw_lines = data.split(b"\n")
    if raw_lines[-1] != b"":
        raise ProtocolError("transaction data must end in LF")
    lines = raw_lines[:-1]
    if not lines or any(not line for line in lines):
        raise ProtocolError("transaction data contains an empty record")
    if len(lines) > MAX_TRANSACTIONS:
        raise ProtocolError("batch exceeds the 2048-transaction limit")

    transactions: list[Transaction] = []
    seen_ids: set[int] = set()
    previous_id: int | None = None
    for line_number, line in enumerate(lines, 1):
        if len(line) + 1 > MAX_TX_RECORD_BYTES:
            raise ProtocolError(f"transaction record {line_number} exceeds 512 bytes including LF")
        parts = line.split(b"|")
        if len(parts) != 7 or parts[:2] != [b"BTCSL2TX", b"v0.7"]:
            raise ProtocolError(f"transaction record {line_number} has an invalid prefix or field count")
        values: dict[bytes, bytes] = {}
        for part, expected_key in zip(parts[2:], _TX_KEYS):
            if part.count(b"=") != 1:
                raise ProtocolError(f"transaction record {line_number} has a malformed field")
            key, value = part.split(b"=", 1)
            if key != expected_key or not value:
                raise ProtocolError(f"transaction record {line_number} has missing or reordered fields")
            values[key] = value

        transaction_id = _parse_uint(values[b"id"], maximum=U64_MAX, field="transaction id")
        sender = _check_account(values[b"from"], "sender")
        receiver = _check_account(values[b"to"], "receiver")
        amount = _parse_uint(
            values[b"amount"],
            maximum=U256_MAX,
            minimum=1,
            field="amount",
        )
        nonce = _parse_uint(values[b"nonce"], maximum=U64_MAX, field="nonce")

        if transaction_id in seen_ids:
            raise ProtocolError("transaction IDs must be unique within a batch")
        if require_sorted and previous_id is not None and transaction_id <= previous_id:
            raise ProtocolError("transaction IDs must be strictly increasing in serialized order")
        seen_ids.add(transaction_id)
        previous_id = transaction_id
        transactions.append(
            Transaction(transaction_id, sender, receiver, amount, nonce, line)
        )
    return transactions


def _execute_transactions(
    state: Mapping[str, int],
    transactions: Iterable[Transaction],
) -> dict[str, int]:
    updated = dict(state)
    for transaction in transactions:
        if transaction.sender not in updated or transaction.receiver not in updated:
            raise ProtocolError("transaction references an unknown account")
        if updated[transaction.sender] < transaction.amount:
            raise ProtocolError("transaction has insufficient sender balance")
        updated[transaction.sender] -= transaction.amount
        updated[transaction.receiver] += transaction.amount
        if updated[transaction.receiver] > U256_MAX:
            raise ProtocolError("resulting balance exceeds the uint256 limit")
    canonical_state_bytes(updated)
    return updated


def _transaction_root(transactions: Iterable[Transaction]) -> str:
    transaction_hashes = [
        sha256(transaction.line + b"\n")
        for transaction in transactions
    ]
    if not transaction_hashes:
        raise ProtocolError("empty batches are invalid")
    return sha256_hex(b"".join(transaction_hashes))


def _batch_hash_preimage(
    chain_id: str,
    batch_number: int,
    previous_state_hash: str,
    txroot: str,
    state_hash: str,
    transition_hash: str,
) -> bytes:
    return (
        f"BTCSL2BATCH|v0.9|chain={chain_id}|batch={batch_number}|"
        f"prev={previous_state_hash}|txroot={txroot}|state={state_hash}|"
        f"transition={transition_hash}"
    ).encode("ascii")


def build_ordered_batch(
    transaction_data: bytes,
    state: Mapping[str, int],
    profile: Profile,
    batch_number: int,
) -> BatchResult:
    if not isinstance(batch_number, int) or isinstance(batch_number, bool):
        raise ProtocolError("batch number must be an integer")
    if not profile.activation_batch <= batch_number <= U64_MAX:
        raise ProtocolError("batch number is outside this profile's active uint64 range")
    if profile.chain_id != PROTOTYPE_CHAIN_ID:
        raise ProtocolError("profile chain ID does not match the prototype chain")
    initial_state_bytes = canonical_state_bytes(state)
    if batch_number == profile.activation_batch:
        if sha256_hex(initial_state_bytes) != profile.parent_state_hash:
            raise ProtocolError("activation batch state does not match the configured parent")

    transactions = parse_transaction_data(transaction_data, require_sorted=False)
    ordered = sorted(transactions, key=lambda transaction: transaction.transaction_id)
    ordered_data = b"".join(transaction.line + b"\n" for transaction in ordered)
    if len(ordered_data) > MAX_DATA_BYTES:
        raise ProtocolError("ordered transaction data exceeds the 1 MiB limit")
    ordered = parse_transaction_data(ordered_data, require_sorted=True)

    previous_state_hash = sha256_hex(initial_state_bytes)
    txroot = _transaction_root(ordered)
    updated_state = _execute_transactions(state, ordered)
    state_hash = sha256_hex(canonical_state_bytes(updated_state))
    transition_hash = sha256(
        bytes.fromhex(previous_state_hash) + bytes.fromhex(txroot)
    ).hex()
    preimage = _batch_hash_preimage(
        profile.chain_id,
        batch_number,
        previous_state_hash,
        txroot,
        state_hash,
        transition_hash,
    )
    batch_hash = sha256_hex(preimage)
    data_hex = ordered_data.hex()
    fields = {
        "chain": profile.chain_id,
        "batch": str(batch_number),
        "prev": previous_state_hash,
        "txroot": txroot,
        "state": state_hash,
        "transition": transition_hash,
        "batch_hash": batch_hash,
        "data_hex": data_hex,
    }
    envelope = (
        f"BTCSL2|v0.9|chain={fields['chain']}|batch={fields['batch']}|"
        f"prev={fields['prev']}|txroot={fields['txroot']}|state={fields['state']}|"
        f"transition={fields['transition']}|batch_hash={fields['batch_hash']}|"
        f"data_hex={fields['data_hex']}"
    ).encode("ascii")
    if len(envelope) > MAX_ENVELOPE_BYTES:
        raise ProtocolError("envelope exceeds the configured byte limit")
    return BatchResult(envelope, updated_state, batch_number, fields)


def _parse_envelope(envelope: bytes, profile: Profile) -> tuple[dict[str, str], bytes]:
    if not isinstance(envelope, bytes) or not envelope:
        raise ProtocolError("envelope must be non-empty bytes")
    if len(envelope) > MAX_ENVELOPE_BYTES:
        raise ProtocolError("envelope exceeds the configured byte limit")
    if b"\r" in envelope or b"\n" in envelope:
        raise ProtocolError("envelope must be one ASCII record with no CR or LF")
    if not envelope.isascii():
        raise ProtocolError("envelope must be ASCII")
    parts = envelope.split(b"|")
    if len(parts) != 10 or parts[:2] != [b"BTCSL2", b"v0.9"]:
        raise ProtocolError("envelope has an invalid prefix, version, or field count")

    fields: dict[str, str] = {}
    values: dict[str, bytes] = {}
    for part, expected_key in zip(parts[2:], _ENVELOPE_KEYS):
        if part.count(b"=") != 1:
            raise ProtocolError("envelope field must contain exactly one equals sign")
        key, value = part.split(b"=", 1)
        if key.decode("ascii") != expected_key or not value:
            raise ProtocolError("envelope fields are missing, unknown, or out of order")
        values[expected_key] = value

    chain_id = _check_chain_id(values["chain"])
    if chain_id != profile.chain_id:
        raise ProtocolError("envelope chain ID does not match the selected profile")
    batch_number = _parse_uint(
        values["batch"],
        maximum=U64_MAX,
        minimum=1,
        field="batch_number",
    )
    fields["chain"] = chain_id
    fields["batch"] = str(batch_number)
    for key in ("prev", "txroot", "state", "transition", "batch_hash"):
        fields[key] = _check_hash(values[key], key)

    data_hex = values["data_hex"]
    if len(data_hex) > MAX_DATA_HEX_CHARS:
        raise ProtocolError("data_hex exceeds the 2 MiB character limit")
    if len(data_hex) % 2 or not re.fullmatch(rb"[0-9a-f]+", data_hex):
        raise ProtocolError("data_hex must be non-empty, even-length lowercase hexadecimal")
    fields["data_hex"] = data_hex.decode("ascii")
    try:
        data = bytes.fromhex(fields["data_hex"])
    except ValueError as exc:
        raise ProtocolError("data_hex is invalid") from exc
    if not data or len(data) > MAX_DATA_BYTES:
        raise ProtocolError("decoded transaction data is empty or exceeds 1 MiB")
    return fields, data


def _verify_ordered_batch_step(
    envelope: bytes,
    state: Mapping[str, int],
    profile: Profile,
    expected_batch_number: int,
) -> BatchResult:
    """Verify one replay step; caller must supply trusted state and sequence."""
    fields, data = _parse_envelope(envelope, profile)
    if fields["batch"] != str(expected_batch_number):
        raise ProtocolError(
            f"batch number {fields['batch']} does not match configured sequence "
            f"{expected_batch_number}"
        )
    state_bytes = canonical_state_bytes(state)
    expected_prev = sha256_hex(state_bytes)
    if expected_batch_number == profile.activation_batch:
        if expected_prev != profile.parent_state_hash:
            raise ProtocolError("activation state does not match the configured parent")
    if fields["prev"] != expected_prev:
        raise ProtocolError("prev does not match the preceding canonical state")

    transactions = parse_transaction_data(data, require_sorted=True)
    expected_txroot = _transaction_root(transactions)
    if fields["txroot"] != expected_txroot:
        raise ProtocolError("txroot does not match the ordered transaction bytes")
    updated_state = _execute_transactions(state, transactions)
    expected_state = sha256_hex(canonical_state_bytes(updated_state))
    if fields["state"] != expected_state:
        raise ProtocolError("state does not match deterministic execution")
    expected_transition = sha256(
        bytes.fromhex(expected_prev) + bytes.fromhex(expected_txroot)
    ).hex()
    if fields["transition"] != expected_transition:
        raise ProtocolError("transition does not match prev and txroot")
    expected_batch_hash = sha256_hex(
        _batch_hash_preimage(
            profile.chain_id,
            expected_batch_number,
            expected_prev,
            expected_txroot,
            expected_state,
            expected_transition,
        )
    )
    if fields["batch_hash"] != expected_batch_hash:
        raise ProtocolError("batch_hash does not match the v0.9 preimage")
    return BatchResult(envelope, updated_state, expected_batch_number, fields)


def verify_ordered_batch(
    envelope: bytes,
    state: Mapping[str, int],
    profile: Profile,
    expected_batch_number: int,
) -> BatchResult:
    """Verify only the selected profile's activation batch.

    Later batches require replay from the configured checkpoint with
    ``verify_profile_history`` so a caller cannot skip or invent prior state.
    """
    if expected_batch_number != profile.activation_batch:
        raise ProtocolError(
            "single-batch verification is limited to profile activation; "
            "use verify_profile_history for later batches"
        )
    return _verify_ordered_batch_step(
        envelope,
        state,
        profile,
        expected_batch_number,
    )


def replay_envelopes(
    envelopes: Iterable[bytes],
    profile: Profile,
    initial_state: Mapping[str, int],
) -> tuple[dict[str, int], int, list[BatchResult]]:
    state = dict(initial_state)
    expected_batch = profile.activation_batch
    results: list[BatchResult] = []
    for envelope in envelopes:
        result = _verify_ordered_batch_step(envelope, state, profile, expected_batch)
        results.append(result)
        state = result.state
        expected_batch += 1
    return state, expected_batch, results


def build_for_profile(
    transaction_data: bytes,
    profile_name: str,
    *,
    history: Iterable[bytes] = (),
    root: Path = PROJECT_ROOT,
) -> BatchResult:
    profile, initial_state = load_profile(profile_name, root=root)
    state, next_batch, _ = replay_envelopes(history, profile, initial_state)
    return build_ordered_batch(transaction_data, state, profile, next_batch)


def verify_profile_history(
    envelopes: Iterable[bytes],
    profile_name: str,
    *,
    root: Path = PROJECT_ROOT,
) -> tuple[Profile, dict[str, int], int, list[BatchResult]]:
    profile, initial_state = load_profile(profile_name, root=root)
    state, next_batch, results = replay_envelopes(envelopes, profile, initial_state)
    return profile, state, next_batch, results
