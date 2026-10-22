# BTCS L2 integrated prototype runbook

Status: draft, evidence-backed as of 2026-10-21. Scope: run the local
end-to-end prototype — L1 deposit → L2 EVM credit → settlement batch →
L1 batch-data publication → L1 anchor publication → independent reconstruction
— against local BTCS Core regtest. This runbook does not claim production,
trustless, or mainnet readiness.

## Components and artifacts

- EVM execution harness: `execution/evm` (`PersistentBlockProcessor`, token,
  transaction pool, RPC/dev sequencer).
- Deposit pipeline: `btcsL1DepositWatcher`, `btcsL1DepositStore`,
  `btcsL1DepositWorkflow`, `btcsL1CoreRpc`.
- Settlement: `settlementEnvelope`, `settlementBatch`, verification scripts.
- L1 publication: `btcsL1BatchData`, `btcsL1BatchDataAvailability`,
  `btcsL1Anchor`, `btcsL1Confirmation`, `btcsL1Publication*`.
- Recovery: `depositReorgAccounting`, `depositReorgRecovery`,
  `depositRecoveryGate`, `chainDirectoryLock`.

## Prerequisites

- Node pinned to v24.17.0:
  `export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"`.
- A local BTCS Core regtest daemon with a loaded wallet. The harness never
  starts or stops Core.
- `npm run typecheck` and `npm test` green before live runs.

## Environment caveats (observed 2026-10-21)

- `COINBASE_MATURITY = 200`. Any wallet used for spending must hold mature
  (confirmed) coinbase UTXOs; mine ≥ 201 blocks first.
- `e2e:batch-data` funds ~129 independent transactions with `minconf:1`, so the
  wallet must hold at least (fragments + 1) **confirmed** UTXOs. Unconfirmed
  change is excluded. A thinly-funded wallet fails partway with the misleading
  Core error `The total exceeds your balance when the … fee is included`, even
  though `getbalances.mine.trusted` is large and `listunspent` is empty.
- Fee source: `e2e:anchor` and `e2e:deposit` fund with no `fee_rate` and require
  a daemon started with `-fallbackfee` (or a working fee estimator). `e2e:batch-data`
  passes an explicit `fee_rate` and does not need `-fallbackfee`.
- After mining a block holding ~129 wallet transactions, the wallet RPC endpoint
  can exceed a 15s RPC timeout on slow builds; the batch-data harness now allows
  120s for `getnewaddress`/`getwalletinfo`.

## Step 0 — baseline

```
npm run typecheck
npm test
```

## Step 1 — real deposit-to-settlement E2E

```
BTCS_CORE_CLI="<core>/build-noipc/bin/bitcoinsilver-cli" \
BTCS_L1_REGTEST_DATADIR=<deposit-datadir> \
BTCS_L1_RPC_PORT=<port> \
npm run e2e:deposit
```

Exercises Core RPC, controlled deposit broadcast, active-chain discovery,
confirmation enforcement, exactly-once L2 credit, persisted/replayed EVM state,
and independent v2 settlement replay. Expected result: `PASS` with deposit txid,
inclusion height (≥ 2 confirmations), L2 block hash/height, recipient balance,
and matching state root.

## Step 2 — L2 execution demo (optional, no Core)

```
npm run demo:client
npm run verify:batch
npm run verify:batch:execution
```

Produces a batch file and independently verifies the settlement commitment and
re-execution.

## Step 3 — batch-data availability publication + reconstruction

```
BTCS_L2_BATCH_DATA_REGTEST_DATADIR=<core-datadir> \
BTCS_L2_BATCH_DATA_REGTEST_PORT=<port> \
BTCS_L2_BATCH_DATA_REGTEST_WALLET=<wallet-with-confirmed-utxos> \
npm run e2e:batch-data
```

Publishes canonical batch bytes as fragments plus the matching commitment,
mines a block, verifies active inclusion, and reconstructs the exact bytes.

Destructive reorg variant (disposable node only; gate-enforced):

```
BTCS_L2_BATCH_DATA_REGTEST_REORG_TEST=1 \
BTCS_L2_BATCH_DATA_REGTEST_PORT=29446 \
BTCS_L2_BATCH_DATA_REGTEST_DATADIR="$HOME/.local/share/btcs-l2-regtest-reorg-20261011" \
BTCS_L2_BATCH_DATA_REGTEST_WALLET=btcs-l2-reorg-test \
npm run e2e:batch-data
```

Invalidates the publication branch, confirms the scanner reports `incomplete`
with every expected tx orphaned, then re-includes the replacement branch and
verifies byte-exact reconstruction.

## Step 4 — anchor publication + durable recovery

```
BTCS_L2_REGTEST_PORT=<port> \
BTCS_L2_REGTEST_DATADIR=<core-datadir> \
BTCS_L2_REGTEST_WALLET=<wallet-with-confirmed-utxos> \
BTCS_L2_PUBLICATION_STORE_DIR=<publication-store-dir> \
npm run e2e:anchor
```

Publishes exactly one anchor output for a 2-block batch, verifies confirmation
via active-chain Core RPC, and confirms the durable publication record survives
a store reopen.

## Safety

- Use only local loopback regtest and disposable, purpose-named nodes,
  datadirs, wallets, and store directories.
- Reorg modes are gated by port/datadir/wallet and must never be pointed at a
  shared or production node. The `e2e:anchor` reorg gate requires port 29444;
  the `e2e:batch-data` reorg gate requires port 29446.
- Do not expose RPC cookies; the harnesses never print them.
- Shut down only the test daemon on completion.

## Known limits

- Trust model: L1 verification trusts local Core RPC; no SPV or trustless
  inclusion proof.
- No withdrawals/exit path, censorship resistance, or fraud/validity proof
  architecture yet.
- Source-specific attribution among fungible deposit credits is partial; reorg
  recovery is operator-invoked, not an always-on watcher.
- Single-writer local coordination via OS file locks; multi-host coordination is
  not implemented.
