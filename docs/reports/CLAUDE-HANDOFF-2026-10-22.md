# Claude handoff — 2026-10-22

Update: the shared asset engine now lives in `execution/evm/src/assetEngine/`. Read `docs/reports/EVM-ASSET-ENGINE-2026-10-22.md` before the next-task section below. Live BNB Smart Chain deployment and transfer were not executed. Withdrawal, proof, and production restrictions in this file still apply.

Status: uncommitted worktree. No commit and no push in this session. Nothing here is production-ready. BTCS L2 is a trusted single-operator prototype, not a trustless rollup.

> **SilverPay product decision (2026-10-22):** SilverPay is the unified Silver
> Labs wallet-and-payments product. The separate Silver Wallet roadmap entry is
> retired, and the empty sibling `silver-wallet` repository is not a required
> dependency. SilverPay Wallet is Phase 1 and the initial priority; SilverPay
> Payments is Phase 2 and remains planned. See
> `docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

## Repositories

| Path | Branch | HEAD | Notes |
|---|---|---|---|
| `/home/user/Silver-Labs/btcs-l2` | `experimental/deposit-prelude-v1` | `148d14f4247ca3dbb1a4f0e69a4d2075e0666993` `Ignore Studio installed dependencies` | Product repo. One worktree. No remotes. |
| `/home/user/Silver-Labs/btcs-core` | `main` | `067be9eaef386f99619989289c9a6bcd07e547dc` | Not edited this session. Dirty Qt files belong to another agent. |

Parent of L2 HEAD is `88dbce7`. `master` was `7074a7b` at the audit. Do not reset, clean, stash, or revert either tree.

Node for L2 tests is v24.17.0 at `/home/user/.nvm/versions/node/v24.17.0/bin` (npm 11.13.0). System Node 18 cannot run this package. Prefix commands with:

```sh
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
```

The shell starts in `btcs-core`. `cd` to the L2 path before every L2 command.

## What was implemented

Missing JSON-RPC methods were added to the existing server. No second server and no duplicate handlers.

| Method | Behavior |
|---|---|
| `eth_call` | `runTx` on a shallow-copied VM whose trie database is a read-only overlay. Writes stay off the canonical LevelDB. State overrides are rejected. `pending`, `safe`, and `finalized` stay rejected. |
| `eth_estimateGas` | Binary search on real execution. The returned limit was executed successfully. Reverts, insufficient funds, and base-fee failures return errors, not a number. |
| `eth_getTransactionByHash` | Canonical transaction, or a real pool transaction when `--dev-sequencer` is on. Unknown hash is JSON `null`. |
| `net_version` | Decimal chain id `"31337"`. |
| `net_listening` | `false`. There is no peer listener. |
| `net_peerCount` | `"0x0"`. |

Chain id, EIP-1559 fee defaults, `BLOCK_GAS_LIMIT` (30,000,000), coinbase (zero address), and the Osaka EVM were not changed. Osaka EIP-7825 rejects a transaction gas limit above `16777216`. Simulations cap at `min(requested, block gas limit, maxTransactionGasLimit)`. The cap is read from `@ethereumjs/tx` `paramsTx` applied to the harness common. The block gas limit stays 30,000,000.

`eth_call` / `eth_estimateGas` isolation is `ReadOnlyOverlayDB` in `execution/evm/src/blockProcessor.ts`. Storage tries call `shallowCopy()`, so the copy nests on the parent overlay instead of the canonical database. EthereumJS trie copies default to string values. `new Uint8Array(hexString)` is empty on Node 24, so the overlay decodes hex strings with `unprefixedHexToBytes` and returns byte copies.

The zero address is the coinbase and can hold priority fees. An omitted `from` is that address, not an unfunded account. Insufficient-funds tests use `0xbb` repeated.

## Tests executed

Working directory: `/home/user/Silver-Labs/btcs-l2/execution/evm`. PATH as above.

| Command | Result |
|---|---|
| `npx tsc --noEmit && npm test && git -C /home/user/Silver-Labs/btcs-l2 diff --check` | Exit 0. Typecheck passed. `npm test` (`tsx --test tests/*.test.ts`) **314 pass, 0 fail**, duration_ms **155757.259027**. `git diff --check` passed. This glob was expanded before `tests/rpcWalletReadiness.test.ts` existed, so that file was not in the 314. |
| `npx tsx --test tests/rpcExecution.test.ts` | 5 pass, 0 fail, before the full suite. The same five passed again inside the 314. |
| `npx tsx --test tests/rpcWalletReadiness.test.ts` | First run failed to load: `@ethereumjs/util` has no `keccak256` export. Import changed to `keccak_256` from `@noble/hashes/sha3.js`. Second run: **1 pass, 0 fail**, duration_ms **12104.799132**, exit 0. |

The wallet-process test spawned `src/rpcServer.ts` with `--dev-sequencer` on `127.0.0.1` and a temporary datadir. It checked chain id `0x7a69`, `net_version` `"31337"`, `net_listening` false, `net_peerCount` `0x0`, deployed a test token, `eth_call` `balanceOf`, `eth_estimateGas`, `eth_sendRawTransaction`, `btcs_dev_mine`, transaction lookup, receipt, native gas debit (`gasUsed * effectiveGasPrice` from the sender, priority fee to the zero address), token balances and the `Transfer` log, then restarted the process on the same datadir. Canonical receipt, code, and token balance survived. The unmined pool transaction was null after restart. The test accepts either SIGTERM or SIGKILL and does not record which one stopped the process.

A combined `npm test` after adding the wallet file has **not** been run. Do not cite 315/315.

Live `npm run e2e:deposit`, `e2e:anchor`, and `e2e:batch-data` were **not** run. The 314 includes the existing L1 unit tests (deposit, publication, confirmation, reorg). That is not a live regtest result. Do not start Core against a valuable wallet. `.regtest/` is gitignored and contains a cookie and wallet; do not read or commit it.

## Files changed this session and why

RPC implementation, uncommitted:

- `execution/evm/src/rpc.ts` — the six methods, call parsing, fee resolution, EIP-7825 cap, estimate search, revert data (code 3).
- `execution/evm/src/blockProcessor.ts` — `ReadOnlyOverlayDB`, `isolateExecutionVm`, `assertCanonicalStateUnchanged`.
- `execution/evm/src/transactionPool.ts` — `findPendingTransaction`.
- `execution/evm/src/transactions.ts` — exported the existing 1 gwei / 2 gwei fee defaults. Values unchanged.
- `execution/evm/tests/rpcExecution.test.ts` — new. Unit and integration coverage.
- `execution/evm/tests/rpcWalletReadiness.test.ts` — new. Process checklist. Passed once after the import fix.
- `execution/evm/README.md` — method list matches the server. The demo section no longer says the methods are absent.
- `execution/evm/scripts/demo-client.ts` — the demo note no longer says the server lacks `eth_call`. The demo itself still does not call those methods.
- `docs/WORK-QUEUE.md` — V15-E set to PARTIAL with the command results. Not COMPLETE.
- `docs/reports/BTCS-L2-FULL-PROJECT-AUDIT-2026-10-22.md` — short later-evidence paragraph. The older 305/309 narrative was left in place.
- `docs/reports/CLAUDE-HANDOFF-2026-10-22.md` — this file.

Left untouched on purpose: `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md`, the v1.5 download, `contracts/token/BSNA20.sol`, `withdrawalService.ts`, Core Qt sources, and empty `execution/evm/debug_repro.mjs`.

Other agents' uncommitted work is still in the same tree. Do not revert it: `.gitignore`, `README.md`, BSNA docs, `docs/SECURITY-GAP-REGISTER.md`, `execution/evm/src/depositPrelude.ts`, `execution/evm/tests/btcsGasAccounting.test.ts`, `docs/BSNA-FTS1-PROPOSAL.md`, and the two earlier reports.

## Not done

- Combined suite including the wallet-process test.
- Live regtest deposit, anchor, batch-data, or reorg.
- `eth_gasPrice`, fee history, native-currency metadata, `pending` / `safe` / `finalized` tags.
- MetaMask connector and Forge deploy.
- L3 implementation. Whitepaper v1.2 section 83 describes L3 as optional and future. No L3 source tree was found. `silver-wallet`, `silvex`, and `tools` are empty. Do not invent an L3 architecture.

## Next task

Re-run the full engine suite so the new process test is in the same run:

```sh
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
cd /home/user/Silver-Labs/btcs-l2/execution/evm
npx tsc --noEmit
npm test
```

Acceptance: typecheck exits 0, and `npm test` exits 0 with every file under `tests/` counted, including `rpcExecution.test.ts` and `rpcWalletReadiness.test.ts`. Record the runner's pass count. Do not write the count down before the command finishes.

After that, only if a disposable regtest node is already running and the datadir is not a valuable wallet, re-run the existing `e2e:deposit`, `e2e:anchor`, and `e2e:batch-data` scripts. They do not start or stop Core. If Core is absent, write that down. Do not claim a live result.

Do not start L3 code. If an owner names an application, the only spec in-repo is `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md` section 83, and it is optional.

## Do not enable

- Withdrawals or payouts. Leave `withdrawalService.ts` and `canProcessPayout()` as they are. Do not set `BTCS_ENABLE_WITHDRAWALS` or `BTCS_WITHDRAWALS_UNSAFE`.
- Fraud proofs, validity proofs, forced inclusion, slashing, or a production vault.
- A third token, a BSNA rename, or a Forge deploy. `BSNA-F1` and `BSNA-FTS1` are unratified. `docs/BSNA-FTS1-PROPOSAL.md` is a proposal.
- Changes to chain id, the gas schedule, coinbase, or `BLOCK_GAS_LIMIT` in order to make a test pass.
- A commit that mixes this RPC work with another agent's docs unless the owner asks. This session did not commit.
- Push, production deploy, real keys, or real funds. The dev sender key is `0x11` repeated and is public.

## Verified combined test run — 2026-10-22

A background runner completed the TypeScript typecheck and full EVM engine test suite.

- Typecheck: `npx tsc --noEmit` passed; the runner proceeded to the test suite.
- Test command: `npm test` (`tsx --test tests/*.test.ts`).
- Result: 325 tests, 324 passed, 0 failed, 1 skipped.
- Test duration reported by Node: 164522.64265 ms.
- Runner exit code: 0.
- The skipped test is the live BNB Smart Chain testnet deployment/transfer acceptance test; it was not executed because `BNB_TESTNET_RPC_URL` and `BNB_TESTNET_PRIVATE_KEY` were unset.
- This was a local automated test run, not a live BNB testnet or BTCS regtest run.
- Branch at verification: `experimental/deposit-prelude-v1`.
- The worktree remains uncommitted. Preserve all existing changes and inspect unexpected untracked paths before cleanup.
