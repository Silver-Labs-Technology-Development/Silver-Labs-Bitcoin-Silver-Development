# BTCS L2 whitepaper v1.5 alignment report

Date: 2026-10-22
Status: **historical alignment snapshot** from earlier in this session. This is
not a production certification. Current evidence and release status are in
`docs/ALPHA-RELEASE-CHECKLIST.md`, `docs/WORK-QUEUE.md`, and
`docs/PUBLIC-RELEASE-STAGES.md`.

> **Later same-day update (2026-10-22):** the full EVM suite is now **366 tests,
> 365 pass, 1 skipped live BNB, 0 fail, 187.3s**, typecheck clean. The 309/314
> figures below are historical. SG-01 gained integrated local partial
> `gettxoutproof`/header verification in confirmation and deposit paths, but
> canonical most-work selection, peer consensus, and finality remain open.
> SilverPay Wallet has a read-only L1/L2 slice only; signing, send/receive,
> recovery, history, token/NFT display, Silver Scan, NFT lifecycle, and
> integrated E2E remain absent. Public developer test is **NOT STARTED/BLOCKED**,
> production readiness is **NOT GRANTED**, and public production release is
> **NOT AUTHORIZED**.

> **Later product decision (2026-10-22):** SilverPay is now the unified
> Silver Labs wallet-and-payments product. The separate Silver Wallet product
> is retired from the roadmap and the empty sibling `silver-wallet` repository
> is not a required dependency. SilverPay Wallet is Phase 1; SilverPay Payments
> is Phase 2 and remains planned. The historical comparison below is retained;
> references to a separate Silver Wallet should be read through this decision.
> See `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.6.md` Section 100 and
> `docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

## Source files

| Document | Path | Treatment |
|---|---|---|
| v1.5, primary design reference | `/home/user/Downloads/BTCS_L2_Technical_Whitepaper_v1.5.md` | Read in full. 3,457 lines. SHA-256 `2530d66d83298dabadc24ec57bac1845aabd8bf4c98ba62e4009451a5583f6ce`. Not modified. |
| Identical download copy | `/home/user/Downloads/BTCS_L2_Technical_Whitepaper_v1.5 (1).md` | Same hash. Not modified. |
| Repository whitepaper | `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md` | Left unchanged. It is the 2026-10-21 repository revision, not the older Downloads v1.2. |
| Older Downloads v1.2 | `/home/user/Downloads/BTCS_L2_Technical_Whitepaper_v1.2.md` | Dated 2026-10-11 in its snapshot. Differs from the repository file. |
| Implementation evidence | `docs/reports/BTCS-L2-FULL-PROJECT-AUDIT-2026-10-22.md` and the commands recorded there | Local suites were run in that session. Live Core regtest E2E was not re-run. |

v1.5 was not copied over the repository whitepaper. Importing it later should be a new file, byte-for-byte, with the hash above. Do not edit that import in place.

## How to read v1.5

v1.5 says its new decision snapshot and Sections 89–96 control gas currency, BSNA scope, wallet compatibility, and external-chain boundaries. Earlier sections still govern unresolved rollup-security requirements. The v1.3 and v1.4 checkpoints inside the file are historical, and v1.5 says they were not independently rerun by the document editor.

That rule matters because the file disagrees with itself:

- The v1.3 and v1.4 snapshots say deposit, batch-data, and anchor regtest runs were reported passing, with a 254-test suite and HEAD `d9ae157`.
- The later “Current stage map” and “next work” block, carried forward from the 2026-10-11 v1.2 text, still say the deposit E2E is not demonstrated and that `BTCS-L2-STAGE4-001` is the next task.
- Section 18 still says full batch-data publication and live publication are outstanding.
- Section 2.6.2 still names the profile `btcs-l2-local-v0.11-osaka`.

The repository’s own v1.2 file was updated on 2026-10-21 and is closer to the code for Stage 4: it records a 242-test run, a passing deposit E2E, anchor publication, and 16 KiB batch reconstruction. v1.5 did not absorb that repository snapshot. It absorbed the older Downloads v1.2 body, then added v1.3, v1.4, and Sections 89–96.

At the time of this report the code was ahead of every test count in v1.5. On 2026-10-22, branch `experimental/deposit-prelude-v1` at `148d14f`, Node v24.17.0, `execution/evm` `npm test` passed 309/309 after `tests/btcsGasAccounting.test.ts` was added. That run is historical local-prototype evidence; the current run is 366 tests (365 pass, 1 skip) and is still not the definition of done in Section 87.

## Material differences between repository v1.2 and v1.5

What v1.5 adds, and the repository whitepaper does not have:

- Owner-direction snapshot for BTCS as L2 gas, BSNA as an asset family, MetaMask as a custom network, and SilverForge as separate chain adapters.
- Provisional fungible profile name `BSNA-F1`.
- Explicit statement that chain id `31337` is development-only.
- v1.4 release gates: trusted/federated interim model; optimistic proofs only if L1 can enforce them; validity proofs are research; withdrawal, challenge, proof submission, and bond slashing stay disabled.
- Sections 89–96, including the BSNA-F1 acceptance list and Tasks A–G.
- Section 86 retitled from “Final Protocol Position” to “Historical Long-Term Protocol Proposal — Conditional, Not Approved”. The optimistic BitVMX rollup is no longer described as the approved production protocol.

What the repository v1.2 still says more accurately than the inherited v1.5 body:

- `e2e:deposit` exists, mines 201 funding blocks because coinbase maturity is 200, and a regtest run was recorded. v1.5’s carried Stage 4 task still says 101 funding blocks and that the npm script is missing.
- Deposit reorg recovery exists as a fail-closed, address-level prototype. v1.5’s carried deposit paragraph says there is no safe resolution after a spent credit.
- The repository snapshot names the deposit watcher, cross-process lock, and 16 KiB fragment cap. Parts of the v1.5 body still describe those as future work.

What both documents share, and the code still does not satisfy:

- No trustless exit, fraud proof, validity proof, forced inclusion, or production vault.
- Geth remains a production-candidate drawing, not the running engine.
- Clean-node recovery from L1 data alone is a hard gate and is not demonstrated.
- Public chain id, unsafe/safe/finalized heads, and a stock-wallet RPC surface are not done.

## Naming conflict to resolve before more token code

Three names are now in play. None has a ratified standard plus a passing conformance suite.

| Name | Where it appears | What it is |
|---|---|---|
| `BSNA-F1` | v1.5 Sections 89–90 and 94–96 | Provisional fungible profile. v1.5 says the name may change before ratification. |
| `BSNA-FTS1` | `docs/BSNA-FTS1-PROPOSAL.md`, written 2026-10-22 from the earlier product checklist | A detailed proposal: atomic units, immutable supply/burn/pause policy, custom errors. Not implemented. |
| `BSNA-20` / `BSNA-721` | `contracts/token/BSNA20.sol`, `BSNA721.sol`, asset-service profiles | ERC-20/721 wrappers plus an `IBSNA` metadata view. Metadata tests passed 5/5. They scale constructor amounts by `10 ** decimals()` and do not match the F1 or FTS1 supply rules. |

Recommended resolution: do not add another contract until the owner picks the public name. Treat the technical rules in `docs/BSNA-FTS1-PROPOSAL.md` as candidate content for the v1.5 `BSNA-F1` profile, not as a second standard. Do not relabel `BSNA20` as either name. v1.5 is the design reference for the intended profile; the proposal is the more specific draft; the Solidity files are the only implemented tokens.

## Conflicts between v1.5 and the code

| Topic | v1.5 | Code and tests | Recommended resolution |
|---|---|---|---|
| Withdrawal execution | Sections 68–70 and the v1.4 gate: do not implement withdrawal, challenge, proof, or slashing until approved. Section 26 specifies a proof-backed exit. | `withdrawal.ts`, `withdrawalService.ts`, and `l1PayoutAdapter.ts` exist. `canProcessPayout()` is hard-coded false. The id is not the Section 27 context hash. Tests in the 309 cover the disabled lifecycle. | Leave the code disabled. Do not extend it and do not set the enable flags. It is not the Section 26 protocol. |
| Execution engine | Sections 9, 11, 59, and 66 draw a Go/Geth production candidate. Section 2.6.2 also records EthereumJS as the running harness. | `execution/evm` uses EthereumJS VM, Osaka, chain id `31337`. No Geth package. | Keep EthereumJS as the prototype. Do not start a Go rewrite to match the diagram. A production-engine decision stays open. |
| Chain profile id | Section 2.6.2: `btcs-l2-local-v0.11-osaka`. | `LOCAL_CHAIN_PROFILE` is `btcs-l2-local-v0.12-deposit-prelude` in `execution/evm/src/blockProcessor.ts`. | Code is the implemented profile. Update a future whitepaper revision; do not rename the live profile to match stale prose. |
| L1 development RPC | Section 6.2: `silverlabsl2_getinfo` on branch `silver-labs-l2`, commit `e685628d97`. | That commit is not in this Core clone. The branch is not present. No `silverlabsl2_getinfo` symbol under `src/`. Current Core branch is `main` at `067be9eaef`, with uncommitted SilverForge navigation that this session did not edit. | Do not treat Section 6.2 as present in this tree. Recover that commit from the remote that actually has it before relying on it. |
| Deposit confirmations | Section 24 initial target: 12 BTCS confirmations. | `requiredConfirmations` is a caller-supplied integer `>= 1`. The E2E uses its own configured threshold. | Keep the parameter explicit. Do not silently change the E2E to 12. Record 12 as a target, not as current behavior. |
| Funding-block count | Carried Stage 4 task: mine 101 blocks, then two confirmations. | `regtest-deposit-settlement-e2e.ts` sets `REGTEST_COINBASE_MATURITY = 200` and mines 201 funding blocks. | Follow the code. The 101-block instruction would leave coinbases immature. |
| Repository layout | Section 60 expects `node/`, `derivation/`, `batcher/`, `bridge/`, `verifier/`, `proof/`. | Those directories are absent. The live layout is `execution/evm`, `settlement/v09`, `sequencer` (Python line sorter), `services/asset-service`, `studio`, `contracts`, `docs`. | Do not create empty directories to match the drawing. |
| Head model | Section 14 requires unsafe, safe, and finalized heads on the RPC. | RPC has a single canonical tip. No finality labels. | Not implemented. Do not fake finalized responses. |
| Wallet RPC | Section 67 and 89.3 require `eth_call`, `eth_getTransactionByHash`, `eth_estimateGas`, `net_*`, and a native-currency network config. | Implemented: `web3_clientVersion`, `eth_chainId`, `eth_blockNumber`, block lookups, receipts, code, storage, balance, nonce, logs, `eth_sendRawTransaction`, `btcs_dev_mine`. The listed wallet methods are absent. No `nativeCurrency` metadata. | Next RPC task. A MetaMask click-through cannot pass Section 94 yet. |
| Reported suite size | v1.4 text: 254/254 at `d9ae157`. | 309/309 at `148d14f` on 2026-10-22, including later deposit, withdrawal, and gas tests. | Quote the 2026-10-22 run for current status. Quote 254 only as the v1.5 historical report. |
| BNB, Solana, website, Online Forge | Section 93: reported as started, not verified. | No BNB, opBNB, Solana, or SPL source in `btcs-l2` or the SilverForge Qt page. `silver-wallet`, `silvex`, and `tools` are empty. | Describe them as not present in the inspected trees, not as in-progress code. |
| Gas end-to-end | Section 89.2 lists denomination, fee debit, receipts, deposit interaction, restart, and clean-node reconstruction as separate proofs. | `SATOSHI_TO_WEI` is `10^10`. One BTCS (`10^8` sats) is `10^18` wei. `tests/btcsGasAccounting.test.ts` checks the native debit, priority fee to the zero-address coinbase, reverted-call debit, underfunded rejection, and reopen. Deposit credit uses the same constant. Clean-node reconstruction from L1 is not proven. | Local gas debit is verified. The L1-to-L2 funding path and wallet display are not. |

## Security gates carried from v1.4 and Section 87

These remain open. A passing EVM suite does not close them.

| Gate | Status |
|---|---|
| Stakeholder sign-off on exit, challenge rights, bonds, forced inclusion, and vault custody (v1.5 Q1) | Not recorded. The architecture decision record in the repo still has unchecked approval boxes. |
| L1 inclusion is trusted Core RPC, not a canonical SPV proof (SG-01) | Open for production. At report time only unit proof primitives existed. Later local partial proof verification was integrated into confirmation/deposit when `gettxoutproof` is available; the header/active chain is still trusted and canonical selection/finality remain absent. |
| Unilateral withdrawal and fraud/validity proofs (SG-02, SG-03, Sections 26–44, 87) | Not implemented as specified. Disabled prototype code must stay disabled. |
| Source-specific deposit attribution after spend (SG-04) | Partial. Address-level freeze can false-positive. |
| Clean-node recovery from published L1 data only (Sections 5.1, 22, 48, 72) | Partial. Batch bytes can be reconstructed and re-executed. A fresh node rebuilt only from L1 is not demonstrated. |
| Forced inclusion, 24-block target (Section 16) | Not implemented. |
| Independent Go/Python/verifier corpus (Section 21) | Not implemented. Python v0.6/v0.9 is an older account machine. The 14 v0.9 tests and v0.6 verifiers passed; they do not match EthereumJS state roots. |
| Production vault is not a dev key (Sections 23, 75) | Not implemented. |
| `silverlabsl2_getinfo` | Not in this Core tree. |

## Traceability table

Status values: **Verified** means a command in the 2026-10-22 audit exercised it. **Partial** means a real subset exists. **Not implemented** means no working path. **Conflict** means the code and the design disagree and should not be silently merged. **Blocked** means an owner or specialist decision comes first.

| v1.5 requirement | Implementation | Test evidence | Status | Remaining work |
|---|---|---|---|---|
| §7, decision 1. Preserve BTCS L1 identity. No consensus change for BSNA. | Core `main` not modified by the L2 sessions. PoW/UTXO client remains Bitcoin Silver Core. | Not re-run. L1 binaries exist at `build/bin/bitcoinsilverd` and `build-noipc/bin/bitcoinsilverd`. | Partial | Do not change consensus. Section 6.2’s RPC claim is absent here. |
| §8. Do not assume covenants the chain does not have. | ADR `docs/ARCHITECTURE-DECISION-RECORD-2026-10-22.md` records Script limits as researched, not as a proof system. | No opcode-capability test was run this session. | Partial | Specialist review before any dispute script. |
| §11, §2.6.2. EVM prototype on EthereumJS, chain id 31337, Osaka. Geth is only a candidate. | `execution/evm/src/config.ts`, `blockProcessor.ts`. Profile `btcs-l2-local-v0.12-deposit-prelude`. | 309/309 on Node v24.17.0, including contract deploy, calls, receipts, logs, and reopen. | Verified as a local harness. Conflict on the profile string in §2.6.2. | Do not publish 31337 as the public id. Do not start Geth to satisfy the diagram. |
| §12. Deterministic execution, fixed base fee, coinbase, chain id, gas. | Processor rejects a non-zero coinbase. Genesis base fee is 1 gwei. | Gas tests plus the broader suite. | Verified locally | Fee-recipient policy is the zero address. That is prototype accounting, not a treasury decision. |
| §13–14. Versioned L2 block and unsafe/safe/finalized heads. | Block records exist. One canonical tip. No three-head RPC. | Block processor tests in the 309. | Partial | Do not invent finalized responses. |
| §15. Development sequencer orders and executes. Production sequencer is not the owner of funds. | `transactionPool.ts` `DevelopmentSequencer`, `btcs_dev_mine`. Python `sequencer/sequencer.py` only sorts lines. | Transaction-pool tests in the 309. | Partial | In-memory pool is lost on restart. No failover. |
| §16, §31–32. Forced inclusion, 24-block target. | No L1 forced-transaction format or derivation queue. | None. | Not implemented. Blocked on the v1.4 decision. | Specify before coding. |
| §17–20. Reconstructible batch data, commitment chain, parent links. | `settlementBatch.ts`, `settlementEnvelope.ts`, `btcsL1BatchData.ts`, `btcsL1Anchor.ts`. 16 KiB / 35-byte chunk cap. | Codec and replay tests in the 309. Live `e2e:batch-data` and `e2e:anchor` were not re-run on 2026-10-22. Prior result docs exist. | Partial. The §18 “not yet published” sentence is stale. | Re-run disposable regtest publication before calling the live path current. |
| §21. Independent Go, Python, and verifier agreement on one corpus. | Python v0.6/v0.9 and the TypeScript EVM are different machines. | `tests/test_v09_protocol.py` 14 OK; `verify_v06.py` PASS. They do not compare to EthereumJS roots. | Not implemented for the EVM corpus | Do not claim independent-implementation agreement. |
| §22, §48, §69, §72. Clean node deletes local state and rebuilds from BTCS data. | Batch reconstruction plus execution replay exist. Checkpoint recovery still compares against local canonical history. | `cleanNodeRecovery.test.ts` is in the 309 and is not the Section 22 procedure. | Partial | This remains a hard gate. |
| §23, §58, §75. Production vault is not a dev wallet. | No vault graph. Deposits credit an L2 balance after trusted RPC confirmation. | Deposit unit tests in the 309. | Not implemented | Keep prototype custody labeled trusted. |
| §24–25, §10.4. Deposit id binds tx, output, recipient, and amount. Credit once. Reorg removes the credit. 12 confirmations. | `btcsL1Deposit.ts`, `depositPrelude.ts`, watcher, reorg accounting and recovery. Duplicate ids are rejected. Confirmations are caller-chosen, not pinned at 12. | Deposit and reorg tests in the 309. Live E2E not re-run today. | Partial. Conflict with the stale “no spent-credit recovery” sentence and with the fixed 12-confirmation target. | Keep attribution limits explicit. Do not change the confirmation default without a decision. |
| §10.4, §28, §77. Redeemable L2 BTCS never exceeds secured L1 value. | `calculateDepositAccounting` checks credited wei against secured deposit wei for the records it sees. It is not a vault-wide production invariant, and it is not source-specific after funds mix. | `depositReorgAccounting.test.ts` in the 309. | Partial | Do not describe this as the production invariant. |
| §26–30. Proof-backed withdrawal, contextual id, dust rules, indexer-independent consumption. | Disabled lifecycle only. Payouts cannot broadcast. Id is not Section 27. | `withdrawal.test.ts`, `withdrawalLifecycle.test.ts`, payout adapter tests in the 309. | Conflict | Freeze. Do not enable. |
| §33–44, §52, §73–74. Proposer, bonds, challenger, 288-block window, dispute game, EVM equivalence. | No implementation. ADR leaves the proof path unsigned. | None. | Not implemented. Blocked | Specialist review before any dispute code. |
| §45–47, §78–80. Publication cost, batch size, and proof benchmarks. | Batch cap is 16 KiB in code. No cost campaign. | Codec limit tests. | Not implemented | Benchmark before freezing economics. |
| §49. Reorgs of deposits, batches, commitments, disputes, and withdrawals converge across two implementations. | Deposit watcher and batch-data scanner handle shallow reorgs in unit tests. One implementation. Disputes and withdrawals are out of scope. | Availability and deposit-watcher tests in the 309. Live reorg E2E not re-run. | Partial | One implementation is not the Section 49 acceptance test. |
| §50–54. Threat models for bridge, data, proofs, sequencer, and EVM resource limits. | Some deposit, fragment, and gas-limit checks exist. Proof and forced-inclusion rows have no code. Block gas limit is 30,000,000. Transaction gas cap follows Osaka. | Trust-boundary, batch-data, and harness limit tests in the 309. | Partial | Map each open threat to a test before claiming the row. |
| §55, §14. RPC exposes unsafe, safe, and finalized. | Not exposed. | RPC tests cover the methods that exist. | Not implemented | Add only with a real definition of each head. |
| §56–57, §82. Versioned upgrades. Emergency stop cannot seize balances. | No upgrade authority or emergency stop. | None. | Not implemented | Governance is an owner decision. |
| §59. Borrow Geth. No second native coin. No new L1. | EthereumJS borrowed instead of Geth. One native balance. No second gas token. | Gas tests show the token contract does not pay gas. | Partial. Conflict on Geth versus EthereumJS. | Keep one native gas asset. Engine choice stays open. |
| §60. Drawn repository tree. | Actual tree differs. See conflicts. | Directory listing, 2026-10-22 audit. | Conflict | Do not reshape the repo to match the drawing. |
| §63–66. Toolchain, private L1, deterministic transfers, then EVM. | Core builds exist. Python transfer prototype passed. EVM harness passed. | Commands in the 2026-10-22 audit. | Partial | Multi-node private L1 harness is not the current regtest setup. |
| §67, §89.3, §94.1–3. Wallet RPC, chain id, native BTCS balance, signed tx, fee receipt. | Subset of RPC. Gas debit verified in-process. No MetaMask session. | `btcsGasAccounting.test.ts` 4/4; full suite 309/309. No browser run. | Partial | `eth_call`, `eth_estimateGas`, `eth_getTransactionByHash`, `net_version`, native-currency metadata, then a disposable-wallet test. |
| §68–70. Settlement adapter and bridge prototype, including a marked development withdrawal. | Anchor, batch data, and deposit paths exist. Withdrawal payout is hard-disabled, which is stricter than a marked prototype payout and correct under the v1.4 gate. | Unit tests in the 309. Live publication not re-run. | Partial | Keep payouts off. Re-run disposable publication tests. |
| §89.2, §94.4. Exact L1-satoshi to L2-wei mapping, including boundaries. | `export const SATOSHI_TO_WEI = 10n ** 10n`. Overflow past uint256 is rejected. | `depositPrelude.test.ts` and the new gas test. | Verified for the constant and the happy-path debit | Add an explicit boundary test list to the BSNA/gas docs if new edge values appear. Wallet metadata still does not say “BTCS”. |
| §90, §94.5–6, §95 Tasks C–D. `BSNA-F1` spec, reference contract, transfer/approve/mint/burn conformance. | Spec under the other name only. `BSNA20` is a different profile. | Asset-service contract tests 5/5 for BSNA-20/721 metadata, not for F1. | Not implemented. Name conflict. | Owner picks the name. Then implement beside `BSNA20`, with Section 94 tests. |
| §90.2, §92, §94.7–8. SilverForge configure, logo, permissions, sign, deploy, receipt, failure without fake success. | Studio Deploy sets a status string and does not send a transaction. Qt buttons are disabled. Asset service stores local logos and metadata. | Studio `npm run build` passed. Asset-service tests 80/80. No browser deploy. | Partial | Connect the UI to a real RPC deploy, or keep the button disabled. Do not report a fake success. |
| §91, §95 Task F. Ethereum, BNB, and Solana adapters with their own fee assets. No shared supply. | No adapter code. | None. | Not implemented | One adapter at a time, after BTCS L2 BSNA-F1 is real. Do not add selector buttons that only simulate a deploy. |
| §92. No seeds sent to Forge servers. | Studio has no key field. RPC has no `eth_accounts`. | Inspection of `TokenStudio.jsx` and `rpc.ts`. | Partial | Keep that property when wallet connection is added. |
| §93. Evidence discipline. Reported BNB/Solana/Qt/website work is not completion. | Qt SilverForge page is a static “Coming Soon” panel. Uncommitted Core navigation is unwired from this session’s point of view. | `silverforgepage.ui`, `silverforgepage.cpp`. Qt was not rebuilt. | Partial | A regtest GUI launch is not an L2 connection. |
| §94.9–10. Token state survives replay. Report separates local success from bridge and external chains. | Counter state survives processor reopen. No BSNA-F1 token does. The 2026-10-22 audit separates those claims. | Block processor reopen tests. | Partial | Apply the same reopen test to the future reference token. |
| §87. Definition of done, through user recovery after sequencer shutdown. | Stops well before challenge, withdrawal proof, and recovery. | 309 local tests. | Not implemented | Do not declare a public security testnet on the current tree. |
| §95 Task A. Audit before coding. | `docs/reports/BTCS-L2-FULL-PROJECT-AUDIT-2026-10-22.md` and this file. | Commands listed in that audit. | Verified as an audit, not as a release | Read it before the next code change. |
| §95 Task B. Confirm prototype gas. | Denomination, debit, receipt gas, reopen of the processor balance. | `tests/btcsGasAccounting.test.ts`. | Partial | Wallet agreement and clean-node reconstruction remain. |
| §95 Task G. Keep security gaps independent of token minting. | `docs/SECURITY-GAP-REGISTER.md`, with SG-02 corrected on 2026-10-22 to say the disabled code exists. | Register plus withdrawal tests. | Partial | Q1 sign-off is still absent. |

## Queue update

`docs/WORK-QUEUE.md` now has a v1.5 section. Acceptance criteria come from Sections 89.2, 94, and 95. Completed local evidence is marked ready for review, not complete. Tasks that v1.5 still requires, and the code does not have, stay open.

The carried v1.5 instruction to implement `BTCS-L2-STAGE4-001` is obsolete in this tree. The npm script, preflight, and README already exist. Do not rebuild them to satisfy the stale paragraph.

## What was not done

- The download was not edited.
- `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md` was not replaced or rewritten.
- No L1 consensus change, no withdrawal enablement, and no new token contract.
- Live regtest E2E commands were not run.
- No commit and no push.

## Owner decisions still required

1. Ratify the fungible profile name: `BSNA-F1`, `BSNA-FTS1`, or another name. Until then, do not deploy a third token.
2. Sign the v1.4/v1.5 exit and proof choice. Until then, payouts, challenges, and slashing stay disabled.
3. Choose whether the zero-address coinbase remains the fee sink.
4. Choose the public chain id before any shared network. `31337` stays local.
5. Decide whether the next external adapter is in scope at all. v1.5 allows one adapter at a time and does not make it part of the EVM.
6. Decide whether to import v1.5 into the repository as a new immutable file after this report. The recommended path is `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.5.md`, copied byte-for-byte, with v1.2 left in place.
