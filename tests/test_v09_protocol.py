from __future__ import annotations

import hashlib
import contextlib
import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from settlement.v09 import v09_protocol as v09
from settlement.v09.verify_clean_recovery import parse_publication, verify_recovery


ROOT = Path(__file__).resolve().parents[1]
BATCH_1 = ROOT / "settlement/v09/clean-recovery/batch-1-data.txt"
BATCH_2 = ROOT / "settlement/v09/clean-recovery/batch-2-data.txt"


class V09ProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.profile, self.genesis_state = v09.load_profile("clean-genesis")
        self.batch_1_data = BATCH_1.read_bytes()
        self.batch_2_data = BATCH_2.read_bytes()
        self.batch_1 = v09.build_ordered_batch(
            self.batch_1_data,
            self.genesis_state,
            self.profile,
            1,
        )

    def test_draft_vectors_and_clean_genesis_history(self) -> None:
        self.assertEqual(
            self.batch_1.fields["batch_hash"],
            "23a4b6c14397596bfc202e8d6b925d254baac2972cdb58166515286cf0db4745",
        )
        self.assertFalse(self.batch_1.envelope.endswith(b"\n"))
        batch_2 = v09.build_ordered_batch(
            self.batch_2_data,
            self.batch_1.state,
            self.profile,
            2,
        )
        self.assertEqual(
            batch_2.fields["batch_hash"],
            "e0625673ce6f36638b52b92c2e297528a6308f225139ddafd398f2ce32b7f670",
        )
        self.assertEqual(len(batch_2.envelope), 635)

        _profile, final_state, next_batch, results = v09.verify_profile_history(
            [self.batch_1.envelope, batch_2.envelope],
            "clean-genesis",
        )
        self.assertEqual([result.batch_number for result in results], [1, 2])
        self.assertEqual(next_batch, 3)
        self.assertEqual(final_state, {"alice": 885, "bob": 85, "carol": 30})

    def test_builder_sorts_unique_ids_and_verifier_requires_that_order(self) -> None:
        reversed_data = b"".join(
            reversed(self.batch_1_data.splitlines(keepends=True))
        )
        built = v09.build_ordered_batch(
            reversed_data,
            self.genesis_state,
            self.profile,
            1,
        )
        ordered = bytes.fromhex(built.fields["data_hex"])
        self.assertEqual(ordered, self.batch_1_data)

        unsorted_envelope = (
            self.batch_1.envelope.rsplit(b"|data_hex=", 1)[0]
            + b"|data_hex="
            + reversed_data.hex().encode("ascii")
        )
        with self.assertRaisesRegex(v09.ProtocolError, "strictly increasing"):
            v09.verify_ordered_batch(
                unsorted_envelope,
                self.genesis_state,
                self.profile,
                1,
            )

        duplicate = self.batch_1_data.replace(b"id=2|", b"id=1|")
        with self.assertRaisesRegex(v09.ProtocolError, "unique"):
            v09.build_ordered_batch(duplicate, self.genesis_state, self.profile, 1)

    def test_migration_profile_is_pinned_to_verified_batch_two(self) -> None:
        profile, state = v09.load_profile("existing-history-migration")
        self.assertEqual(profile.activation_batch, 3)
        self.assertEqual(profile.parent_batch_number, 2)
        self.assertEqual(
            profile.parent_batch_hash,
            "c9ebef2e044513ded4e9d25a6a8fc71d8fc2973578d531bcac1bd313fc2254a9",
        )
        self.assertEqual(
            profile.parent_state_hash,
            "16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b",
        )
        migration_batch = v09.build_ordered_batch(
            self.batch_2_data,
            state,
            profile,
            3,
        )
        self.assertEqual(migration_batch.fields["batch"], "3")
        self.assertEqual(migration_batch.fields["prev"], profile.parent_state_hash)
        _profile, _state, next_batch, results = v09.verify_profile_history(
            [migration_batch.envelope],
            "existing-history-migration",
        )
        self.assertEqual(results[0].batch_number, 3)
        self.assertEqual(next_batch, 4)

        with self.assertRaisesRegex(v09.ProtocolError, "batch number"):
            wrong_activation = migration_batch.envelope.replace(
                b"|batch=3|",
                b"|batch=2|",
            )
            v09.verify_profile_history(
                [wrong_activation],
                "existing-history-migration",
            )

    def test_single_batch_verification_cannot_bypass_profile_activation(self) -> None:
        migration_profile, _migration_state = v09.load_profile(
            "existing-history-migration"
        )
        with self.assertRaisesRegex(v09.ProtocolError, "limited to profile activation"):
            v09.verify_ordered_batch(
                self.batch_1.envelope,
                self.genesis_state,
                migration_profile,
                1,
            )
        with self.assertRaisesRegex(v09.ProtocolError, "limited to profile activation"):
            v09.verify_ordered_batch(
                self.batch_1.envelope,
                self.genesis_state,
                migration_profile,
                4,
            )
        with self.assertRaisesRegex(v09.ProtocolError, "does not match configured sequence"):
            v09.verify_profile_history(
                [self.batch_1.envelope],
                "existing-history-migration",
            )

    def test_migration_history_rejects_a_skipped_activation_sequence(self) -> None:
        profile, state = v09.load_profile("existing-history-migration")
        skipped_batch = v09.build_ordered_batch(
            self.batch_2_data,
            state,
            profile,
            5,
        )
        with self.assertRaisesRegex(v09.ProtocolError, "does not match configured sequence"):
            v09.verify_profile_history(
                [skipped_batch.envelope],
                "existing-history-migration",
            )

    def test_tampered_migration_checkpoint_inputs_are_rejected(self) -> None:
        checkpoint_files = {
            "sequencer/state-result-2.txt": ROOT / "sequencer/state-result-2.txt",
            "sequencer/batch-exec-record.txt": ROOT / "sequencer/batch-exec-record.txt",
            "settlement/v08/batch-2-payload.txt": ROOT / "settlement/v08/batch-2-payload.txt",
        }

        for target in checkpoint_files:
            with self.subTest(target=target), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                for relative, source in checkpoint_files.items():
                    destination = root / relative
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    raw = source.read_bytes()
                    if relative == target and relative.endswith("state-result-2.txt"):
                        lines = raw.splitlines()
                        account, balance = lines[0].split(b"=", 1)
                        lines[0] = account + b"=" + str(int(balance) + 1).encode("ascii")
                        raw = b"\n".join(lines) + b"\n"
                    elif relative == target and relative.endswith("batch-exec-record.txt"):
                        lines = raw.splitlines(keepends=True)
                        for index, line in enumerate(lines):
                            if line.startswith(b"BATCH="):
                                value = line[len(b"BATCH=") :].rstrip(b"\n")
                                replacement = b"0" if value[:1] != b"0" else b"1"
                                lines[index] = b"BATCH=" + replacement + value[1:] + (
                                    b"\n" if line.endswith(b"\n") else b""
                                )
                                break
                        raw = b"".join(lines)
                    elif relative == target and relative.endswith("batch-2-payload.txt"):
                        raw = raw.replace(b"|batch=2|", b"|batch=3|", 1)
                    destination.write_bytes(raw)

                with self.assertRaises(v09.ProtocolError):
                    v09.load_profile("existing-history-migration", root=root)

    def test_tampered_commitment_fields_are_rejected(self) -> None:
        markers = (b"|txroot=", b"|state=", b"|transition=", b"|batch_hash=")
        for marker in markers:
            with self.subTest(field=marker):
                field_start = self.batch_1.envelope.index(marker) + len(marker)
                damaged = (
                    self.batch_1.envelope[:field_start]
                    + (b"0" if self.batch_1.envelope[field_start : field_start + 1] != b"0" else b"1")
                    + self.batch_1.envelope[field_start + 1 :]
                )
                with self.assertRaises(v09.ProtocolError):
                    v09.verify_profile_history([damaged], "clean-genesis")

    def test_envelope_encoding_errors_are_rejected(self) -> None:
        data = bytes.fromhex(self.batch_1.fields["data_hex"])
        encoded_data = self.batch_1.fields["data_hex"].encode("ascii")
        malformed = {
            "final LF": self.batch_1.envelope + b"\n",
            "CR": self.batch_1.envelope + b"\r",
            "unknown field": self.batch_1.envelope + b"|extra=x",
            "duplicate field": self.batch_1.envelope.replace(
                b"|batch=1|",
                b"|batch=1|batch=1|",
            ),
            "uppercase hex": (
                self.batch_1.envelope.rsplit(b"|data_hex=", 1)[0]
                + b"|data_hex="
                + encoded_data.upper()
            ),
            "odd hex": (
                self.batch_1.envelope.rsplit(b"|data_hex=", 1)[0]
                + b"|data_hex="
                + encoded_data[:-1]
            ),
            "missing transaction LF": (
                self.batch_1.envelope.rsplit(b"|data_hex=", 1)[0]
                + b"|data_hex="
                + data[:-1].hex().encode("ascii")
            ),
            "CRLF transaction": (
                self.batch_1.envelope.rsplit(b"|data_hex=", 1)[0]
                + b"|data_hex="
                + data.replace(b"\n", b"\r\n").hex().encode("ascii")
            ),
            "extra transaction field": (
                self.batch_1.envelope.rsplit(b"|data_hex=", 1)[0]
                + b"|data_hex="
                + (data.replace(b"|nonce=", b"|extra=x|nonce=", 1)).hex().encode("ascii")
            ),
            "leading-zero transaction ID": (
                self.batch_1.envelope.rsplit(b"|data_hex=", 1)[0]
                + b"|data_hex="
                + data.replace(b"id=1|", b"id=01|", 1).hex().encode("ascii")
            ),
            "reordered envelope fields": self.batch_1.envelope.replace(
                b"|prev=",
                b"|state=" + self.batch_1.fields["state"].encode("ascii") + b"|prev=",
                1,
            ),
        }
        for name, envelope in malformed.items():
            with self.subTest(name=name):
                with self.assertRaises(v09.ProtocolError):
                    v09.verify_profile_history([envelope], "clean-genesis")

    def test_input_limits_and_integer_bounds(self) -> None:
        with self.assertRaisesRegex(v09.ProtocolError, "1 MiB"):
            v09.parse_transaction_data(b"x" * (v09.MAX_DATA_BYTES + 1))
        with self.assertRaisesRegex(v09.ProtocolError, "2048-transaction"):
            v09.parse_transaction_data(b"x\n" * (v09.MAX_TRANSACTIONS + 1))
        with self.assertRaisesRegex(v09.ProtocolError, "account grammar"):
            v09.parse_transaction_data(
                (
                    "BTCSL2TX|v0.7|id=1|from="
                    + "a" * (v09.MAX_ACCOUNT_BYTES + 1)
                    + "|to=bob|amount=1|nonce=0\n"
                ).encode("ascii")
            )
        with self.assertRaisesRegex(v09.ProtocolError, "permitted range"):
            v09.parse_transaction_data(
                f"BTCSL2TX|v0.7|id={v09.U64_MAX + 1}|from=alice|to=bob|amount=1|nonce=0\n".encode(
                    "ascii"
                )
            )
        with self.assertRaisesRegex(v09.ProtocolError, "permitted range"):
            v09.parse_transaction_data(
                f"BTCSL2TX|v0.7|id=1|from=alice|to=bob|amount={v09.U256_MAX + 1}|nonce=0\n".encode(
                    "ascii"
                )
            )
        with self.assertRaisesRegex(v09.ProtocolError, "permitted range"):
            v09.parse_state(f"alice={v09.U256_MAX + 1}\n".encode("ascii"))
        too_many_accounts = b"".join(
            f"a{account_number:04d}=0\n".encode("ascii")
            for account_number in range(v09.MAX_ACCOUNTS + 1)
        )
        with self.assertRaisesRegex(v09.ProtocolError, "4096-account"):
            v09.parse_state(too_many_accounts)
        with self.assertRaisesRegex(v09.ProtocolError, "1 MiB"):
            v09.parse_state(b"a=0\n" + b"x" * v09.MAX_STATE_BYTES)
        with self.assertRaisesRegex(v09.ProtocolError, "byte limit"):
            v09.verify_profile_history(
                [b"x" * (v09.MAX_ENVELOPE_BYTES + 1)],
                "clean-genesis",
            )

    def test_oversized_batch_integer_is_a_protocol_error(self) -> None:
        oversized_batch = (
            self.batch_1.envelope.replace(
                b"|batch=1|",
                b"|batch=" + b"9" * 5000 + b"|",
                1,
            )
        )
        self.assertLess(len(oversized_batch), v09.MAX_ENVELOPE_BYTES)
        with self.assertRaisesRegex(v09.ProtocolError, "permitted range"):
            v09.verify_profile_history([oversized_batch], "clean-genesis")

    def test_legacy_newline_variants_remain_distinct(self) -> None:
        root_v06 = (ROOT / "batch-1-canonical.txt").read_bytes()
        self.assertTrue(root_v06.endswith(b"\n"))
        self.assertEqual(
            hashlib.sha256(root_v06).hexdigest(),
            "1ce3ca657f09e08f5ab5e722ddb20631d87464b96521adae960143de3d69213e",
        )
        self.assertEqual(
            hashlib.sha256(root_v06[:-1]).hexdigest(),
            "c1c0b7df61f4609f1b3dbdbba580b540131468c458d3ba6fdab78646c24a4e81",
        )

        record = {}
        for line in (ROOT / "sequencer/batch-exec-record.txt").read_text().splitlines():
            key, value = line.split("=", 1)
            record[key] = value
        preimage = (
            f"BTCSL2BATCH|v0.6|batch=2|prev={record['PREVSTATE']}|"
            f"txroot={record['TXROOT']}|state={record['STATE']}|"
            f"transition={record['TRANSITION']}"
        ).encode("ascii")
        self.assertEqual(
            hashlib.sha256(preimage).hexdigest(),
            "c9ebef2e044513ded4e9d25a6a8fc71d8fc2973578d531bcac1bd313fc2254a9",
        )
        self.assertEqual(
            hashlib.sha256(preimage + b"\n").hexdigest(),
            "f2539dba171e10c6f60ff26a6b9b6bc1b2f2e3281c20b5084863a7249f7682e2",
        )

    def test_data_publication_stays_on_existing_recovery_path(self) -> None:
        source = ROOT / "settlement/v09/batch-2-publication.txt"
        text = source.read_text(encoding="ascii")
        parsed = parse_publication(text, source)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0], self.batch_2_data.decode("ascii").splitlines()[0])
        with self.assertRaises(v09.ProtocolError):
            v09.verify_profile_history([source.read_bytes()], "clean-genesis")

    def test_existing_clean_recovery_verifier_still_accepts_legacy_fixtures(self) -> None:
        with contextlib.redirect_stdout(io.StringIO()):
            verify_recovery(ROOT, 2)

    def test_builder_and_verifier_command_line_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            envelope_path = Path(temporary_directory) / "batch-1.v09"
            build = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "settlement.v09.build_ordered_batch",
                    "--profile",
                    "clean-genesis",
                    "--transactions",
                    str(BATCH_1),
                    "--output",
                    str(envelope_path),
                ],
                cwd=ROOT,
                capture_output=True,
                check=False,
            )
            self.assertEqual(build.returncode, 0, build.stderr.decode("utf-8", "replace"))
            self.assertEqual(envelope_path.read_bytes(), self.batch_1.envelope)

            verify = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "settlement.v09.verify_batch",
                    "--profile",
                    "clean-genesis",
                    str(envelope_path),
                ],
                cwd=ROOT,
                capture_output=True,
                check=False,
            )
            self.assertEqual(verify.returncode, 0, verify.stderr.decode("utf-8", "replace"))
            self.assertIn(b"BATCH 1 PASS", verify.stdout)


if __name__ == "__main__":
    unittest.main()
