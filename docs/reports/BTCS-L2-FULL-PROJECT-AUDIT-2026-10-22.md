# BTCS L2 full project audit — 2026-10-22

Status: **historical audit snapshot** from earlier in this session. Nothing in this
report is production-ready. Later same-day evidence supersedes the counts and
SG-01/SilverPay statements below.

Whitepaper alignment, written after this audit: `docs/reports/BTCS-L2-WHITEPAPER-V1.5-ALIGNMENT-2026-10-22.md`. The downloaded v1.5 file is the design reference. This audit remains the implementation evidence. The repository whitepaper v1.2 was not replaced.
Scope: `~/Silver-Labs/btcs-l2` is the product repository. `~/Silver-Labs/btcs-core` was inventoried and not modified. `silver-wallet`, `silvex`, and `tools` are empty directories.

> **Product decision update (2026-10-22):** the empty `silver-wallet` directory
> is not a dependency and is not the future product. SilverPay is the unified
> Silver Labs wallet-and-payments product: SilverPay Wallet is Phase 1 and
> SilverPay Payments is Phase 2, planned later. SilverForge and Silver Scan
> remain separate. This report's historical wallet inventory remains evidence
> of what did not exist; see
> `docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

This audit is a historical checklist, not the current master status. Use
`docs/ALPHA-RELEASE-CHECKLIST.md`, `docs/WORK-QUEUE.md`, and
`docs/PUBLIC-RELEASE-STAGES.md` for current status. Where they disagree with a
command recorded here, use the current documents.

Later RPC evidence, written after the body of this audit: `eth_call`, `eth_estimateGas`, `eth_getTransactionByHash`, `net_version`, `net_listening`, and `net_peerCount` now exist on `execution/evm/src/rpc.ts`. The 305/309 figures below are earlier runs. On Node v24.17.0, `npx tsc --noEmit` passed and `npm test` then passed 314/314 (duration_ms 155757.259027). That run included `tests/rpcExecution.test.ts` and did not include `tests/rpcWalletReadiness.test.ts`, which passed 1/1 afterward (duration_ms 12104.799132). Live regtest was not re-run. Limits and the next task are in `docs/reports/CLAUDE-HANDOFF-2026-10-22.md`. Do not read older "eth_call is not provided" sentences in this file as current.

Later asset-engine evidence: `execution/evm/src/assetEngine/` now has separate BTCS L2 local, Ethereum, and BNB Smart Chain profiles. A local RPC deploy and transfer ran. A live BNB testnet deploy and transfer did not. Solana and SPL are still absent. Details and commands are in `docs/reports/EVM-ASSET-ENGINE-2026-10-22.md`. Do not read the "no BNB implementation" sentence below as current.

## Later same-day update (supersedes stale counts and claims)

- EVM full suite: **366 tests, 365 pass, 1 skipped live BNB, 0 fail, 187.3s**;
  `tsc --noEmit` clean. The 305/309/314 figures below are historical.
- SG-01 is no longer merely a library: anchor confirmation and deposit
  acceptance now fetch a Core `gettxoutproof` and verify the partial Merkle proof
  and header PoW locally when available. Malformed/wrong-txid/wrong-block/root
  and previous-header-hash mismatches fail closed. The header and active chain
  still come from trusted Core RPC; canonical/most-work selection, peer
  consensus, and finality remain open. Do not call this trustless SPV.
- SilverPay Wallet has a **read-only Phase 1 slice**: a loopback service and
  Studio page show separate real L1 UTXOs/balance and L2 account/network reads.
  Service tests 15/15, Studio adapter 6/6, production build passes. Real local L1
  read returned 356 UTXOs; L2 was unavailable and reported as unavailable. No
  signing, send/receive, recovery, history, token/NFT balances, account
  switching, payments, or browser-driven test.
- Logo upload became mandatory after this audit. BSNA-FTS1 and the token deploy
  workflow changed; older "no token deploy" statements are historical.
- Independent status: local prototype **PARTIAL**; public developer test
  **NOT STARTED/BLOCKED**; production readiness **NOT GRANTED**; public
  production release **NOT APPROVED/NOT AUTHORIZED**.

## A. Executive summary

BTCS L2 is a local, trusted, single-operator EVM prototype connected to Bitcoin Silver regtest by deposit scanning, batch publication, and reconstruction. The canonical execution package is `execution/evm`. On Node v24.17.0 its suite passed 305/305 before this session's code change, and the focused gas-accounting file then passed 4/4. The asset-service upload and metadata tests passed. The older Python v0.6 and v0.9 fixtures still verify.

What is not true, despite older notes that say otherwise:

- SilverForge cannot create or deploy a token. The React Studio builds, and its Deploy button only sets a status string. The Qt SilverForge page disables its create buttons and shows "Coming Soon".
- BSNA-FTS1 was not specified. `BSNA20` is a separate ERC-20 wrapper. A proposal now lives at `docs/BSNA-FTS1-PROPOSAL.md`. It is not implemented.
- Solana and SPL have no implementation. The later asset-engine note covers the BNB and Ethereum profiles added after this summary. A BTCS L2 token is not a BNB asset.
- There is no block explorer, no public RPC package, and no L2 CI workflow.
- Withdrawal source exists and is tested, and payouts are hard-disabled. That is not an exit, and it is not a trustless rollup.
- Chain id `31337` is the local harness id. It collides with Hardhat and Anvil. Gas is the L2 native balance, denominated so that 1 BTCS = `10^18` wei. The fee recipient is the zero address.

The live Core regtest deposit, anchor, and batch-data commands were not re-run in this session. Prior result documents from 2026-10-21 still describe those runs. This session did not start `bitcoinsilverd` and did not touch a wallet.

## B. Repository and branch inventory

### btcs-l2

| Item | Evidence |
|---|---|
| Path | `/home/user/Silver-Labs/btcs-l2` |
| Branch | `experimental/deposit-prelude-v1` |
| HEAD | `148d14f` `Ignore Studio installed dependencies` |
| Parent checkpoint | `88dbce7` `Checkpoint BTCS L2 prototype and Studio work` |
| `master` | `7074a7b` `Add durable BTCS L1 deposit verification workflow` |
| Remotes | none |
| Worktrees | this directory only |
| Tracked secrets | `git ls-files` matched no `.env`, cookie, or `wallet.dat` |
| Ignored local chain data | `.regtest/` contains a regtest cookie and `wallets/l2test/wallet.dat`. Not read and not committed. |
| Pre-existing untracked file | `execution/evm/debug_repro.mjs` is an empty file. Left in place. |

`master` does not contain the deposit-prelude integration, the Studio, the asset service, or the withdrawal prototype. Those are on `experimental/deposit-prelude-v1`.

### btcs-core

| Item | Evidence |
|---|---|
| Path | `/home/user/Silver-Labs/btcs-core` |
| Branch | `main` |
| HEAD | `067be9eaef` `Checkpoint SilverForge Qt interface development` |
| Remote | `origin` `https://github.com/bitcoin-silver/core.git` |
| Relation to origin | ahead 1. The ahead commit adds `src/qt/silverforgepage.*` and the form. |
| Uncommitted work | `src/qt/bitcoinsilvergui.cpp`, `bitcoinsilvergui.h`, `walletframe.cpp`, `walletframe.h`, `walletview.cpp`, `walletview.h`. The diff adds `gotoSilverForgePage` and a `SilverForgePage` member. Not built and not edited by this session. |
| Binaries present | `build/bin/bitcoinsilverd`, `build-noipc/bin/bitcoinsilverd`, `build-gui/bin/bitcoinsilver-qt` |
| CI | `.github/workflows/build.yml` for the L1 tree only |

### Empty siblings

`/home/user/Silver-Labs/silver-wallet`, `silvex`, and `tools` contain no files.

### Tools used

| Tool | Version observed |
|---|---|
| System `node` | v18.19.1. Too old for the package `engines` field (`>=24.17.0 <25`). |
| Node used for tests | v24.17.0 from `~/.nvm/versions/node/v24.17.0` |
| npm | 9.2.0 on the system path; the Node 24 npm was used for the suites |
| Python | 3.12.3 |
| Foundry / solc on PATH | not installed. Contract tests use the `solc` npm package. |
| cargo / rustc | 1.75.0, not used by L2 |
| go | 1.22.2, not used by L2 |

## C. Baseline commands and results

All commands below were run in this session. "Pass" means the process exited 0 and the runner reported no failures.

| Command | Working directory | Result |
|---|---|---|
| `npm run typecheck` | `execution/evm` | pass, before and after the gas test |
| `npm test` | `execution/evm` | **305 pass, 0 fail**, about 144s, before the gas test |
| `npx tsx --test tests/btcsGasAccounting.test.ts` | `execution/evm` | **4 pass, 0 fail**, after the fix to the contract-nonce assertion |
| `npm test` (after the gas file) | `execution/evm` | **309 pass, 0 fail**, about 154s, exit 0 |
| `npm run typecheck` | `services/asset-service` | pass |
| `npm test` | `services/asset-service` | **80 pass, 0 fail** |
| `npm run test:contracts` | `services/asset-service` | **5 pass, 0 fail** |
| `python3 -m unittest tests.test_v09_protocol` | repo root | **14 tests, OK** |
| `python3 verify_v06.py` | repo root | `PASS` against the pinned batch hash |
| `python3 verify_v06_full.py` | repo root | `V0.6 END-TO-END PASS` |
| `npm run build` | `studio` | Vite build succeeded. `studio/dist/` was removed afterwards. It is now gitignored. |

The post-change full suite is the last row of the table above: 309 pass, 0 fail.

Not run, and therefore not re-verified: `e2e:deposit`, `e2e:anchor`, `e2e:batch-data`, `integrated-e2e`, any Qt build, any browser click-through of Studio.

## D. Component inventory

Classifications mean:

- **VERIFIED WORKING** — a command in section C exercised the behavior, and the code path matches that command.
- **IMPLEMENTED BUT NOT VERIFIED** — code and older reports exist; this session did not re-run the proving command.
- **PARTIALLY IMPLEMENTED** — a real subset exists and the product behavior does not.
- **PLANNED / NOT IMPLEMENTED** — no working path in the tree.
- **BLOCKED** — needs an owner decision or missing infrastructure before safe implementation.
- **FAILING** — a command in this session failed and stayed failed. None of the commands in section C stayed failed.

### L1 integration — PARTIALLY IMPLEMENTED

`execution/evm/src/btcsL1CoreRpc.ts` talks to Bitcoin Silver Core over the local RPC cookie. Confirmation, deposit workflow, anchor preparation, and publication workflow sit beside it. Trust boundary tests in `tests/btcsL1TrustBoundary.test.ts` are inside the 305. They reject wrong chain identity, insufficient confirmations, malformed responses, and non-whole satoshis. At the time of this audit there was no SPV proof and SG-01 was entirely open. A later session integrated local partial proof verification when `gettxoutproof` is available, but canonical/most-work selection and finality remain open (see the later update above).

The L1 consensus code was not changed. The Qt SilverForge page does not query L1; it labels L1 "Active" as static text in `src/qt/forms/silverforgepage.ui`.

### EVM execution — VERIFIED WORKING for the local harness

`PersistentBlockProcessor` in `execution/evm/src/blockProcessor.ts` is the canonical chain. Profile `btcs-l2-local-v0.12-deposit-prelude`, schema version 2, Osaka hardfork, chain id `31337` (`execution/evm/src/config.ts`). Genesis funds the well-known development key `0x11` repeated 32 times with `10_000 * 10^18` wei. That key is a public test key already in the repository. It must not be used for value.

The 305-test run covers deployment, calls, reverted calls, receipts, logs, persistence across reopen, nonce rules, and rejection of invalid transactions. `contracts/Counter.sol` is the execution fixture. This is not a second client and not a public network.

The Python files under `execution/`, `sequencer/`, and `settlement/v09/` are an older account-transfer prototype. `verify_v06.py` and the v0.9 unittest passed. They are not the EVM.

### Sequencer and block production — PARTIALLY IMPLEMENTED

`execution/evm/src/transactionPool.ts` implements `DevelopmentSequencer`: in-memory pool, per-sender caps, fee bump, and `btcs_dev_mine`. RPC exposes it only when the server is started with the dev-sequencer flag. There is no production sequencer, no leader election, and no forced inclusion from L1. The Python `sequencer/sequencer.py` only sorts lines by an `id` field.

### BTCS gas and accounting — VERIFIED WORKING for the local debit rule

`tests/btcsGasAccounting.test.ts` now runs on `PersistentBlockProcessor`:

- 1 BTCS (`10^8` satoshis) equals `10^18` wei through the exported `SATOSHI_TO_WEI` constant.
- A 1-BTCS-sized native transfer of `10^18` wei debits the sender `value + gasUsed * effectiveGasPrice`, credits the recipient only `value`, and credits the zero-address coinbase only the priority fee. The base fee is not credited to the sender, recipient, or coinbase. The balances survive a processor reopen.
- A Counter deployment, a reverted call, and a successful call debit the sender's native balance by the gas charge. The contract balance stays 0. The contract nonce stays 1 after deployment; the calls do not spend it.
- A transfer of the entire genesis balance is rejected. Tip, sender balance, recipient balance, and sender nonce stay unchanged.

Limits that this does not close:

- Chain id `31337` is not a distinct public BTCS chain id.
- Coinbase is forced to the zero address (`blockProcessor.ts` rejects any other coinbase). Priority fees accumulate there. That is not a documented treasury.
- RPC does not implement `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory`, `eth_estimateGas`, or `eth_call`.
- No test in this session sent the transaction through MetaMask.

### Deposits — VERIFIED WORKING for the deterministic rules; live regtest IMPLEMENTED BUT NOT VERIFIED this session

`depositPrelude.ts` converts a confirmed deposit into an L2 credit at `10^10` wei per satoshi, rejects bad ids, bad ordering, and a mismatched wei amount. The processor applies credits inside the block and refuses a duplicate id. `btcsL1DepositWatcher.ts` scans a configured script, waits for confirmations, invalidates shallow reorgs, and stops on a deep reorg. Those tests are in the 305.

`npm run e2e:deposit` was not executed here. The last written claim is in `docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md`. Treat that as prior evidence, not as a result from today.

### L1 settlement and publication — same split

Deterministic batch encoding, continuity, reconstruction, and availability scanning are covered by the 305 (`settlementBatch.ts`, `settlementEnvelope.ts`, `btcsL1BatchData.ts`, `btcsL1BatchDataAvailability.ts`, `settlementBatchReplay.ts`). Live `e2e:anchor` and `e2e:batch-data` were not re-run. Anchors commit to a batch hash. Batch-data publication is a separate OP_RETURN fragment path. Neither path proves that the L2 execution was correct.

### Reorganization recovery — VERIFIED WORKING for the in-process prototype

`depositReorgAccounting.ts`, `depositReorgRecovery.ts`, and `depositRecoveryGate.ts` classify credits, freeze the chain, rebuild from the last good prefix, and adopt the candidate only after checks. The 305 includes those tests. Recovery is operator-invoked. It is not an always-on watcher, and it does not attribute fungible credits back to a specific deposit once they have mixed (SG-04). A reorg deeper than retained watcher history fails closed (SG-11).

### Withdrawals and exits — PARTIALLY IMPLEMENTED, and BLOCKED as a product exit

`withdrawal.ts` validates requests and disables itself unless both `BTCS_ENABLE_WITHDRAWALS=true` and `BTCS_WITHDRAWALS_UNSAFE=true`. `canProcessPayout()` returns `false` unconditionally. `withdrawalService.ts` stores a lifecycle. `l1PayoutAdapter.ts` refuses to run when disabled and refuses a chain other than the configured regtest. The id function is a non-cryptographic rolling hash, not keccak256. Tests for this disabled lifecycle are in the 305.

SG-02 in `docs/SECURITY-GAP-REGISTER.md` previously said no withdrawal code existed. That sentence was stale after `88dbce7`. The register now says the code exists and must stay disabled. There is still no fraud proof, validity proof, forced inclusion, or way for a user to exit if the operator stops. `docs/ARCHITECTURE-DECISION-RECORD-2026-10-22.md` records an interim trusted model and leaves owner approval unchecked. Do not enable payouts to close this gap.

### ERC-20 minting — PARTIALLY IMPLEMENTED

`contracts/token/SimpleERC20.sol` and `contracts/token/BSNA20.sol` are OpenZeppelin ERC-20 contracts. `BSNA20` adds `bsnaVersion`, `assetType`, `bsnaProfile` (`"BSNA-20"`), and `bsnaMetadata`. The asset-service contract test deploys them in-process and reads the metadata URI back. That test passed (5/5). Nothing in Studio or the Qt page deploys them. `SimpleERC20` and `BSNA20` both scale the constructor amount by `10 ** decimals()`, which BSNA-FTS1 explicitly rejects.

### BSNA-FTS1 — PLANNED / NOT IMPLEMENTED

Specified this session as a proposal only: `docs/BSNA-FTS1-PROPOSAL.md`. No contract, no conformance run, no Studio option. The proposal keeps ERC-20 selectors, uses atomic units, and makes supply, burn, pause, and metadata mutability immutable construction choices. It is not verified.

### SilverForge — PARTIALLY IMPLEMENTED

Two shells exist, and neither deploys.

React Studio (`studio/`):

- Routes in `studio/src/App.jsx`: Dashboard, Nodes, Token Studio, Transactions.
- `studio/src/pages/TokenStudio.jsx` collects ERC-20 fields and, on Deploy, sets the string `Deploying ERC-20... (requires connected wallet to L2 node)`. It does not call `ethers`, does not validate, and does not list BSNA-FTS1, BEP-20, or SPL.
- Dashboard hardcodes chain id `0x7a69` and never fetches the RPC. The Mine and Refresh buttons have no handlers.
- `npm run build` succeeded. No browser session was run. `UNIFIED-STUDIO-AUDIT-2026-10-22.md` called the Studio structurally complete and said ERC-20 validation was present. That overstates `TokenStudio.jsx`.

Qt page (`btcs-core/src/qt/silverforgepage.cpp` and `forms/silverforgepage.ui`):

- Committed on `main` by `067be9eaef`.
- Shows a static warning, a static "L1 Active" label, "L2 Status: Not Connected", chain id 31337, and disabled "Coming Soon" buttons for BSNA-20 and BSNA-721.
- Uncommitted GUI files wire a navigation slot. This session did not compile or review that diff line by line, and did not change it.

`launcher/start.js` prints start commands. It does not spawn the node or the Studio.

### Token logo uploads and metadata — VERIFIED WORKING for the local asset service

`services/asset-service` accepts PNG, JPEG, GIF, and WebP by file bytes, rejects mismatched MIME types, oversized files, and oversized dimensions, and writes a metadata document whose top-level fields are `name`, `description`, `image`, `external_url`, and `attributes`. The 80 tests and 5 contract tests passed. Profiles are `BSNA-20` and `BSNA-721` only. Local URIs are marked `local-only` and not portable. The Studio does not call this service. IPFS support exists in `src/storage/ipfsProvider.ts` and is covered by the unit suite; this session did not talk to a public IPFS node.

### BNB integration — PLANNED / NOT IMPLEMENTED

No BNB, opBNB, or BEP-20 source, config, or test was found in `btcs-l2` or in the SilverForge Qt page. A BEP-20-compatible contract on BTCS L2 would still be an EVM contract paying BTCS gas. A token deployed on BNB Smart Chain does not exist here. Do not add a button that says BEP-20 until one of those two destinations is real and labelled.

### Solana / SPL integration — PLANNED / NOT IMPLEMENTED

No Solana, SPL, or token-account source was found. `silver-wallet` is empty. An SPL option in SilverForge must say whether it creates a native Solana mint or an EVM token that only borrows the name. Neither exists.

### Wallets — PARTIALLY IMPLEMENTED

The L1 Qt wallet is Bitcoin Silver Core. Its SilverForge page does not connect to L2 and does not request a seed in the page that was read. The L2 RPC has no `eth_accounts` and does not take a seed. No browser wallet connector is implemented. `docs/CLIENT-INTEGRATION-PLAN-v0.1.md` already lists the RPC methods a stock wallet needs and which of them are missing. That list is still accurate: `eth_call`, `eth_estimateGas`, fee methods, and `eth_getTransactionByHash` are absent from `execution/evm/src/rpc.ts`. Implemented methods include `web3_clientVersion`, `eth_chainId`, `eth_blockNumber`, block and receipt lookups, code, storage, balance, nonce, logs, `eth_sendRawTransaction`, and `btcs_dev_mine`.

### RPC — PARTIALLY IMPLEMENTED

`execution/evm/src/rpcServer.ts` serves the methods above on a configured port. The README example is `127.0.0.1:8545` with `--dev-sequencer`. There is no authentication, quota, or public deployment. Binding checks are local-host oriented in `isAllowedRpcHost`.

### Explorer — PLANNED / NOT IMPLEMENTED

No explorer package, indexer, or block UI exists. Studio's Transactions page is a static shell.

### Documentation — PARTIALLY IMPLEMENTED

Authoritative design text is `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md`. This session did not edit it. Useful current docs include the EVM README, the integrated runbook, the security-gap register, the trust-boundary matrix, the requirements matrix, and the 2026-10-21 regtest result notes. Several of those docs lag the tree: the requirements matrix still says withdrawals are missing, and the 2026-10-22 Studio audit overclaims the UI. The work queue's older rows are kept and are marked as historical at the top.

### CI and automated tests — PARTIALLY IMPLEMENTED

L2 has no `.github` workflow. The automated evidence is local `npm test`, the asset-service tests, and the Python verifiers. Core has Linux/Windows/macOS CI for L1, which does not run the L2 suite.

## E. Security gates

| Gate | State | Evidence |
|---|---|---|
| Trust-minimized withdrawal | Absent | Payouts hard-disabled. No L1 enforcement. |
| Fraud or validity proof | Absent and blocked on an L1 design decision | ADR 2026-10-22, SG-03 |
| Forced inclusion | Absent | Requirements matrix §16, SG-02/SG-03 |
| Reorg recovery | Prototype, operator-invoked, unit-tested | deposit reorg modules, included in the 305 |
| Reconstruct L2 state from L1 data | Partial | Batch bytes can be rebuilt and re-executed. A fresh EVM node rebuilt only from L1 is not demonstrated. |
| Operator and dev keys | Single operator; public dev key funds genesis | README, `config.ts` |
| L1 RPC trust | Trusted configured Core RPC | SG-01 |
| Gas denomination | Tested for the local rule | `btcsGasAccounting.test.ts` |
| BSNA-FTS1 review | Not started | Proposal only |
| Public RPC abuse controls | Absent | Local dev server only |
| Independent security review | Not done | No report in the tree |

Do not describe this system as a trustless rollup or as safe for real funds.

## F. Dependency graph and blockers

```text
Bitcoin Silver L1 regtest
  -> trusted Core RPC
    -> deposit watcher and publication scanners
      -> deposit prelude (satoshi to wei)
        -> PersistentBlockProcessor  (native BTCS gas)
          -> development sequencer and JSON-RPC
            -> Studio / Qt SilverForge   [not connected]
            -> asset service             [not connected]
          -> settlement batch
            -> L1 anchor and OP_RETURN fragments
              -> independent replay of published bytes

BSNA-FTS1 proposal  -> not yet a contract -> not yet Studio
SimpleERC20 / BSNA20 -> asset-service metadata test only
BNB / SPL            -> no code
Withdrawals          -> disabled until an owner chooses a security model
```

Blockers that need Joshua, not another agent inventing a mechanism:

1. Keep the interim trusted-operator model, or fund a real fraud-proof / validity-proof design? Payouts stay off until that choice is written down and reviewed.
2. Is the zero address the intentional fee sink, or should a treasury address receive the priority fee?
3. What public chain id replaces `31337` before any testnet is shared?
4. For the four SilverForge options, which are in scope for the next milestone: ERC-20 and BSNA-FTS1 on BTCS L2 only, or also a real BNB deployment and a real Solana mint?
5. The uncommitted Qt navigation on `btcs-core` `main` belongs to other in-progress work. It was not committed and not reverted.

Non-decision blockers:

- Live regtest E2E needs a disposable datadir, a mature-UTXO wallet, and the Node 24 binary. It must not use a funded mainnet wallet.
- Studio cannot be called done until a browser session deploys a contract against the local RPC and reads it back.
- Node 18 cannot run the L2 suites. Use Node v24.17.0.

## G. Prioritized queue

| Order | Work | Acceptance | Status after this session |
|---|---|---|---|
| 1 | Keep the audit current | This file matches commands just run | Done for this session |
| 2 | Native gas proof | Exact debit, failed-tx debit, underfunded rejection, denomination | Done in `btcsGasAccounting.test.ts` |
| 3 | BSNA-FTS1 specification | Written as a proposal, distinct from `BSNA20` | Done. Implementation not started |
| 4 | Implement BSNA-FTS1 | Section 10 of the proposal passes on Node 24 | Next code task |
| 5 | Connect Studio to the existing ERC-20 compiler and local RPC | A real deploy returns chain id, tx hash, and contract address; BNB and SPL stay visibly unavailable | Not started |
| 6 | Point Studio at the asset service for logos | Upload rejection and metadata hash shown in the UI | Not started |
| 7 | Add the RPC methods a stock wallet needs | `eth_call`, `eth_estimateGas`, fee views, `eth_getTransactionByHash`, covered by tests | Not started |
| 8 | Re-run disposable regtest deposit and batch-data E2E | New result note, or an explicit statement that the daemon was unavailable | Not re-run |
| 9 | Explorer, public testnet, CI, production ops | Out of reach until 4–8 are real | Not started |

## H. Sitrep

### Inspected

Both repositories' git state, the L2 source tree, the whitepaper's presence, the security register, the work queue, Studio, the Qt SilverForge page, the asset service, and the EVM gas, deposit, settlement, and withdrawal paths.

### Verified working in this session

Local EVM suite (305 before the new file), asset-service suite, BSNA-20/721 metadata contract tests, Python v0.6 and v0.9 fixtures, Studio production build, and the new native-gas accounting tests (4/4).

### Failed and fixed

The first gas-test draft expected a contract nonce of 0 after calls. EthereumJS leaves the nonce at 1 after creation. The assertion was corrected to 1. No production code path was changed to hide the result. Re-run of that file passed 4/4.

### Files changed in this session

- `execution/evm/src/depositPrelude.ts` — export `SATOSHI_TO_WEI`
- `execution/evm/tests/btcsGasAccounting.test.ts` — new
- `execution/evm/README.md` — gas denomination section
- `README.md` — test-count line
- `docs/BSNA-FTS1-PROPOSAL.md` — new proposal
- `docs/BSNA-20-721-SPECIFICATION.md` — status line only
- `docs/BSNA-STANDARD-PROPOSAL.md` — status line only
- `docs/SECURITY-GAP-REGISTER.md` — SG-02 corrected, addendum added
- `docs/WORK-QUEUE.md` — this session's tasks prepended
- `docs/reports/BTCS-L2-FULL-PROJECT-AUDIT-2026-10-22.md` — this file
- `.gitignore` — `studio/dist/`

`btcs-core` was not modified. No commit was created. No push was attempted.

### Full-suite confirmation

After the gas test was added, `npm test` in `execution/evm` on Node v24.17.0 passed **309/309** in about 154 seconds, exit 0. That is the pre-change 305 plus the 4 new tests. `npm run typecheck` also passed after the change.

### Remaining blockers

See section F. The next safe code task is the BSNA-FTS1 reference contract and its section 10 tests, without a fake Studio button and without enabling withdrawals.

### Risk requiring Joshua

The five decisions in section F. In particular, do not advertise trustless exits, and do not treat chain id 31337 as the public BTCS L2 id.

## I. Resume

```bash
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
cd /home/user/Silver-Labs/btcs-l2
git status --short
git log -1 --oneline
# Next implementation, only after reading docs/BSNA-FTS1-PROPOSAL.md:
# add contracts/token/BSNAFTS1.sol and the section 10 tests.
# Do not replace SimpleERC20 or BSNA20. Do not enable withdrawals.
```

## J. Master checklist tracker

| # | Milestone | Status |
|---|---|---|
| 1 | Project audit and baseline | Evidence recorded in this file. Not a signed release audit. |
| 2 | BTCS L1 connection and settlement | Deterministic tests pass. Live regtest not re-run today. |
| 3 | EVM execution and BTCS gas | Local execution and exact native debit verified. Public chain id and fee-recipient policy open. |
| 4 | Four token options | ERC-20 and BSNA-20 contracts exist and are not wired to a UI. BSNA-FTS1 is a proposal. BEP-20 and SPL are absent. |
| 5 | SilverForge UI | Shell only. Build passes. Deploy does not run. |
| 6 | Wallet and explorer | L1 Qt wallet unchanged by this session. No L2 wallet flow. No explorer. |
| 7 | Developer platform | Local RPC and docs exist. Not enough for an outside developer to deploy unassisted. |
| 8 | Security and QA | Local suites pass. Critical exit and proof gates are open on purpose. |
| 9 | Release and operations | No testnet package and no production approval. |

Verified-complete milestones: **0 / 9**. Milestone 3 is the furthest along, and it is still a local harness.
