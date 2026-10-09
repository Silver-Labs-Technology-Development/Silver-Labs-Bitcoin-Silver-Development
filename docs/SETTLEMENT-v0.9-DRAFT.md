# BTCS L2 v0.9 Encoding Specification — DRAFT

**Status:** Proposal for review; not adopted or implemented
**Scope:** Deterministic text encoding, batch data, and commitment hashes for the prototype fixtures
**Compatibility:** Preserves historical v0.6–v0.8 values; defines a new v0.9 batch-hash domain

**Proposed decision:** Adopt the versioned, chain-specific batch hash below for new v0.9 records. Preserve the existing hash rules and verification behavior for all historical v0.6–v0.8 records; do not relabel or recompute their commitments.

This draft turns the existing v0.7 transaction and execution fixtures into a byte-exact v0.9 publication proposal. It does not claim that the payload has been published to BTCS or that the prototype is a validity-proof rollup.

The labels **existing rule** and **v0.9 proposal** distinguish code and fixture behavior from choices proposed here. A v0.9 implementation must not reinterpret an older record using the new rules.

## 1. Existing evidence and conflicts

| Area | Existing evidence | Draft resolution |
| --- | --- | --- |
| Transaction root | `docs/SETTLEMENT.md` describes a Merkle root. `execution/build_batch_record.py` instead SHA-256 hashes each transaction file, concatenates the raw 32-byte hashes, and SHA-256 hashes that byte string. | Preserve the executable flat-hash rule for v0.9. A Merkle root would require a separate version and test vectors. |
| State commitment | The spec describes a Merkle-based commitment. The sequencer prototype hashes sorted `account=balance` text. | Preserve the text-state hash for v0.9. Do not call it a Merkle root. |
| Genesis previous state | Root v0.6 fixtures use an all-zero `prev`. The v0.7 sequencer record hashes the genesis state file and uses that hash as `PREVSTATE`. | For v0.9 recovery, use the hash of canonical genesis-state bytes. Keep the zero-root v0.6 vector historical. |
| Batch-hash bytes | `verify_v06_full.py` hashes a canonical v0.6 string with a final LF. `execution/build_batch_record.py`, used by the sequencer, hashes its canonical string without a final LF. | Freeze both legacy results. The v0.9 batch-hash preimage below has no final LF and uses a v0.9 domain tag. |
| Chain identifier | The settlement concept includes `chain_id`; the current record builder's batch hash omits it. The v0.8 payload includes `chain=regtest-l2` outside the hash. | Include `chain` in the new v0.9 batch-hash preimage. This intentionally creates a different v0.9 hash; it does not rewrite v0.8 records. |
| Payload field names | The v0.8 text uses `batch=2` for the number and a second `batch=<hash>` for the commitment. The v0.9 fixture embeds pipe-delimited transactions after `data=` and uses literal `\n` separators. | Use the unique fields `batch`, `batch_hash`, and `data_hex` in v0.9. Hex data prevents transaction pipes and newlines from colliding with envelope delimiters. |
| Text-file newline | The v0.6 canonical fixture and `settlement-test.hex` include a final `0a`. Sequencer transaction files also include LF, and that LF affects transaction hashes. | Distinguish the byte domains: transaction records and state records end in LF; the v0.9 envelope and its batch-hash preimage do not. |

The transaction line version remains `v0.7` inside a v0.9 publication. The envelope version identifies the publication encoding; it does not silently change the transaction encoding.

## 2. v0.9 publication envelope

The proposed envelope is one ASCII record with this exact field order:

```text
BTCSL2|v0.9|chain=<chain_id>|batch=<batch_number>|prev=<state_hash>|txroot=<txroot>|state=<state_hash>|transition=<transition_hash>|batch_hash=<batch_hash>|data_hex=<lowercase_hex>
```

Rules:

1. The prefix is exactly `BTCSL2|v0.9`.
2. Each listed key occurs exactly once, in the shown order. Unknown, missing, duplicate, or reordered fields are invalid.
3. Each field has exactly one `=` separating its key and value. The field separator is one ASCII pipe byte (`0x7c`). No spaces are inserted around fields.
4. The envelope bytes are ASCII. The canonical envelope has no CR or LF byte, including no trailing LF. When carried as a transaction data payload, those exact bytes are the payload; a text editor must not add a line terminator.
5. `prev`, `txroot`, `state`, `transition`, and `batch_hash` are each exactly 64 lowercase hexadecimal characters, representing 32 bytes.
6. `data_hex` is nonempty, lowercase hexadecimal, and has an even number of characters. Decoding it yields the batch transaction-data bytes defined in Section 3.
7. `chain_id` uses lowercase ASCII letters, digits, and hyphens; its first byte is a lowercase letter or digit. The example chain identifier is `regtest-l2`.

The envelope is a textual proposal. It does not assert that a full hex-encoded batch fits any particular BTCS transaction or carrier limit.

## 3. Transaction bytes and transaction root

Each transaction has the current v0.7 field order:

```text
BTCSL2TX|v0.7|id=<id>|from=<account>|to=<account>|amount=<amount>|nonce=<nonce>
```

For v0.9, a decoded batch data value `D` is the bytewise concatenation of one or more transaction records. Each record is ASCII and is terminated by exactly one LF byte (`0x0a`), including the final record. CRLF is invalid. Empty records, leading or trailing whitespace, non-ASCII bytes, and extra fields are invalid.

The fields occur in the order shown. There is no quoting or escaping. Account values use the proposed ASCII grammar `[a-z][a-z0-9_]*`; this excludes both `|` and `=`. The fixtures use `alice`, `bob`, and `carol`.

The `id` value orders sequencer output numerically. A sequencer sorts by increasing `id`; equal IDs retain their input order, matching the stable sort in the existing sequencer. The serialized order is the execution and hash order. A verifier must not reorder a published batch.

For the envelope, `data_hex` is the lowercase hexadecimal encoding of every byte in `D`, including each `0x0a`. To recover the transaction lines, decode `data_hex`, require a final LF, split at each LF, and discard only the single empty split result after the final LF. Reject any other empty record. The existing v0.9 fixture's literal backslash-`n` separators are fixture text; they do not define a general escape convention for v0.9 data.

For transaction line bytes `L_i` (without their final LF):

```text
tx_hash_i = SHA256(L_i || 0x0a)                 # 32 raw bytes
txroot    = SHA256(tx_hash_1 || ... || tx_hash_n) # 32 raw bytes, displayed as lowercase hex
```

This preserves `execution/build_batch_record.py`. It is not a Merkle construction and has no leaf prefixes or odd-node rule.

## 4. Integers and execution validation

Integers are ASCII base-10 strings using the canonical grammar `0|[1-9][0-9]*`. A leading plus/minus, whitespace, or leading zero is invalid. The proposed v0.9 domain uses nonnegative, arbitrary-precision integers; payload and implementation resource limits remain unresolved.

- `batch_number` is positive and starts at 1.
- Transaction `id` and `nonce` are nonnegative.
- `amount` is positive.
- State balances are nonnegative.

These canonical syntax rules are stricter than Python's `int()` parser in the prototype; they are an explicit v0.9 proposal. Existing execution behavior is otherwise preserved: the sender and receiver must exist, the amount must be positive, and the sender must have enough balance. The current executor does not enforce nonce sequencing. This draft validates nonce syntax but leaves nonce semantics unenforced.

Transactions execute in their serialized order. A failed transaction invalidates the batch; later transactions are not applied. No state mutation or partial batch commitment may be accepted after a failure.

## 5. State bytes and previous-state commitment

State bytes contain one line per account, sorted by ascending ASCII account name:

```text
<account>=<balance>\n
```

Every line, including the last, ends in LF (`0x0a`). The state has no `BTCSL2STATE` prefix, spaces, blank lines, or CR bytes. Duplicate or out-of-order account lines are invalid in the v0.9 proposal.

```text
state_hash = SHA256(canonical_state_bytes)
```

For batch 1, `prev` is the SHA-256 hash of the canonical genesis-state bytes. For every later batch, `prev` is the preceding batch's `state` hash. The state hash is displayed as 64 lowercase hexadecimal characters; when used as hash input, decode it to its 32 raw bytes.

This explicitly chooses the v0.7 clean-recovery rule. The all-zero previous hash in the root v0.6 fixture remains a separate historical convention.

### Proposed migration boundary and linkage

The version on a record or publication selects its hash rule. Records before the v0.9 activation boundary remain verified with their historical rule, including the v0.6-tagged sequencer preimage used by the v0.7/v0.8 fixtures. The first record designated v0.9 uses the v0.9 preimage in Section 6. No earlier record is rewritten, and its stored `BATCH` value remains valid only under its original version's rule.

For a v0.9 history that starts at genesis, batch 1 uses the SHA-256 hash of canonical genesis-state bytes as `prev`. When v0.9 follows an accepted legacy batch, the first v0.9 batch uses the last accepted legacy batch's `STATE` commitment verbatim as `prev`; it continues the batch-number sequence, and its state is derived by executing from that prior state. This linkage assumes the prior state uses the same canonical text-state commitment defined here. A transition from a different state encoding, such as a future Merkle state, needs a separately specified mapping before migration.

## 6. Transition and batch hashes

The v0.7 execution prototype defines the transition input as raw digest bytes, not their ASCII hex representations:

```text
transition = SHA256(bytes.fromhex(prev) || bytes.fromhex(txroot))
```

The proposed v0.9 batch-hash preimage is ASCII, in this exact order, with no final LF:

```text
BTCSL2BATCH|v0.9|chain=<chain_id>|batch=<batch_number>|prev=<prev>|txroot=<txroot>|state=<state>|transition=<transition>
```

```text
batch_hash = SHA256(batch_hash_preimage_bytes)
```

`batch_hash` is displayed as 64 lowercase hexadecimal characters. It does not hash `data_hex` directly: `txroot` commits to the ordered transaction bytes. It includes both `chain_id` and `batch_number`, resolving the chain-domain omission in the v0.7 batch builder. Historical v0.7/v0.8 `BATCH` values continue to use their existing v0.6-tagged preimage and must not be relabeled as v0.9 hashes.

## 7. Canonical envelope and parser failures

An independent decoder must reject, with a nonzero process exit status:

- a wrong prefix/version, field order, missing/extra/duplicate key, or malformed `key=value` field;
- non-ASCII envelope bytes, CR/LF in the envelope, or a final envelope LF;
- a noncanonical integer, invalid account, malformed transaction, empty batch, invalid order, or invalid state;
- invalid hex, uppercase hex, odd-length hex, CRLF or missing final LF in decoded transaction data;
- an unknown account, nonpositive amount, insufficient balance, invalid hash length, or any commitment mismatch.

The recommended command-line convention is exit code **1** for malformed data or failed verification and **2** for command-line usage errors. A valid batch exits **0**. Printing `FAIL` while returning zero is not sufficient; several historical root scripts have that behavior and are not the v0.9 error contract.

## 8. Recalculated test vectors

These vectors use the project fixtures and the existing sequencer hash rules. In byte examples, visible `\n` denotes one LF byte (`0x0a`), not two literal characters. Expected batch states were independently derived by replaying the transactions from genesis and match the existing execution state fixtures. Transaction, state, transition, and legacy batch hashes were recalculated from those inputs and cross-checked with `sha256sum`; binary digest concatenations were checked by decoding the hex digests before hashing. The proposed v0.9 batch hashes were calculated from the preimages in this draft and separately checked with `sha256sum`. They are proposed values, not values stored in the existing v0.8 payload.

### Genesis bytes

The exact ASCII genesis bytes are:

```text
alice=1000\nbob=0\ncarol=0\n
```

The visible `\n` sequences above each represent one byte `0x0a`; the final state line is LF-terminated.

```text
SHA256(genesis bytes) = dfdff9103fbd96a9e62c64ffbe32fcf569cf995c4dd5a1ea867c2c5fad4650fd
```

### Batch 1 bytes and hashes

Exact batch data bytes, with each displayed line ending in `0x0a`:

```text
BTCSL2TX|v0.7|id=1|from=alice|to=bob|amount=100|nonce=1\n
BTCSL2TX|v0.7|id=2|from=bob|to=carol|amount=40|nonce=1\n
```

```text
tx_hash_1 = dfe5f2b8e26259154c87b078d1e422fb44bb3755954b121898ef40bf1bad323e
tx_hash_2 = fe881942f0ee3c3eecd02807d6d7721ced20a676ea2e2f40a2b21f5b0f3fe162
txroot    = f0d1c1cf969a7c09f5775bcee22bce943d19fb33f3a9a5a70765d32e507c34ea
state bytes = alice=900\nbob=60\ncarol=40\n
state     = 87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e
prev      = dfdff9103fbd96a9e62c64ffbe32fcf569cf995c4dd5a1ea867c2c5fad4650fd
transition= a67bf21888327ec1d67afab90c94416d399698edf2ab9a2523816834c56f3189
```

The legacy sequencer batch-hash preimage is the following ASCII bytes, without a final LF:

```text
BTCSL2BATCH|v0.6|batch=1|prev=dfdff9103fbd96a9e62c64ffbe32fcf569cf995c4dd5a1ea867c2c5fad4650fd|txroot=f0d1c1cf969a7c09f5775bcee22bce943d19fb33f3a9a5a70765d32e507c34ea|state=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e|transition=a67bf21888327ec1d67afab90c94416d399698edf2ab9a2523816834c56f3189

SHA256(legacy bytes without LF) = 519f3f0d8d799be8c30b1254a79f3083e502acf79c22091d5a0af667b5153934
SHA256(the same bytes with LF) = f81ad3ef0a2948a55660b103040eb4b84067dbb59837f82a988473ebe41f1c82
```

The proposed v0.9 batch preimage is:

```text
BTCSL2BATCH|v0.9|chain=regtest-l2|batch=1|prev=dfdff9103fbd96a9e62c64ffbe32fcf569cf995c4dd5a1ea867c2c5fad4650fd|txroot=f0d1c1cf969a7c09f5775bcee22bce943d19fb33f3a9a5a70765d32e507c34ea|state=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e|transition=a67bf21888327ec1d67afab90c94416d399698edf2ab9a2523816834c56f3189

SHA256(proposed v0.9 bytes) = 23a4b6c14397596bfc202e8d6b925d254baac2972cdb58166515286cf0db4745
```

### Batch 2 bytes and hashes

Exact batch data bytes, with each displayed line ending in `0x0a`:

```text
BTCSL2TX|v0.7|id=3|from=alice|to=bob|amount=25|nonce=2\n
BTCSL2TX|v0.7|id=4|from=carol|to=alice|amount=10|nonce=2\n
```

```text
tx_hash_1 = 52a3867d8ac5b4e1f2d32791da15d3e88fbc8b78839bbffc8183ec12505a7f91
tx_hash_2 = 8d9437201f1de4cd80bf0a2c5ec7d1553feec071cd02f5485b05bf027ac4a4cc
txroot    = a9a8b8db62cd2968ae74efa7ecb6dc70e94e01ffa16e4d46c32b0131f4c38afe
state bytes = alice=885\nbob=85\ncarol=30\n
state     = 16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b
prev      = 87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e
transition= 1c5a0ba253ce7a7e7839232123b099a10c385db69bb0bc58e558a6ee9f2430bd
```

The legacy sequencer batch-hash preimage is the following ASCII bytes, without a final LF:

```text
BTCSL2BATCH|v0.6|batch=2|prev=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e|txroot=a9a8b8db62cd2968ae74efa7ecb6dc70e94e01ffa16e4d46c32b0131f4c38afe|state=16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b|transition=1c5a0ba253ce7a7e7839232123b099a10c385db69bb0bc58e558a6ee9f2430bd

SHA256(legacy bytes without LF) = c9ebef2e044513ded4e9d25a6a8fc71d8fc2973578d531bcac1bd313fc2254a9
SHA256(the same bytes with LF) = f2539dba171e10c6f60ff26a6b9b6bc1b2f2e3281c20b5084863a7249f7682e2
```

The proposed v0.9 batch preimage is:

```text
BTCSL2BATCH|v0.9|chain=regtest-l2|batch=2|prev=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e|txroot=a9a8b8db62cd2968ae74efa7ecb6dc70e94e01ffa16e4d46c32b0131f4c38afe|state=16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b|transition=1c5a0ba253ce7a7e7839232123b099a10c385db69bb0bc58e558a6ee9f2430bd

SHA256(proposed v0.9 bytes) = e0625673ce6f36638b52b92c2e297528a6308f225139ddafd398f2ce32b7f670
```

For the batch 2 envelope, `data_hex` is exactly:

```text
425443534c3254587c76302e377c69643d337c66726f6d3d616c6963657c746f3d626f627c616d6f756e743d32357c6e6f6e63653d320a425443534c3254587c76302e377c69643d347c66726f6d3d6361726f6c7c746f3d616c6963657c616d6f756e743d31307c6e6f6e63653d320a
```

Substituting that value and the batch 2 vector above into the envelope template gives this 635-byte ASCII payload. The code-block content is one line; the payload ends at the final hex digit and has no final LF:

```text
BTCSL2|v0.9|chain=regtest-l2|batch=2|prev=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e|txroot=a9a8b8db62cd2968ae74efa7ecb6dc70e94e01ffa16e4d46c32b0131f4c38afe|state=16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b|transition=1c5a0ba253ce7a7e7839232123b099a10c385db69bb0bc58e558a6ee9f2430bd|batch_hash=e0625673ce6f36638b52b92c2e297528a6308f225139ddafd398f2ce32b7f670|data_hex=425443534c3254587c76302e377c69643d337c66726f6d3d616c6963657c746f3d626f627c616d6f756e743d32357c6e6f6e63653d320a425443534c3254587c76302e377c69643d347c66726f6d3d6361726f6c7c746f3d616c6963657c616d6f756e743d31307c6e6f6e63653d320a
```

The proposed `batch_hash` (`e062…`) is intentionally different from the legacy v0.8 `batch` value (`c9eb…`).

## 9. Unresolved decisions

1. **Chain-ID rules.** The proposed chain-ID syntax is defined, but its registry, canonical network assignment, alias policy, and immutability need agreement. The chain ID must be fixed before a v0.9 batch is accepted; otherwise different names for the same network produce different commitments.
2. **Activation rules.** The protocol still needs to specify the activation batch number or other activation event, who configures it, and how verifiers learn the applicable version. The migration rule above is a proposal, not an adopted activation schedule.
3. **Publication capacity.** Hex encoding is simple and delimiter-safe but doubles the batch-data byte count before envelope overhead. The actual carrier, maximum payload size, and whether all batch data belongs on BTCS are not specified here.
4. **Account identifiers.** The proposed grammar matches current fixtures; account-name length and future character support need agreement.
5. **Transaction IDs and nonces.** The draft preserves stable ordering for duplicate IDs. Whether IDs must be unique and what nonce rules should be enforced remain open.
6. **Integer/resource limits.** The draft uses arbitrary-precision integer semantics to match Python's prototype. Implementations still need agreed limits for transaction count, field length, account count, and total data size.
7. **State commitment evolution.** The prototype hashes canonical text, while the older spec discusses Merkle state commitments. A Merkle migration requires a new, separately versioned rule and vectors.
8. **Settlement metadata.** BTCS transaction IDs, confirmation thresholds, and indexer behavior remain outside this encoding proposal.

No existing fixture, verifier, or sequencer behavior is changed by this draft. The current recovery verifier validates the historical sequencer/v0.8 commitments; implementing this proposed v0.9 batch hash requires a separate, explicitly approved implementation stage.
