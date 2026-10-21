# BTCS L2 local EVM harness and v0.11 block processor

This directory contains the isolated v0.10 in-process EVM harness and a separate v0.11 local persistent block processor. Neither is a production sequencer, RPC server, rollup, proof system, or BTCS settlement client. The existing transfer executor and v0.9 settlement profiles remain separate and unchanged.

## Pinned environment

- Node.js `24.17.0` and npm `11.13.0` were used for this checkpoint. Use Node `>=24.17.0 <25` to satisfy the harness pin and EthereumJS's Node `>=20` requirement.
- EthereumJS packages are pinned at `10.1.3`; hardfork is fixed to stable `Osaka`. Do not change the hardfork without changing the explicit execution configuration and replay vectors.
- `solc` is pinned to `0.8.37`; its transitive `tmp` dependency is overridden to `0.2.7` because the compiler's published `0.2.6` dependency is affected by a high-severity path-traversal advisory. Keep the override while using this compiler pin.
- The compatible v10 trie package is `@ethereumjs/mpt`. The older `@ethereumjs/trie` v6 line depends on EthereumJS util v9 and is not part of this v10 package set.
- The custom `31337` chain inherits EthereumJS Mainnet chain parameters, then pins Osaka and overrides the chain ID. This is an execution harness configuration, not a fully specified BTCS L2 chain. Transactions are serialized and parsed again under the harness `Common`; a caller-supplied transaction `Common` cannot select gas parameters or signature recovery behavior.
- Solidity compiler is pinned to `solc` `0.8.37`; the source sets `evmVersion: "osaka"`, disables optimization, and removes bytecode metadata. The generated artifact is local and ignored by Git.
- The numeric EVM chain ID `31337` is development-only. The v0.9 settlement profile's `regtest-l2` identifier is unchanged and is not a production chain assignment.

## Reproduce

From this directory, with the pinned Node/npm runtime on `PATH`:

```sh
npm ci
npm run typecheck
npm run compile:contracts
npm test
npm run demo
npm run demo:client
```

`npm run compile:contracts` compiles `contracts/Counter.sol` and writes `artifacts/Counter.json`. Tests compile the same pinned Solidity source in memory, execute signed EIP-1559 transactions, and compare transaction roots, state roots, receipts, gas, and logs across fresh runs.

`npm run demo:client` runs the one-command local client demonstration described in [One-command client demo](#one-command-client-demo) and prints a single JSON summary. Run `npm run --silent demo:client` to put only that JSON on stdout.

## v0.11 local block processor

The protocol and storage assumptions are specified in
[`docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md`](../../docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md).
`src/blockProcessor.ts` builds blocks with EthereumJS `buildBlock`, verifies
them with a separate `runBlock` replay from the fixed genesis, and stores
content-addressed EthereumJS RLP blocks plus recomputable receipt/outcome
sidecars. `chain.json` is the atomic canonical-tip pointer. Reopening replays
the canonical ancestry to rebuild in-memory state and verifies transaction,
receipt, request, and state roots plus the sidecars.

The profile uses EVM chain ID `31337`, fixed Osaka execution, type-2 signed
transactions in caller-supplied order, a 30,000,000 block gas limit, EIP-1559
base-fee calculation, zero coinbase, and a fixed public test allocation. It
does not implement Ethereum fork choice, proposer consensus, peer-to-peer
validation, external state snapshots, network access, or BTCS L1 settlement.
It is a local chain format containing EthereumJS block/header encodings; the
custom chain rules do not make it an Ethereum-network-compatible chain.

The local parser caps serialized block RLP at 16,777,216 bytes, a JSON block
record at 67,108,864 bytes, and transactions per block at 4,096. Processes that
share one chain directory coordinate through `.btcs-l2-chain-write.lock`.
Initialization, canonical writes, read snapshots, checkpoint export, and full
deposit recovery take the lock and refresh `chain.json` before proceeding. The
default wait limit is five minutes and can be changed with
`chainDirectoryLockTimeoutMs` when opening the processor. This requires a local
filesystem with reliable exclusive file creation, atomic rename, and sync; it
does not support multi-host or distributed-filesystem coordination. A detected
stale or malformed lock fails closed. After a crash, verify that the recorded
owner is stopped and remove the lock file manually; stale locks are never
removed automatically. Content-addressed block files written before a failed
tip update are ignored unless reachable from the canonical tip. Reopening
follows only the ancestry named by `chain.json` and reexecutes it from genesis;
it does not scan unrelated records or detect corruption in orphans. The
synchronous `processor.tip` getter is the last tip refreshed by that instance;
use an asynchronous read view before relying on a tip another process may have
advanced.

Each record and the tip metadata is written through a same-directory temporary
file, file `fsync`, atomic rename, and containing-directory `fsync`. The block
record is synced before tip replacement. This depends on the host filesystem's
rename and sync behavior and is not a production durability claim. Simulated
fault-injection tests cover temporary-file open/partial-write/completed-write/
sync, record rename and directory sync, pre-tip failures, tip rename/sync, and
failure after the tip has committed.
An append that reports an error after tip replacement may already be canonical;
reopen and replay before retrying. Tests inject exceptions and reopen stores;
they do not simulate physical power loss or kill the process at each instruction.

If `chain.json` is missing, the processor initializes an empty store or restores
the metadata only when the sole existing record exactly matches fixed genesis.
It rejects missing metadata when later block records exist. Corruption or an
unsupported schema on the selected canonical ancestry fails closed without
repairing history. Leftover temporary files are ignored. The tip is not
authenticated outside this local store, so a writer able to replace both
metadata and records could substitute another internally valid chain.

## v0.12 RPC and v0.14 development sequencer

The read-only RPC is specified in
[`docs/BTCS-L2-RPC-v0.12-DRAFT.md`](../../docs/BTCS-L2-RPC-v0.12-DRAFT.md).
The opt-in transaction pool and development sequencer are specified in
[`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md`](../../docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md).
With the pinned Node.js runtime, start it against an isolated local chain
directory:

```sh
npm run rpc -- --datadir /tmp/btcs-l2-local-rpc --port 8545
```

The server listens only on `127.0.0.1` and accepts HTTP `POST /` requests from
loopback with a matching `localhost` or `127.0.0.1` Host header. It sends no
CORS permission. A newly selected empty data directory is initialized with the
fixed local genesis. `SIGINT` and `SIGTERM` stop the server and close open
connections. Do not expose this development interface on a network.

For example, in another terminal:

```sh
curl -sS http://127.0.0.1:8545/ \
  -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'
```

Implemented methods are `web3_clientVersion`, `eth_chainId`,
`eth_blockNumber`, `eth_getBlockByNumber`, `eth_getBlockByHash`,
`eth_getTransactionReceipt`, `eth_getCode`, `eth_getStorageAt`,
`eth_getBalance`, `eth_getTransactionCount`, and `eth_getLogs`. The RPC reads
only canonical history and replays it from genesis once per HTTP request that
needs chain data. Requests in one JSON-RPC batch share that validated
in-memory view; separate requests and store reopens always replay again. The
view holds the replayed blocks and execution state in memory until its request
finishes. At most four HTTP requests are active at once, which bounds the
number of simultaneous replay views. Long histories still increase query
time and memory use, and there is no request-rate or per-query work limit.
The default server is read-only. To explicitly enable the in-memory signed
transaction pool and manual block production, start it with:

```sh
npm run rpc -- --datadir /tmp/btcs-l2-local-rpc --port 8545 --dev-sequencer
```

With that flag, `eth_sendRawTransaction` validates and queues a signed type-2
transaction without executing or committing it; a local developer must
explicitly call `btcs_dev_mine` to build one block. Blocks are not produced in
the background. The pool accepts up to 1,024 transactions, 15 MiB of serialized
pending bytes, 64 transactions per sender, and 128 KiB per transaction. Pending
transactions exist only in process memory and are lost on restart. No key is
stored and nothing is broadcast. Without `--dev-sequencer`, both methods return
method-not-found. `eth_call`, full Ethereum JSON-RPC compatibility,
authentication, remote access, and production availability are not provided.

<a id="one-command-client-demo"></a>

## One-command client demo (`demo:client`)

`npm run demo:client` is a self-contained, reproducible client-facing
demonstration. On a fresh temporary data directory it starts the local chain and
the loopback RPC (`src/rpc.ts`), deploys `contracts/Counter.sol` with a signed
type-2 transaction, calls `increment()`, calls `incrementThenRevert()` (a
reverted transaction), and makes a signed value transfer. It then mines one
block with `btcs_dev_mine` and reads code, storage, balances, receipts, nonces,
and logs back through the JSON-RPC methods, builds a genesis-starting settlement
batch from the canonical block RLP, verifies it with
`verifyEvmSettlementBatchExecution`, writes the batch file, and prints one
machine-readable JSON summary. Any failed assertion exits nonzero with a message
on stderr.

```sh
npm run demo:client
npm run --silent demo:client   # only the JSON summary on stdout
npm run demo:client -- --datadir /tmp/btcs-l2-client-demo --batch-out /tmp/btcs-l2-client-demo/batch.json
```

`--datadir <path>` uses a persistent data directory instead of a temporary one
(the temporary directory is removed on exit). `--batch-out <path>` chooses where
the settlement batch file is written. Without `--batch-out`, the batch file is
written to a fresh artifact directory that is kept after exit, so the summary's
`batchFilePath` always names an existing file; remove that directory yourself
when you no longer need the artifact. The summary's `settlement.batchHash` equals
the batch hash reported by the standalone verifier:

```sh
npm run verify:batch:execution -- <batch-file> 0000000000000000000000000000000000000000000000000000000000000000 0x0000000000000000000000000000000000000000000000000000000000000000 0
```

What this proves: a local BTCS L2 EVM chain runs with no BTCS Core node; a
contract deploys and mutates state; signed transactions, receipts, logs, code,
storage, and a transferred balance are visible through the RPC; a reverted
transaction keeps status `0` with rolled-back storage and logs while its nonce
and gas effects remain; and the independent settlement replay accepts the
emitted batch file. What it does not prove: `eth_call`/`eth_estimateGas`,
automatic mining, withdrawals or production balance semantics, remote RPC, any
L1 publication, settlement, or finality, or any production sequencer, rollup,
proof system, or BTCS settlement client.

<a id="regtest-deposit-settlement-e2e"></a>

## Regtest deposit-to-settlement E2E (`e2e:deposit`)

`npm run e2e:deposit` runs `scripts/regtest-deposit-settlement-e2e.ts`. Unlike
`demo:client`, it requires a **separately started** BTCS Core regtest node and
never starts, initializes, or repairs one itself. It exercises the Stage 4 path:
a real L1 regtest deposit transaction is mined, verified through the local Core
RPC, recorded durably, credited on a local BTCS L2 chain, and replayed through a
settlement v2 batch plus an independent re-execution.

### Prerequisites

- A dedicated BTCS Core regtest node running with its own data directory
  (default `~/.local/share/btcs-l2-deposit-regtest-20261011`).
- The `bitcoinsilver-cli` binary (default
  `~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli`) pointed at the
  same data directory and RPC port the node was started with.
- A readable RPC cookie at `<datadir>/regtest/.cookie`, which Core writes on
  startup.

### Environment-variable overrides

| Variable | Default | Purpose |
|---|---|---|
| `BTCS_CORE_CLI` | `~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli` | CLI binary path |
| `BTCS_L1_REGTEST_DATADIR` | `~/.local/share/btcs-l2-deposit-regtest-20261011` | Core data directory (must already exist) |
| `BTCS_L1_RPC_PORT` | `29445` | Core RPC port (integer 1-65535) |
| `BTCS_L1_RPC_COOKIE_PATH` | `<datadir>/regtest/.cookie` | RPC cookie path |

### Fail-fast, non-destructive preflight

Before the first mining operation or transaction construction, the runner
checks, in order, that the CLI exists and is executable, the data directory
already exists (the runner never creates or initializes it), the RPC cookie is
readable and syntactically valid, the Core RPC is reachable with the configured
CLI, data directory, and port, and `getblockchaininfo` reports exactly
`chain=regtest`. Any failure exits nonzero with a concise, actionable message.
The RPC cookie contents are never printed or logged.

### Start the dedicated node (you run these)

Verify the flags with `bitcoinsilverd -help`; the daemon accepts both `-regtest`
and `-chain=regtest`. `-fallbackfee` is needed on a fresh regtest node so
`fundrawtransaction` can estimate a fee:

```sh
~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilverd \
  -regtest -daemon \
  -datadir="$HOME/.local/share/btcs-l2-deposit-regtest-20261011" \
  -rpcport=29445 -rpcbind=127.0.0.1 -rpcallowip=127.0.0.1 \
  -server -fallbackfee=0.0002
```

Then run the E2E:

```sh
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
npm run e2e:deposit
```

### Expected side effects

- Mines 201 regtest blocks to create spendable test coins (BTCS Core's
  coinbase maturity is 200 blocks), broadcasts one
  regtest deposit transaction, then mines 2 further confirmation blocks.
- Persists the dedicated Core data directory, the `btcs-l2-deposit-e2e`
  wallet, and its cookie across runs; the runner does not delete them.
- Uses a temporary L2 scratch directory for the local chain, deposit store, and
  replay work and removes it on exit, including on failure.
- Writes nothing inside the repository.

### Safe shutdown (only the test daemon)

```sh
~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli \
  -regtest -datadir="$HOME/.local/share/btcs-l2-deposit-regtest-20261011" \
  -rpcport=29445 stop
```

Recorded live run: [regtest deposit-to-settlement results](../../docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md).

### Unresolved issues

L1 deposit verification uses a trusted local Core RPC; it is not a trustless
inclusion proof. Automatic, in-place adoption of a re-derived chain and
automatic attribution of an EVM spend to a specific credit remain **not**
implemented; see the deposit reorg accounting and recovery sections below. When
a descendant transaction depended on a removed credit, recovery fails closed and
the chain store is frozen. Withdrawals, production escrow, and data availability
are also out of scope.

<a id="deposit-reorg-accounting"></a>

## Deposit reorg accounting (`depositReorgAccounting`)

`src/depositReorgAccounting.ts` specifies and tests the bridge accounting
invariant `creditedWei <= securedWei` over confirmed L1 deposit records and
canonical L2 deposit credits, and classifies each timing of an L1 reorg relative
to L2 credit and spend:

```sh
npm test   # includes tests/depositReorgAccounting.test.ts
```

The module is deliberately conservative and honest about its limits:

- `calculateDepositAccounting` reports `unbacked-credit`, `amount-mismatch`,
  `duplicate-credit`, and `over-credit`; a violation sets `progressBlocked`.
- `classifyDepositReorg` maps reorg-before-credit to `invalidate-l1-only`,
  after-credit-before-spend to `revert-l2-credit`, after-spend to
  `freeze-bridge` (the whitepaper's defined invalid state), and re-inclusion to
  `no-op` or `credit-l2-once`.
- Canonical replay traces top-level and nested native-value transfers, sender
  fees, and selfdestructs. `assessCreditSpend` reports `outflow-observed`,
  `no-outflow-observed`, or `unknown`; `classifyCanonicalDepositReorg` freezes
  on observed or unknown outflow and allows re-derivation only after a complete
  trace reports no post-credit outflow.

This is conservative address-level evidence, not source-specific attribution
among fungible credits: spending from an address can freeze recovery even when
pre-existing or later funds covered the outflow. Recovery still requires an
operator invocation, and cross-process writer/recovery coordination is not
implemented. This does not make the bridge trustless or production-safe. See
`docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md`.

<a id="deposit-reorg-recovery"></a>

## Deposit reorg recovery (`depositReorgRecovery`)

`src/depositReorgRecovery.ts` closes the gap left by the accounting module for
the recoverable case: it re-derives canonical L2 state after one or more credited
deposits cease to be canonical.

```sh
npm test   # includes tests/depositReorgRecovery.test.ts
```

`rederiveCanonicalL2AfterDepositInvalidation({ canonicalView, invalidatedDepositIds, outputDirectory })`:

1. Replays the untouched canonical prefix (heights before the earliest
   invalidated credit) into a fresh store with `PersistentBlockProcessor.acceptBlock`.
2. Rebuilds every block from that height through the tip with
   `buildNextBlock`, removing only the invalidated deposit operations.
3. Verifies no invalidated credit remains in the re-derived chain.

It uses only the existing, verified block import and production primitives, so
the re-derived chain is subject to the same header/state-root/execution checks
as the canonical chain. It never mutates the source store.

### Fail-closed behavior

If a rebuilt block can no longer execute — typically because a later transaction
spent the removed credit — re-derivation throws a typed
`DepositReorgRecoveryError` (`rebuild-failed`, `residual-credit`, or
`output-directory-not-usable`) and the partial output store is removed. No
replacement chain is fabricated.

`recoverDepositReorg({ processor, invalidatedDepositIds, outputDirectory })`
coordinates operator recovery under the source processor's in-process queue and
OS chain-directory lock. It captures a fresh canonical view under both locks.
When a requested deposit is credited, it writes the fail-closed gate and keeps
both locks through re-derivation and adoption. Competing processes wait and then
see the recovered chain or the persisted gate. An extension that commits first
is included in the recovery view.

### Enforced gate

The gate is enforced in both public canonical tip-advancing entry points of
`PersistentBlockProcessor`: `buildNextBlock` (including the RPC `btcs_dev_mine` →
`DevelopmentSequencer` path) and the `acceptBlock` block-import path. The private
`appendBlockUnlocked` primitive they share is reachable only through those gated
methods, so there is no ordinary way to extend a frozen store. While frozen, both
methods throw `DepositRecoveryGateError`, and the freeze persists across a
process reopen. An invalid or unreadable gate marker fails closed on both paths.

Gating `acceptBlock` does not block legitimate replay: settlement verification,
the E2E independent replay, and this module's re-derivation all import into a
separate fresh store, which has no gate marker and is therefore open. The
operator recovery flow copies verified re-derived records into the frozen
source, commits the new canonical tip by atomically replacing `chain.json`, and
clears the gate only after that commit. A pre-commit failure leaves the previous
tip frozen and the candidate store available for retry. The file lock coordinates
cooperating processes on one local filesystem. It does not provide multi-host
leases or protect against direct filesystem edits.

**Still partial:** source-specific attribution among fungible credits,
automatic L1 watcher action, and multi-host coordination. See
`docs/DEPOSIT-REORG-RECOVERY-v0.1.md`.

## Fixed execution assumptions

- Genesis allocates `10,000` native units (18 decimals) to one deterministic, test-only private key (`0x11` repeated 32 bytes). This key is public test data and must never hold real assets.
- VM precompiles are enabled. The only genesis allocation is the funded test sender; no BTCS assets or accounts are imported.
- The fixed sample block is number `1`, timestamp `1,750,000,000`, gas limit `30,000,000`, base fee `1 gwei`, zero difficulty, zero coinbase, zero `mixHash`/`prevRandao`, zero blob gas used and excess blob gas, and a zero parent beacon block root. Header-only fields use explicit deterministic empty values: empty-trie roots for withdrawals, transactions, and receipts; SHA-256 of empty bytes for requests; empty extra data; and an all-zero nonce. These are local test inputs, not proposed production economics.
- Only signed EIP-1559 type-2 transactions are admitted. The harness checks their type and chain ID, signature, sender recovery, intrinsic gas, and fee cap under the pinned Osaka `Common`. Osaka's EIP-7825 limit caps each transaction's `gasLimit` at `16,777,216`; EIP-3860 caps contract creation initcode at `49,152` bytes. The sample block gas limit is `30,000,000`. EthereumJS `runTx` checks the sequential nonce, available balance, per-transaction block gas limit, and EVM execution. The harness also enforces Osaka's block inclusion rule `tx.gasLimit + prior gasUsed <= block.gasLimit`. The caller-provided array is executed in its supplied order; it is never sorted.
- A valid transaction that reverts or runs out of gas is included with status `0`: EVM storage writes and logs roll back, while the sender nonce and protocol gas charges remain. Invalid transactions, such as a wrong chain ID, nonce, signature, intrinsic gas, fee cap, or insufficient upfront balance, are rejected and do not produce an execution report.
- `transactionsTrieRoot` is the Ethereum transaction-trie root over ordered, signed typed transaction bytes, computed with EthereumJS's helper. `stateRoot` and per-transaction state roots are Ethereum Merkle state-manager roots captured after transaction processing, including committed nonce and fee effects of a reverted transaction. Receipt summaries expose status, gas, and logs; no receipts-trie root is computed. The temporary block context is not updated into a final block header, and no consensus-valid BTCS L2 block or settlement envelope is generated.
- Every EVM-visible field supplied by the v0.10 transaction harness is fixed or reported: chain ID, hardfork, number, timestamp, gas limit, coinbase, difficulty/`prevRandao`, base fee, and blob excess gas. Its isolated one-block helper still has no populated ancestor history. The v0.11 processor instead supplies canonical ancestor hashes to `BLOCKHASH` and runs Osaka system/request processing through the EthereumJS block builder and verifier. Its custom genesis contains no beacon-root or history-storage system-contract code, so EthereumJS's corresponding state writes are no-ops. Inherited deposit/withdrawal/consolidation request handling uses Mainnet-derived parameters and has no BTCS L1 meaning.
- The v0.10 `executeOrderedTransactions` helper still has no application-level transaction-array or serialized-input limit. The v0.11 block processor adds the local parser caps described above. The v0.12 RPC bounds request/body shape, log-query size, and concurrent requests, but has no request-rate limit or aggregate CPU/work budget; each HTTP request that reads chain data replays the canonical history.
- The tests compare the complete per-transaction summaries, receipts/logs, gas, and roots in a fresh replay. That establishes repeatability for these pinned local vectors, not deterministic consensus execution across independent implementations or arbitrary contract inputs.

The repository has no root license file, and the sample Solidity contract is marked `UNLICENSED`. The project's license and permission to redistribute that source are unresolved. EthereumJS package licensing and distribution implications must also be reviewed before publishing or distributing the harness.

## Direct dependency licenses

The pinned package manifests declare `@ethereumjs/vm`, `tx`, `statemanager`, `mpt`, `rlp`, `block`, and `util` as MPL-2.0; `@ethereumjs/common` declares MIT. `@noble/hashes`, `solc`, `tsx`, and `@types/node` declare MIT; TypeScript declares Apache-2.0. The installed `@ethereumjs/mpt` package declares MPL-2.0 but does not include a top-level license file. The workspace is marked `private` to prevent accidental npm publication and has no project-level license grant. Before external distribution, retain third-party notices and review the actual licenses. MPL 2.0 permits larger works under other terms but requires distribution obligations for covered files and modifications; this note is not a project-wide license decision.
