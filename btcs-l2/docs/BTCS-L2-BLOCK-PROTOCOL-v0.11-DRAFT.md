# BTCS L2 Block Protocol v0.11 (Local Prototype Draft)

**Status:** implementation target for an isolated local prototype; not a production
network specification. This document defines the block processor and its local
store. It does not amend BTCS L1, v0.9 settlement, or the legacy transfer executor.

## 1. Protocol layers and names

This prototype has three distinct layers:

1. **EthereumJS execution:** `@ethereumjs/vm`, `@ethereumjs/block`, and the other
   pinned EthereumJS `10.1.3` packages execute transactions and produce the
   transaction trie, typed receipt trie, state trie, and Osaka-shaped header.
2. **BTCS L2 local-chain rules:** this document fixes the chain ID, genesis,
   accepted transaction type, transaction order, block context, canonical tip,
   persistent record format, and replay procedure.
3. **Future BTCS L1 settlement/data availability:** no L1 commitment, proof,
   publication, DA guarantee, withdrawal, or bridge behavior is defined here.
   Nothing in this prototype changes BTCS L1 consensus or makes L1 verify these
   blocks.

The stored body uses EthereumJS's RLP block serialization and the header hash is
EthereumJS's Keccak-256 hash of the Osaka header RLP. The *chain protocol and
store are custom BTCS L2 prototype formats*: they have no Ethereum consensus,
fork-choice, peer-to-peer, execution-payload, or consensus-layer validation and
must not be described as Ethereum-network-compatible blocks.

## 2. Chain identity and fixed genesis

The prototype profile is `btcs-l2-local-v0.11-osaka`, with numeric EVM chain ID
`31337` (development only). It is not a production network assignment and is
not a replacement for the v0.9 settlement profile's `regtest-l2` string.
Execution uses the `osaka` hardfork selected directly in the pinned Common; it
does not select a fork from input block timestamps.

Genesis is block number `0` and is defined by these exact inputs:

| Item | v0.11 local prototype value |
|---|---|
| Parent hash | 32 zero bytes |
| Timestamp | `1749999999` Unix seconds |
| Gas limit | `30000000` |
| Base fee | `1000000000` wei |
| Coinbase | 20 zero bytes |
| Difficulty, mix hash/prevRandao | `0`, 32 zero bytes |
| Nonce, extra data | 8 zero bytes, empty bytes |
| Transactions, withdrawals, uncles | Empty lists |
| Transaction and receipt roots | Ethereum empty-trie root (`keccak256(rlp(empty))`) |
| Logs bloom | 256 zero bytes |
| Blob gas used, excess blob gas | `0`, `0` |
| Parent beacon block root | 32 zero bytes |
| Requests root | SHA-256 of empty bytes, as produced by the pinned EthereumJS block helper for the empty request list |
| Initial native balance | `10000000000000000000000` wei at the address derived from the documented public test key `0x11` repeated 32 bytes |
| Precompiles | EthereumJS active precompiles are initialized using its `activatePrecompiles` test option; their resulting account entries are part of this prototype's genesis state |

The genesis state root is calculated from that allocation and precompile setup by
the EthereumJS state manager. It is not a hand-authored constant. The public test
key is test data and must never hold real assets. No other accounts, bytecode,
storage, or assets are allocated at genesis. In particular, this genesis does
not install Ethereum Mainnet beacon-root or history-storage system-contract
code.

The genesis block is serialized and hashed with the same pinned Osaka header
rules as subsequent blocks. The store records a genesis-configuration digest;
opening a store under a different profile, chain ID, hardfork, or genesis
configuration is an error.

## 3. Block context and transaction inclusion

For every non-genesis block:

- `number` is exactly `parent.number + 1`, at most `9007199254740991` (the
  JavaScript safe-integer ceiling required by EthereumJS's `BLOCKHASH` lookup);
  `parentHash` is exactly the parent's EthereumJS header hash. Timestamps fit
  unsigned 64-bit values. A timestamp is explicitly supplied, strictly greater than its
  parent's timestamp, and never read from the wall clock.
- `gasLimit` is exactly `30000000`; it is a local-chain constant, not adjusted
  by Ethereum's dynamic gas-limit rule.
- `baseFeePerGas` is calculated by EthereumJS's EIP-1559 `calcNextBaseFee()`
  from the parent header. Thus the first child of the empty genesis has a base
  fee of `875000000` wei. The builder does not accept a caller override.
- `coinbase` is the zero address; `difficulty`, `mixHash`/`prevRandao`, and
  nonce are zero, and `extraData` is empty. The custom chain has no proposer
  election, seal, mining reward, or block reward. EthereumJS transaction tips
  are credited according to its PoS execution rules to the fixed zero-address
  coinbase; this is prototype accounting, not an economic policy.
- Withdrawals are always the empty list. Blob transactions are not admitted;
  blob-gas-used is zero and excess blob gas follows the pinned EthereumJS
  `calcNextExcessBlobGas()` rule. The parent beacon block root is always zero.
  EthereumJS computes the EIP-7685 requests root from block execution.
- Every accepted transaction is a signed EIP-1559 type-2 transaction for chain
  ID `31337`. Its serialized bytes are decoded again under the processor's
  pinned Common before signature/sender recovery, field validation, intrinsic
  gas, fee, balance, and nonce checks. No caller-supplied transaction Common is
  trusted. A transaction must have `maxFeePerGas >= block.baseFeePerGas`.
- The input transaction array is the block's canonical order. It is never
  sorted or normalized. Each transaction is executed once in that order. The
  sender nonce must match the state at its position in the block. EthereumJS
  applies Osaka transaction validation and the EIP-7825 maximum transaction
  gas limit of `16777216`; its BlockBuilder applies the active block gas
  reservation rule and the fixed block gas limit. Invalid transactions reject
  the candidate block. A valid transaction that reverts or runs out of gas is
  included with receipt status `0`, and protocol nonce/fee/gas effects remain.

The processor also rejects more than `4096` transactions in one block before
execution. This parser/work cap is intended to sit above what can fit under the
current fixed block gas limit and Osaka intrinsic-gas/refund rules. The local
implementation rejects inputs above this cap even if an EthereumJS block body
could otherwise encode them. A future network-facing ingestion boundary must
still define total-work and request-rate limits before accepting untrusted
peer or RPC input.

## 4. Roots, receipts, logs, and block hash

The block is assembled with EthereumJS `buildBlock` and independently executed
with `runBlock`; no custom hash is substituted for an Ethereum execution root.

- **Transaction root:** Ethereum Merkle-Patricia trie root over each canonical
  signed transaction envelope, keyed by `RLP(transactionIndex)`, in supplied
  order. The pinned EthereumJS transaction-root helper performs this encoding.
- **Receipt root:** Ethereum Merkle-Patricia trie root over each encoded receipt,
  keyed by `RLP(transactionIndex)`. The value is the EIP-2718 type byte followed
  by the RLP receipt payload for type-2 transactions: status, cumulative gas
  used, 256-byte logs bloom, and logs. EthereumJS's `encodeReceipt` and block
  builder define this encoding.
- **Post-state root:** EthereumJS Merkle state-manager root after all block
  transactions and the active EthereumJS block-level system/request processing
  have completed.
- **Block hash:** Keccak-256 of RLP of all header fields active under pinned
  EthereumJS Osaka (`parentHash` through `nonce`, plus London base fee, Shanghai
  withdrawals root, Cancun blob fields and parent beacon root, and Prague
  requests hash). The header commits to body transactions and receipts through
  their roots. Osaka adds no later experimental Amsterdam header fields.
- **Receipt:** status is `1` for success and `0` for included execution failure;
  cumulative gas and logs are produced by EthereumJS. Reverted EVM writes and
  logs roll back, while transaction-level nonce and fee effects remain.

Receipts are not part of Ethereum block-body RLP. The local persistence record
therefore stores EthereumJS's encoded receipt bytes and a per-transaction
execution summary alongside the serialized block as verification sidecars.
They are recomputed during replay and compared byte-for-byte; the receipt root
is still the canonical commitment in the header. The sidecars are not a second
consensus root.

## 5. Persistent format and canonical tip

The local store is a directory with:

- `chain.json`: UTF-8 JSON envelope with format identifier
  `btcs-l2-local-chain`, `schemaVersion: 1`, protocol/profile ID, numeric chain
  ID, selected hardfork and EthereumJS version, genesis-configuration digest,
  genesis hash, canonical height, and canonical tip hash.
- `blocks/<lowercase 64-hex-digit block hash>.json`: one UTF-8 JSON record per
  content-addressed block with format identifier `btcs-l2-block-record`,
  `schemaVersion: 1`, height, `blockRlpHex`, ordered `receiptRlpHexes`, and
  ordered execution summaries (transaction hash, status, gas used, cumulative
  receipt gas, return data, created address if any, and normalized logs).

The record's block bytes are `Block.serialize()` RLP: header, ordered
transactions, empty uncles, and empty withdrawals. Hex is lowercase, `0x`
prefixed, and has no whitespace. JSON numeric protocol fields are decimal
strings to avoid JavaScript number precision loss. Object field order and JSON
whitespace are not consensus data; parsed schema fields and embedded canonical
RLP are.

The `chain.json` metadata envelope is limited to `65536` bytes. Canonical block
records retain the most recent `256` block hashes in memory for the EVM
`BLOCKHASH` opcode; older canonical blocks remain available from the store and
are still replayed from genesis.

To bound local parsing and filesystem work, this implementation accepts at
most `4096` transactions per block, `16777216` bytes of serialized block RLP,
and `67108864` bytes per complete JSON block record. These are local
implementation admission limits in addition to EthereumJS execution checks;
an oversized record is rejected before the canonical tip advances. They are
not Ethereum consensus rules. Any network protocol that uses this profile must
adopt these caps explicitly or replace them with jointly specified limits.

To append a block, first fully build and validate it in a scratch execution
instance. Each content-addressed record and `chain.json` is written to a
same-directory temporary file, file-synced, closed, and atomically renamed over
its target; the containing directory is synced after the rename. The block
record is completed before the canonical-tip write begins. This ordering makes
the metadata tip the sole canonicality pointer: a complete record not reachable
by parent hash from that tip is an orphan, not canonical. Existing content
addresses are checked for exact equality and never overwritten. A failure
before tip replacement leaves the old tip authoritative. A failure reported
after tip replacement may nevertheless mean the append committed; callers must
reopen or inspect/replay the store before retrying. The processor rereads valid
metadata after a failed tip write and updates its in-memory tip when the new
height and hash are already visible.

The prototype relies on same-filesystem atomic rename, file `fsync`, directory
`fsync`, and the host filesystem's implementation of those operations. It does
not provide a write-ahead log, cross-filesystem transaction, hardware power-loss
proof, or stronger durability guarantee. A crash after the tip rename but
before its directory sync can expose either the old or the new metadata after a
machine restart; either outcome is internally consistent because the block
record and its directory were synced first. If the new tip is visible, the
append may be present even though the original call did not return success.
Focused recovery tests inject exceptions before writing and at temporary-file
open, partial-write, completed-write, file-sync, rename, directory-sync, and
post-commit boundaries, then reopen temporary stores.
These are simulated failures, not process-kill or physical power-loss tests.

Replay begins at the metadata tip and follows parent hashes backward to the
fixed genesis, then independently executes that ancestry from genesis. It does
not scan all files in `blocks/`: unreachable records, including orphans, are
ignored, so corruption in an unrelated orphan is not detected by replay. A
missing, malformed, non-contiguous, unsupported, or mismatched record on the
selected ancestry rejects the store without repairing it or advancing the tip.
If `chain.json` is absent, initialization is allowed only when no block records
exist, or when the sole record is byte-for-byte the fixed genesis record (the
recoverable interrupted-genesis case). Missing metadata alongside later block
records is rejected rather than resetting the chain to genesis. Leftover
temporary files are ignored and are not treated as block records.

The processor serializes appends made through one instance. This prototype
assumes one writer process per store directory; it has no cross-process lock,
concurrent-writer protection, or fork-choice rule. Because the tip metadata is
the only chain selector and is not authenticated externally, a local actor able
to rewrite both block records and metadata can replace history with another
internally valid chain. Replay establishes consistency with this profile and
store, not authenticity against a malicious local writer. Unsupported schema
versions or protocol profiles are rejected; there is no implicit migration or
version fallback.

## 6. Replay and invalid-block handling

Replay starts from the fixed genesis allocation and block and visits only the
ancestry selected by `chain.json`. For each stored height in order it:

1. checks schema, profile, height, parent hash, timestamp monotonicity, and the
   exact local header policy above;
2. decodes the serialized block under the pinned Common and checks its ordered
   transaction trie and block structure using EthereumJS block validation;
3. executes it with EthereumJS `runBlock` (skipping only EthereumJS's generic
   blockchain-header validation, because the BTCS L2 parent/number/time policy
   is checked explicitly), and checks gas used, bloom, requests hash, receipt
   root, and post-state root;
4. compares recomputed ordered receipt bytes and execution summaries against
   the stored sidecars; and
5. checks the recomputed header hash against the record and canonical tip.

The processor supplies an in-memory block-hash lookup populated only by prior
canonical blocks, retaining the most recent `256`, so the EVM `BLOCKHASH`
opcode sees the correct prior hash within its range. Unknown, future, and
out-of-range heights return zero per EVM semantics.

Block building and candidate verification use scratch state. A candidate is
not persisted or made canonical until all validation and replay checks pass.
EthereumJS `runBlock` reverts its state checkpoint on execution or root
validation failure. Persistence failure before tip replacement leaves the old
canonical tip and state authoritative; reopening reconstructs state by replay.
Acceptance tests tamper stored headers, signed transaction bytes, receipt and
execution sidecars, parent hashes, and transaction/receipt/state roots. They
also test missing or mismatched tip records, malformed/truncated/oversized
metadata, unsupported schema versions, and genesis-only versus non-empty
missing-metadata recovery.

## 7. Osaka configuration, inherited parameters, and explicit limitations

`createCustomCommon` currently derives the chain from Ethereum Mainnet, changes
the name/chain ID to this local prototype, and selects stable `osaka` in
`@ethereumjs/common 10.1.3`. The active pre-Osaka rule sets include Berlin,
London, Merge, Shanghai, Cancun, and Prague changes; Osaka additionally
activates EIPs `7594`, `7823`, `7825`, `7883`, `7892`, `7939`, `7951`, and
`7918`. This includes EIP-1559 fees, typed transactions, withdrawals/blob
header fields, EIP-4788/2935/6110/7002/7251/7685/7702 behavior, EIP-3860
initcode metering, EIP-7825's transaction gas cap, and the other Osaka opcode,
precompile, and gas changes implemented by the pinned package. Experimental
Amsterdam EIPs are not active.

For this prototype, every Mainnet-derived parameter supplied by Common and
EthereumJS is explicitly adopted at the pinned Osaka selection, including gas
and precompile schedules, EIP-1559 parameters, blob schedule, and inherited
system-contract/request addresses. These are provisional defaults, not BTCS L2
economics. No Mainnet state allocation is imported. In particular, EthereumJS
system operations that update EIP-4788 beacon-root or EIP-2935 history storage
are deterministic no-ops when their system-contract code is absent from this
custom genesis. `BLOCKHASH` itself is served from the processor's explicit
canonical block map. EthereumJS's EIP-6110/7002/7251 request handling remains
enabled with its inherited Mainnet parameters and produces a requests root;
these requests have no BTCS L1 meaning here. Type-3 blob transactions and
withdrawals are not included by this local transaction/block policy. The
Mainnet-derived Osaka Common uses the Prague EIP-7691 blob schedule
(`blobGasPerBlob = 131072`, target `6` blobs / `786432` blob gas, maximum `9`
blobs / `1179648` blob gas, update fraction `5007716`); BPO1/BPO2 schedule
transitions are not selected by this fixed-Osaka profile.

Before a BTCS L2 network specification or settlement launch, the project must
explicitly choose/replace the inherited base-fee economics, gas schedule and
limits, blob policy, EVM chain ID, system-contract addresses and genesis code,
request semantics, randomness/coinbase policy, account/precompile genesis,
transaction types, timestamp/consensus rules, data availability, and settlement
commitment. A hash chain, local replay, and successful EVM execution do not
prove sequencer honesty, cross-client consensus, data availability, fraud
proofs, validity proofs, or BTCS L1 verification.

## 8. Version upgrades

`schemaVersion: 1` specifies the JSON store envelope above; protocol profile
`btcs-l2-local-v0.11-osaka` specifies the chain rules. A future store schema
change increments `schemaVersion`. Any change to genesis, accepted transaction
types, header fields, root encodings, EVM hardfork, execution parameters, or
block rules requires a new protocol profile and an explicit activation policy.
This milestone defines no in-place protocol upgrade or activation block.
