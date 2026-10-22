# BTCS L2 regtest deposit-to-settlement run

Date: 2026-10-21
Result: **PASS**

The real E2E ran with Node v24.17.0 against the dedicated BTCS Core regtest
data directory `~/.local/share/btcs-l2-deposit-regtest-20261011`. Core reported
`chain=regtest`. The daemon was stopped with the matching `bitcoinsilver-cli
stop` command after the run; the dedicated Core wallet and data remain on disk.
The runner's temporary L2 chain and deposit-store files were cleaned up.

## Finding and correction

The first run mined 101 blocks and then failed at `fundrawtransaction` with
`Insufficient funds`. The BTCS Core source sets
`COINBASE_MATURITY = 200` in `src/consensus/consensus.h`; therefore 101 blocks
leave all coinbase rewards immature. The E2E runner and its README now mine 201
funding blocks. The successful retry started from the existing height 101,
mined the additional 201 funding blocks, and completed the full deposit and
settlement flow.

## Successful run

- L1 deposit transaction: `6a6d91b053844081736ce9f6f4b8dba0dbf1b3c9b61cbb5c47050d1df7fed791`
- Inclusion block: `0e9134bc7d6dff5db145a4c264ebd6da2366fa0814b39f6e4292819e8dc7861a`, height 303, 2 confirmations
- Deposit record: `6a6d91b053844081736ce9f6f4b8dba0dbf1b3c9b61cbb5c47050d1df7fed791:0`
- Amount: 10,000,000 satoshis (0.1 BTC)
- L2 profile: `btcs-l2-local-v0.12-deposit-prelude`
- L2 block: height 1, hash `0xe5cee52795e039c7266719e35f5ce6eeabd7a660910006f31bf239fa670fe38d`
- L2 recipient: `0x1111111111111111111111111111111111111111`
- Credited amount: `100000000000000000` wei
- L2 state root: `0x680666422276e0bbb9de9c4179f94533bff91ba551457b3e2ef3292de09a9f9b`
- Settlement: v2 batch `f4cbd534c93c3bd3573f1a942f532e83d71f62d19784bcf3439accad3970a0ab`
- Settlement execution replay passed for both blocks; the child block was re-executed, and the independent state root and recipient balance matched.

## Limits

This demonstrates the local deposit-to-settlement prototype against a real
regtest transaction. L1 verification trusts the local Core RPC. The run did not
simulate an L1 reorg, prove trustless inclusion, test production escrow, or
implement withdrawals.

## 2026-10-21 update — fresh-node deposit, batch-data availability, anchor publication

Three additional real-Core regtest E2Es were executed against isolated nodes and
all passed. Evidence below is from actual runs (logs under `/tmp/opencode/`).

### Deposit E2E (fresh throwaway regtest node)

- Command: `BTCS_CORE_CLI=~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli BTCS_L1_REGTEST_DATADIR=/tmp/opencode/btcs-deposit-datadir BTCS_L1_RPC_PORT=29450 npm run e2e:deposit`
- Node: fresh `build-noipc` daemon, datadir `/tmp/opencode/btcs-deposit-datadir`, RPC 29450, `-fallbackfee=0.0002`, wallet `btcs-l2-deposit-e2e`.
- Result: **PASS** (log `/tmp/opencode/deposit-e2e-run-2.log`).
- L1 deposit txid `add1502ed51db1ad9c67120515fa1788bafa161767a856242a60ee7b86c9733d:0`; inclusion height 202; 2 confirmations; amount 10,000,000 satoshi.
- L2 block height 1, hash `0x343de3bae6dd72ab3ff595a0b609c3e79681ca36ddd35bd97edb757d2d1cea9b`; recipient `0x1111111111111111111111111111111111111111`; credited `100000000000000000` wei; state root `0x680666422276e0bbb9de9c4179f94533bff91ba551457b3e2ef3292de09a9f9b`; profile `btcs-l2-local-v0.12-deposit-prelude`.

### Batch-data availability E2E

- Command: `BTCS_L2_BATCH_DATA_REGTEST_DATADIR=~/.local/share/btcs-l2-regtest-core BTCS_L2_BATCH_DATA_REGTEST_PORT=29443 BTCS_L2_BATCH_DATA_REGTEST_WALLET=btcs-l2-deposit-e2e npm run e2e:batch-data`
- Node: `build/bin` daemon, RPC 29443.
- Result: **PASS** (log `/tmp/opencode/batch-data-e2e-run-3.log`).
- L2 batch `c31e6c181e0e95932b311db7d87e38bf3855141e5cbe1bdc212bf74b2955586f`; 4,472 bytes in 128 fragments.
- Commitment confirmed at L1 height 402; 128 fragments reconstructed from the active block; reconstructed bytes match the batch hash.
- Anchor tx `b271b4427104623c8a8f1730bc146ba1479e924500d3ec32d879a6b9e9e73dfa`; first fragment `77c6eba767e7dbe224b3d8fba63b80027076100e6e6dd51407d02b1cf1eab9e1`; last fragment `b7e8e7932c5d2fea09e4e4813159413efcd24f4e212656169ddc42475ba60b1c`; publication block `04fbaa6ead6f6dc78aecc4c2d43c30dea878e11b9770d6d3710a9f31894db30c`.

### Anchor publication E2E

- Command: `BTCS_L2_REGTEST_PORT=29450 BTCS_L2_REGTEST_DATADIR=/tmp/opencode/btcs-deposit-datadir BTCS_L2_REGTEST_WALLET=btcs-l2-deposit-e2e BTCS_L2_PUBLICATION_STORE_DIR=/tmp/opencode/btcs-l2-anchor-publications-1 npm run e2e:anchor`
- Result: **PASS** (log `/tmp/opencode/anchor-e2e-run-1.log`).
- Batch `c1e8984088a7fe88444de001ee58c24e287fca82d481d5ab2e5da13454363d9e` (heights 0–1), execution verified.
- Submission txid `20cc2dcaae7f0e052b915ffc744044023943b19172e1ad5ce21a05f2af95c85f`; confirmed in block `5eaf2f6885adbb036471731374dcf8c822b7b102d2ebfdd8791de26e703062f3` at height 204 (1 confirmation); state `confirmed`; recovered identically after store reopen.

### Batch-data reorg E2E (destructive, gated)

- Command: `BTCS_L2_BATCH_DATA_REGTEST_REORG_TEST=1 BTCS_L2_BATCH_DATA_REGTEST_PORT=29446 BTCS_L2_BATCH_DATA_REGTEST_DATADIR=~/.local/share/btcs-l2-regtest-reorg-20261011 BTCS_L2_BATCH_DATA_REGTEST_WALLET=btcs-l2-reorg-test npm run e2e:batch-data`
- Node: `build-noipc` disposable reorg daemon, RPC 29446.
- Result: **PASS** (log `/tmp/opencode/batch-data-reorg-e2e-run-3.log`).
- Batch `aae918c8ecd3c17db887f0d994629c3366f4efd297f16333486efb4602166067`; 4,472 bytes in 128 fragments.
- Orphaned publication block `26951d2547ea6fa93d493e5fbb1c3f92f935d399c5bb03452106935a10792008` (confirmed at L1 height 555); after `invalidateblock` the scanner reported `incomplete` with all 129 expected txs (128 fragments + anchor) orphaned.
- Replacement block `6989bb1793d50a5924c9cf4207a3752eeb8fd24e555a4189d30dcc3cc0a325be` re-included all 129 txs; reconstruction was byte-exact. Orphaned transaction count 129 = replacement re-inclusion count 129.
- Anchor tx `f18734e0cba49e6aeb9032ebeeec513977f2a73a3aaa321de3169ba93b3b0151`.

### Anchor reorg E2E (destructive, gated)

- Command: `BTCS_L2_REGTEST_REORG_TEST=1 BTCS_L2_REGTEST_PORT=29444 BTCS_L2_REGTEST_DATADIR=~/.local/share/btcs-l2-regtest-reorg-20261011 BTCS_L2_REGTEST_WALLET=btcs-l2-reorg-test BTCS_L2_PUBLICATION_STORE_DIR=~/.local/share/btcs-l2-regtest-reorg-publications-20261011 npm run e2e:anchor`
- Node: `build-noipc` disposable reorg daemon, RPC 29444 (reused the same datadir after stopping the 29446 instance).
- Result: **PASS** (log `/tmp/opencode/anchor-reorg-e2e-run-2.log`).
- Batch `ebdaabe2c6d572ceb48b5111a3917222b9cae05c2c954375d27ee548ea092f05` (heights 0–1), execution verified. Submission txid `339346d5d5a47e7177378d1ebdbbd87d7e6ef9b8072ce06f21ce4a5c70d7951c`; confirmed at height 556 in replacement block `18a3761639f04add542fa3499e5bedced8e1fe52f6261855f45897e8ec0ac35f`.
- The original publication inclusion was removed from the active chain and the invalidation survived a store reopen; the replacement branch re-included the anchor and confirmed it, with recovery persisting the replacement confirmation.

### Environment / Core-build findings

1. **`e2e:batch-data` needs a wallet with many mature, confirmed UTXOs.** It publishes ~129 independent transactions with `minconf:1`. After the first spend the only fresh coin is unconfirmed change, which `minconf:1` excludes, so a thinly-funded wallet fails partway with the misleading Core error `The total exceeds your balance when the … fee is included` — even though the wallet shows a large `getbalances.mine.trusted` figure and `listunspent` is empty (the fork's `trusted` includes unspendable balance). Mitigation used: mine 200 further blocks to mature coinbases (tip 401 → 201 spendable UTXOs), matching the historical passing run at height ~507. Recommended hardening: have the runner assert/auto-provision ≥ fragments+1 mature UTXOs.
2. **No Core build divergence — an earlier "build" hypothesis was a misdiagnosis.** `fundrawtransaction {"minconf":1,"fee_rate":2}` works on both the `build/bin` and the `build-noipc` daemon (BitcoinSilver 31.1.3); it was re-verified succeeding on `build-noipc` (RPC 29450) once confirmed UTXOs existed. The apparent difference was purely wallet state: `minconf:1` **excludes unconfirmed change**, and `fundrawtransaction` with no options (`e2e:anchor`, line 165) defaults to `minconf:0` and includes it. The only genuine option-related requirement is a fee source: `e2e:anchor` and `e2e:deposit` fund with no `fee_rate`, so a daemon without `-fallbackfee` (e.g. the `build/bin` node on 29443) fails with `Fee estimation failed. Fallbackfee is disabled`. `e2e:batch-data` passes an explicit `fee_rate` and so does not need `-fallbackfee`, but does need confirmed UTXOs (finding 1).
3. `COINBASE_MATURITY` is 200 on this chain; funding flows must mine ≥ 201 blocks (or mature UTXOs) before spending.
