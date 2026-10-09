# BTCS L2 Transaction Pool and Development Sequencer v0.14 Draft

Status: local development prototype specification. This is an in-memory
pending-transaction pool and an explicit local block-production control. It is
not a production sequencer, peer-to-peer mempool, Ethereum Mainnet service,
BTCS L1 bridge, or decentralized sequencing protocol.

## Existing execution profile

The pool reuses the v0.11 persistent processor and its EthereumJS `buildBlock`
and `runBlock` paths. Its execution profile is the fixed local `31337` EVM
chain ID, EthereumJS `10.1.3`, Osaka hardfork, and the existing Mainnet-derived
custom `Common`. Only signed EIP-1559 type-2 transactions are admitted. The
local block gas limit is 30,000,000, coinbase is zero, and the next block's
base fee is calculated from the canonical parent. These are prototype
settings; they do not assign a production BTCS L2 chain ID or define an
Ethereum-compatible network.

The pool calls the same canonical signed-transaction decoder used by block
construction. It checks the type envelope, canonical RLP round-trip, chain ID,
signature, sender recovery, Osaka transaction validation, intrinsic gas,
fee fields, local gas cap, and next-block base fee. The sender is always
recovered from the signature. No RPC field can nominate a sender.

## Admission and nonce policy

`eth_sendRawTransaction` accepts one `0x`-prefixed, even-length byte string.
The decoded transaction may be at most 131,072 bytes. Wrong encoding, an
unsupported transaction type, a wrong chain ID, an unsigned or invalid
signature, a gas/fee violation, or a transaction that cannot be admitted
returns a transaction-rejected error. A byte-identical or hash-identical
pending transaction is rejected as a duplicate.

For an account at canonical nonce `n`, the first pending transaction must use
nonce `n`; each further transaction must be the next contiguous nonce. Gaps
are rejected rather than queued. Admission reads the verified canonical state
and requires the transaction's maximum upfront exposure
(`gasLimit * maxFeePerGas + value`) plus the exposures of that sender's pending
transactions to fit the canonical balance. This conservative reservation can
reject a transaction that might fit after actual gas refunds; it avoids
accepting an unaffordable sequence that later prevents block construction.

A same-sender, same-nonce transaction may replace its pending predecessor only
when both `maxFeePerGas` and `maxPriorityFeePerGas` increase by at least 10%
(rounded up, with a minimum increase of one wei). The existing transaction
remains if replacement validation or capacity checks fail. A successful
replacement removes the prior hash from the in-memory pool; its sender/nonce
replacement outcome is specified here because standard
`eth_sendRawTransaction` returns only the new transaction hash.

## Bounds and storage

| Limit | Value |
|---|---:|
| Raw signed transaction | 131,072 bytes |
| Pending transactions | 1,024 |
| Total serialized pending bytes | 15,728,640 bytes (15 MiB) |
| Pending transactions per sender | 64 |
| Local block gas limit | 30,000,000 |
| Transactions per block | 4,096 (the pool cap is lower) |

The 15 MiB pool byte cap leaves room for RLP block-list/header overhead below
the block processor's 16 MiB serialized-block parser cap. The pool exists only
in memory for one RPC server process. It does not write
pending transactions to the chain store. Restarting or closing the server
discards every transaction that was not confirmed in canonical history.
There is no eviction policy: capacity is rejected, replacements follow the
rule above, and explicit block production reports included and reconciled
pending hashes. The RPC uses the fixed limits in the table; direct test
construction may lower these limits but cannot raise them. The pool does not
store keys or sign transactions.

Admission replays and verifies the canonical history to obtain current sender
state. The sequencer serializes pool operations, so a long chain or a burst of
submissions can make local RPC requests slow. Existing HTTP concurrency limits
apply, but there is no request-rate limit or admission-work budget.

## Deterministic selection and explicit production

Pending transactions are grouped by recovered lowercase sender address. For
each sender, nonces remain ascending. The selector visits senders in
lexicographic address order and takes at most the next transaction from each
sender per round. This round-robin pass repeats while transactions fit. It
does not prioritize fee tips. Before selection it rechecks canonical sender
nonces, balances, and next-block fee caps. A transaction whose nonce has
already been consumed, whose fee cap is now below the next base fee, or whose
sender's remaining contiguous sequence is invalid is removed with a reason
reported by the explicit mining result.

To ensure the selected set fits without predicting EVM gas use, the selector
conservatively requires the sum of selected transaction gas limits to remain
at or below 30,000,000. This may leave block gas unused. A transaction that
does not fit does not prevent other senders' smaller transactions from being
selected; later nonces from that same sender remain behind it.

No timer or background task creates blocks. With the opt-in
`--dev-sequencer` server flag, a local caller explicitly invokes
`btcs_dev_mine` with no parameters. The method builds one block, including an
empty block when no transaction is eligible, at parent timestamp plus one.
It uses the existing processor; reverts are included as status-zero receipts
with protocol gas and nonce effects.

The sequencer verifies the resulting block through a fresh canonical replay.
It removes included transactions only after their block is verified canonical.
If persistence reports failure after the tip advanced, it reopens the
canonical view and treats the block as committed only if parent, height,
ordered transactions, and the resulting tip identify the attempted block.
Pre-tip failures leave transactions pending. When an unrelated canonical
advance makes pending entries stale, `btcs_dev_mine` reports discarded hashes
and reasons in its result before producing the next block.

The persistence layer assumes a single writer per chain directory. The pool
does not make concurrent writers safe. If the canonical tip changed outside
this sequencer, submission pauses with a reconciliation error; the next
explicit `btcs_dev_mine` replays and reconciles the pool.

## RPC enablement and errors

The RPC listener remains fixed to `127.0.0.1`. Transaction submission and
`btcs_dev_mine` are unavailable by default. The CLI requires the explicit
`--dev-sequencer` flag to create the pool and expose either method. This flag
does not enable a public listener, automatic block production, or external
broadcasting.

| Code | Meaning |
|---:|---|
| `-32601` | Development sequencer is disabled, or method is unknown. |
| `-32602` | Malformed RPC parameters or raw transaction hex. |
| `-32005` | Request or pending-pool limit exceeded. |
| `-32010` | Transaction rejected, duplicate, invalid, nonce gap, or insufficient balance. |
| `-32011` | Replacement fee bump is below the required threshold. |
| `-32012` | Canonical tip changed; explicit pool reconciliation is required. |
| `-32013` | Explicit local block production failed before canonical commit. |
| `-32000` | Canonical history failed verification. |

`eth_sendRawTransaction` returns a hash only after successful in-memory pool
admission. It does not imply execution, durable storage, inclusion, or
settlement. `btcs_dev_mine` returns the verified block fields, included
transaction hashes, and any discarded pending hashes with reasons.

## Deferred

Pending-pool persistence, peer discovery, network propagation, fee-based
priority, transaction expiry, account-abstraction transactions, blob or
deposit transaction types, public RPC, RPC authentication, rate limiting,
consensus/fork choice, reorganization handling, rollup proofs, data
availability, withdrawals, and BTCS L1 settlement are not implemented.
