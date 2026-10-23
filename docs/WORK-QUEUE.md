# BTCS L2 — Work Queue

Purpose: Track tasks, saved deliverables, reviews, and next steps.

## Trust-critical hardening — 2026-10-22

All work is uncommitted on `experimental/deposit-prelude-v1` (HEAD
`148d14f4247ca3dbb1a4f0e69a4d2075e0666993`). These rows are evidence of local
tests, not production or trustless-settlement claims.

## Release status — independent, not implied by test results

| Status | Current state | Evidence boundary |
|---|---|---|
| Local prototype | **PARTIAL** | Real local components and focused tests exist; SG-01 canonical selection, SG-02/SG-03, SilverPay signing/send/receive/history, Silver Scan, NFT lifecycle, and integrated restart E2E remain incomplete. |
| Public developer test | **NOT STARTED / BLOCKED** | No public testnet topology, hardening, monitoring, or approval. |
| Production-readiness approval | **NOT GRANTED** | No independent audit, security sign-off, operations review, or legal review. |
| Public production release | **NOT APPROVED / NOT AUTHORIZED** | No real-value withdrawal, payment, bridge, or settlement path is authorized. |

## Public-release Stage 1–5 tracking

Detailed definitions, acceptance criteria, and current evidence:
`docs/PUBLIC-RELEASE-STAGES.md`. These stages are separate from the
whitepaper's technical Stage 1–5 implementation milestones.

| Stage | Owner / role | Dependencies | Acceptance focus | Current evidence | Status | Release-blocking impact |
|---|---|---|---|---|---|---|
| PR-1 Local prototype validation | Engineering Lead; QA/Test Lead; Security Review | Disposable Core regtest, local L2 RPC, asset service, Studio, isolated dirs | Reproducible local setup; real reads/deploys; honest unavailable/stale/partial states; boundaries match code | SG-01 focused 60/60; EVM full suite 366 tests (365 pass, 1 skip); SilverPay service 15/15; Studio adapter 6/6; real L1 read 356 UTXOs; L2 unavailable reported honestly; Studio build passes | **IN PROGRESS / PARTIAL** | Blocks every later stage. |
| PR-2 Private team developer test | Engineering Lead; QA/Test Lead; Product Owner (scope); Security Review | PR-1 evidence; reviewed commit/package; team guide; triage | Invited team can reproduce documented local scope; no real value; integrated journey demonstrated or explicitly excluded | Legacy token Gate B workflow only. SilverPay Wallet is read-only; Silver Scan, NFT lifecycle, and two-account restart E2E are absent. | **PARTIAL — LEGACY TOKEN SCOPE ONLY** | Blocks distribution beyond the invited local team. |
| PR-3 Public developer test (testnet) | Product Owner; Engineering Lead; Security Review; Operations; Legal/Compliance | PR-2 exit; approved testnet topology; RPC/API hardening; monitoring/backups/incident response; legal review | External developers can connect without privileged setup; trusted/indexed/verified labels; abuse controls and rollback | None. Local services are loopback-only. SG-01/02/03 remain open. | **BLOCKED** | Blocks public testnet access and public ecosystem claims. |
| PR-4 Production-readiness approval | Security Review (lead); Engineering Lead; Operations; Legal/Compliance; Product Owner (accountable) | PR-3 exit; independent audit; SG-01/02/03/13 closure; custody/keys; ops/DR; load/adversarial testing; supply chain; legal | All blocking gaps resolved or explicitly risk-accepted; production paths independently reviewed; runbooks exercised; go/no-go recorded | None. No independent audit, production orchestrator, trustless exit, or operations evidence. | **BLOCKED** | Blocks production deployment and real-value pilots. |
| PR-5 Public production release | Product Owner (accountable); Operations (release manager); Security Review; Legal/Compliance; Engineering Lead | PR-4 approval; explicit written authorization; production deployment/rollback rehearsal; live monitoring/support | Named scope matches approval; real-value paths gated; disclosures complete; incident response live | None. | **NOT AUTHORIZED** | Blocks real-value withdrawal, payment, bridge, and settlement paths. Do not change L1 consensus. |

Named approvers remain pending. Role ownership does not imply approval.

| Task ID | Task | Status | Deliverable | Evidence / next action |
|---|---|---|---|---|
| BTCS-L2-SETTLE-001 | Store-bound cross-batch settlement continuity | READY_FOR_REVIEW | `execution/evm/src/settlementContinuity.ts`, `execution/evm/src/btcsL1PublicationStore.ts`, `execution/evm/src/btcsL1PublicationWorkflow.ts`, `execution/evm/tests/settlementContinuity.test.ts`, `execution/evm/tests/btcsL1PublicationStore.test.ts`, `execution/evm/tests/btcsL1PublicationStoreWorkflow.test.ts`, `execution/evm/tests/fixtures/settlementBatchFixture.ts`, `execution/evm/scripts/regtest-anchor-e2e.ts` | Exact height/previous-commitment/parent-hash linking; independent execution replay; atomic/fsynced persistence; fail-closed gaps/overlaps/forks/corruption. `BtcsL1PublicationStore.create/open` now require one continuity store and persist a durable binding; `observe`/`reobserve` require the exact batch value and commit continuity before persisting confirmation. Direct mismatch, gap, competing-genesis, wrong-continuity, missing-binding, and failed-write retry regressions pass. Focused 27/27. Full EVM suite 366 tests: 365 pass, 1 skip (live BNB), 0 fail, 187.3s, typecheck clean (2026-10-22). Not production-closed: no production orchestrator, failed publication write after the continuity commit can leave the cursor one batch ahead until retry, and out-of-band filesystem rebuilds are outside the in-process guard. |
| BTCS-L2-SG01-001 | Local BTCS header/PoW, best-chain selection, and `gettxoutproof` verification integrated into confirmation | PARTIAL / LOCAL BEST-CHAIN SELECTION, CANONICAL OPEN | `execution/evm/src/l1HeaderVerifier.ts` (`BestChainSelector`, `Checkpoint`, `ChainConsensusParams`, `computeChainwork`, `encodeCompact`, `computeNextTarget`, `medianTimePast`), `execution/evm/src/btcsL1CoreRpc.ts`, `execution/evm/src/btcsL1Confirmation.ts`, `execution/evm/src/btcsL1Deposit.ts`, `execution/evm/tests/l1BestChainSelection.test.ts`, `execution/evm/tests/fixtures/btcsL1ProofFixture.ts`, `execution/evm/tests/l1HeaderVerification.test.ts`, `execution/evm/tests/btcsL1Confirmation.test.ts`, `execution/evm/tests/btcsL1Deposit.test.ts` | Local best-chain selection validates candidate headers (80-byte hash, PoW, parent linkage, height, nBits retarget, median-time-past, timestamp sanity) anchored at a trusted checkpoint, and selects the tip with greatest cumulative work (integer-only chainwork, tie-break by lowest hash). When a `BestChainSelector` is provided, confirmation and deposit validate block membership on the locally selected chain and report `local-best-chain-only` (no proof) or `local-best-chain+local-inclusion-proof` (proof present). Partial Merkle proof verification retained when `getTxOutProof` is available. Reorg handling invalidates old fork blocks. Consensus rules verified: 24 focused tests (checkpoint validation, header PoW/linkage/height/serialization, chainwork computation, cumulative-work fork selection, reorg handling, integration with confirmation/deposit paths, fallback model). Full EVM suite 390 tests (389 pass, 1 skip, 0 fail). Typecheck clean. Residual: single RPC source may withhold competing branches; no independent peer consensus, chain discovery, or finality proof. Not trustless SPV. |
| BTCS-L2-BATCH-004 | Require execution verification for batch-data encode/reconstruct | READY_FOR_REVIEW | `execution/evm/src/btcsL1BatchData.ts`, `execution/evm/tests/btcsL1BatchData.test.ts`, script callers | Encode and both reconstruction paths are async, replay the batch, and reject a structurally valid batch with a bogus state root. Focused batch-data tests pass. |
| BTCS-L2-WD-001 | Withdrawal solvency and trusted payout confirmation | READY_FOR_REVIEW | `execution/evm/src/withdrawalService.ts`, `execution/evm/tests/withdrawalLifecycle.test.ts`, `execution/evm/scripts/integrated-e2e.ts` | Required trusted balance and payout-confirmation readers; unfunded/double reservation refused; serialized mutations; atomic/fsynced persistence; reload validation including active reservation = requested amount and reservation reconciliation; failed writes require restart; corrupt store fails closed; `payoutsEnabled` defaults false; caller cannot supply confirmations. Focused 13/13. Not an RPC or trustless exit. |
| BTCS-L2-DEP-002 | Deposit accounting duplicate and mismatch hardening | READY_FOR_REVIEW | `execution/evm/src/depositReorgAccounting.ts`, `execution/evm/tests/depositReorgAccounting.test.ts` | Duplicate secured copies no longer inflate backing; conflicting duplicates throw; deposit-ID mismatch rejected; same-inclusion recipient/amount mismatch reverts or freezes. Focused 24/24. |
| BTCS-L2-L1-005 | Automatic L2 freeze on irrecoverable watcher invalidation | READY_FOR_REVIEW | `execution/evm/src/btcsL1DepositWatcher.ts`, `execution/evm/src/depositRecoveryGate.ts`, `execution/evm/tests/btcsL1DepositWatcher.test.ts` | Optional `chainDirectory`; deep reorg and permanently removed confirmed deposit write a durable fsynced gate; persisted invalidation retries a failed gate write. Focused 9/9. Re-derivation/adoption remains operator-invoked. |
| BTCS-L2-GATE-001 | Durable recovery-gate writes/clears | READY_FOR_REVIEW | `execution/evm/src/depositRecoveryGate.ts` | Atomic temp-file rename plus file and directory fsync. Covered by recovery/watcher tests. |
| BTCS-L2-DOC-002 | Gate B and limitation evidence refresh | READY_FOR_REVIEW | `docs/SECURITY-GAP-REGISTER.md`, `docs/KNOWN-LIMITATIONS.md`, `docs/ALPHA-RELEASE-CHECKLIST.md`, `docs/reports/BTCS-L2-TRUST-CRITICAL-REVIEW-2026-10-22.md`, this queue | SG-02/05/11 updated; SG-13 is now store-bound and records its residual. The 2026-10-22 ecosystem directive supersedes the old B4 wording: logo upload is now required and is enforced in the Studio form, HTTP deploy route, and engine service; the HTTP suite rejects a logo-less deploy. Full EVM suite 366 / 365 pass / 1 skip / 0 fail; asset-service 82/82; Studio build passes. The integrated ecosystem milestone is not yet met. Production/trustless claims remain blocked. |

## Integrated ecosystem milestone — 2026-10-22 (new acceptance bar)

The user requires a reproducible, usable local BTCS L1/L2 developer ecosystem,
not merely independent components. These rows are **not** evidence that the
milestone is complete. The required journey is
`CREATE → DEPLOY → SEE IN SILVERPAY WALLET → SEE IN SILVER SCAN → SEND → RECEIVE → VERIFY → RESTART → VERIFY AGAIN`,
plus the NFT deploy → metadata/image → mint → SilverPay Wallet/Silver Scan →
transfer → verify journey. Use real services and transactions only.

**SilverPay product decision (2026-10-22):** SilverPay is the unified
wallet-and-payments product. The separate Silver Wallet roadmap entry is
retired, and the existing BTCS Silver Wallet application is not a required
dependency. ECO-002 is SilverPay Wallet Phase 1; ECO-009 is SilverPay Payments
Phase 2 and remains planned. See
`docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

| Task ID | Task | Status | Deliverable / current evidence | Next action |
|---|---|---|---|---|
| BTCS-L2-ECO-001 | One documented local environment with health/status | PLANNED / PARTIAL | Studio Nodes page checks L1/L2 endpoints; there is no single startup/shutdown/orchestration or indexing-health view. | Add isolated startup/shutdown scripts, health aggregation, network identity, indexer lag, and disposable test directories. |
| BTCS-L2-ECO-002 | SilverPay Wallet Phase 1 — separate L1/L2 accounts and real wallet | PARTIAL / READ-ONLY PHASE 1 SLICE | `services/silverpay-service/` provides a loopback-only read gateway for L1 network/wallet/UTXOs and L2 network/account reads. `studio/src/pages/SilverPayWallet.jsx` shows separate L1 UTXO and L2 EVM panels, exact sat/wei formatting, and loading/unavailable/stale/partial states. Service tests 15/15, Studio adapter tests 6/6, Studio build passes; real local L1 read returned 356 UTXOs while an unavailable L2 was reported honestly. No signing, send/receive, recovery, history, tokens/NFTs, account switching, or payments. | Add real signing/send/receive only after key-custody and transaction review; then history, token/NFT balances, account switching, restart/recovery, SilverForge/Silver Scan links, and the integrated two-account E2E. Do not describe this read-only slice as a complete wallet. |
| BTCS-L2-SILVERPAY-RO-001 | SilverPay read-only service and Studio L1/L2 slice | READY_FOR_REVIEW | `services/silverpay-service/src/config.mjs`, `src/rpc.mjs`, `src/l1.mjs`, `src/l2.mjs`, `src/server.mjs`, `studio/src/lib/silverpay.js`, `studio/src/pages/SilverPayWallet.jsx`, `studio/src/lib/silverpay.test.js` | Real L1 Core wallet/UTXO and L2 account/network reads; allowlisted RPC methods, loopback bind, cookie/env auth, origin allowlist, sanitized errors, no keys or write methods. 15/15 service, 6/6 Studio adapter, production build. Real L1 integration: 356 UTXOs, exact sat conversion; L2 unavailable reported as unavailable. Not browser-tested and not a wallet/payment implementation. | Browser-test against a running L2; add the service to the documented startup path; then proceed to reviewed signing/send/receive design, not by exposing keys to the browser. |
| BTCS-L2-ECO-003 | Mandatory-logo token creation and deployment | PARTIAL | Mandatory-logo enforcement is implemented in the Studio, HTTP route, and engine service; a no-logo deploy regression passes; ERC-20/BSNA-FTS1 deploy, registry, and receipts still pass. Still missing: deployed token visibility in SilverPay Wallet and Silver Scan. | Build the wallet/explorer read path and connect deploy → SilverPay Wallet → Silver Scan. |
| BTCS-L2-ECO-004 | A→B and B→A fungible transfers with real receipts | PLANNED | ERC-20 deploy/transfer primitives and tests exist; no integrated SilverPay Wallet/Silver Scan two-account acceptance flow. | Implement account switching/signing, actual balance reads, receipt/error states, duplicate/restart checks. |
| BTCS-L2-ECO-005 | NFT contract, metadata/image, mint, display, transfer | OPEN / REQUIRED | GUI-014 is disabled because no ERC-721/BSNA-721 reference bytecode exists. | Implement a real audited-style reference contract and engine/metadata/indexer/SilverPay Wallet paths; do not restore placeholder bytecode. |
| BTCS-L2-ECO-006 | Silver Scan for L1 and L2 | PLANNED | No integrated explorer/indexer exists. | Index real blocks, txs, receipts, logs, accounts, tokens, NFTs, settlement links; show pending/confirmed/failed/reorg/indexing states. |
| BTCS-L2-ECO-007 | Integrated two-account restart/failure E2E | PARTIAL | FTS1 HTTP asset test covers deploy/registry/logo/mint only; no SilverPay Wallet/Silver Scan/restart/failure acceptance test. | Build machine- and human-readable E2E that fails on SilverPay Wallet/Silver Scan/state disagreement. |
| BTCS-L2-ECO-008 | Reconcile UI, contracts, asset service, wallet, explorer | PARTIAL | Mandatory-logo behavior and evidence match the docs. The SilverPay read-only L1/L2 slice now exists and is labeled read-only; Silver Scan, NFT lifecycle, wallet signing/history, and integrated E2E remain absent. | Keep docs/UI aligned as SilverPay signing/history, Silver Scan, and NFT work lands; re-run focused, regression, typecheck, production builds, and remove any read-only/complete-wallet ambiguity. |
| BTCS-L2-ECO-009 | SilverPay Payments Phase 2 | PLANNED / LATER | Payments are explicitly deferred; payment requests, QR, merchant checkout, invoices, reconciliation, and settlement integration do not exist. | Define only after Phase 1 and transaction/settlement/accounting/security gates are demonstrated. Do not describe submitted transactions as completed payments. |

Required security sequencing is unchanged: finish SG-13 evidence, advance SG-01
(Core RPC/SPV), then SG-03 and SG-02. Ecosystem work may proceed in parallel
where it does not weaken settlement security. Withdrawals stay disabled.

## Whitepaper v1.5 alignment — 2026-10-22

Design reference, not copied over the repository whitepaper:

`/home/user/Downloads/BTCS_L2_Technical_Whitepaper_v1.5.md`

SHA-256 `2530d66d83298dabadc24ec57bac1845aabd8bf4c98ba62e4009451a5583f6ce`.

Alignment report: `docs/reports/BTCS-L2-WHITEPAPER-V1.5-ALIGNMENT-2026-10-22.md`.

`docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md` stays as the historical repository snapshot. Where v1.5's carried Stage 4 instructions disagree with this tree, follow the code and the alignment report. `BTCS-L2-STAGE4-001` is already present as `e2e:deposit`, preflight checks, and the EVM README. Do not rebuild it.

v1.5 Tasks A–G and the Section 94 acceptance gates:

| Task ID | v1.5 task | Status | Acceptance criteria | Next action |
|---|---|---|---|---|
| BTCS-L2-V15-A | Task A — audit before coding | READY_FOR_REVIEW | Inventory cites paths, tests, and the 2026-10-22 commands. No rewrite of the EVM, deposit, or asset-service paths that those reports mark verified. | Read both reports before the next code change. |
| BTCS-L2-V15-B | Task B — prototype BTCS gas | READY_FOR_REVIEW for the local debit only | `SATOSHI_TO_WEI` is `10^10`. A native transfer debits `value + gasUsed * effectiveGasPrice`. A reverted call still debits gas. An underfunded transfer does not. The debit survives processor reopen. Receipt gas and the zero-address priority-fee credit agree. This does not prove a wallet, a public chain id, or clean-node reconstruction from L1. | `execution/evm` `npm test` passed 309/309 on Node v24.17.0 at the time; current full suite is 366 tests (365 pass, 1 skip, 0 fail). Do not change the fee recipient without an owner decision. |
| BTCS-L2-V15-C | Task C — BSNA-FTS1 specification | READY_FOR_REVIEW | The spec defines identity, supply policy, permissions, metadata, ERC-20 compatibility, verification, and versioning, and it is labeled provisional. `BSNA-20` is not this profile. The product owner chose **BSNA-FTS1**; the contract and tests use that name. | Human review of `docs/BSNA-FTS1-PROPOSAL.md` and `contracts/token/BSNAFTS1.sol`. Do not rename ERC-20 or BSNA-20. |
| BTCS-L2-V15-D | Task D — reference contract and adversarial tests | READY_FOR_REVIEW | `contracts/token/BSNAFTS1.sol` implements fixed/authorized supply, holder burn, admin pause, optional mutable metadata, admin/minter roles, and atomic units. `services/asset-service/tests/contract/bsnaFts1.test.ts` passes 13/13 on Node v24.17.0 and covers fixed-supply mint refusal, explicit-minter requirement and cap, burn policy, pause/unpause, allowance, zero address, metadata freeze/update, renounce, and admin transfer. Compilation uses `viaIR: true` with `evmVersion: london` because the 12-argument constructor otherwise reports stack-too-deep. | Independent review. Live BNB testnet deployment remains unrun. The contract is not a bridge and does not make the token a gas asset. |
| BTCS-L2-V15-E | Task E — RPC, wallet, and Forge path | PARTIAL. RPC methods are implemented and tested. Forge, MetaMask, and native-currency metadata are not done. | Local chain id `31337` / `0x7a69`. `eth_call`, `eth_estimateGas`, `eth_getTransactionByHash`, `net_version`, `net_listening`, and `net_peerCount` are on the existing server in `execution/evm/src/rpc.ts`. `eth_call` does not persist state. Estimates come from real `runTx` searches capped by EIP-7825 (`16777216`), not the 30,000,000 block gas limit. Unknown transaction hashes return null. `net_listening` is false and `net_peerCount` is `0x0`. Node v24.17.0: `npx tsc --noEmit` passed; `npm test` 314/314 (duration_ms 155757.259027) included `tests/rpcExecution.test.ts` and did not include `tests/rpcWalletReadiness.test.ts`; that process test then passed 1/1 (duration_ms 12104.799132). The in-memory pool does not survive restart. Native-currency metadata, `eth_gasPrice`, fee history, and safe/finalized heads are still absent. No seed crosses the Forge. Disabled Studio buttons stay disabled. | Re-run `npm test` so the wallet-process file is in the same suite. Do not mark this row complete. Do not fake MetaMask or Forge success. Evidence: `docs/reports/CLAUDE-HANDOFF-2026-10-22.md`. |
| BTCS-L2-V15-F | Task F — external-chain adapters | PARTIAL. Local BTCS deploy and transfer ran. Live BNB deploy and transfer did not. | One network at a time. BTCS gas is BTCS, Ethereum gas is ETH, BNB Smart Chain gas is tBNB or BNB. ERC-20 and BEP-20 selectors do not make one asset. No shared supply and no bridge. Solana remains out of scope. | `execution/evm/src/assetEngine/`, `execution/evm/contracts/EvmFungibleAsset.sol`, `execution/evm/tests/assetEngine.test.ts`, `npm run acceptance:bnb-testnet`. Evidence: `docs/reports/EVM-ASSET-ENGINE-2026-10-22.md`. Do not mark BNB compatibility complete from the mock or from a chain-id read. |
| BTCS-L2-V15-G | Task G — v1.4 security gates | BLOCKED for protocol code; documentation READY_FOR_REVIEW | Withdrawal broadcast, challenge, proof submission, and slashing stay disabled. SG-01, SG-03, forced inclusion, and clean-node L1 recovery stay open in the register. Token minting is not described as a trustless bridge. | Do not extend `withdrawalService.ts` or set `BTCS_ENABLE_WITHDRAWALS`. Q1 sign-off is still required. |

Section 94 remains the BSNA release gate. Items 1–4 are only partly met by V15-B. Items 5–10 are not met.

Latest RPC evidence is `docs/reports/CLAUDE-HANDOFF-2026-10-22.md`. The 309/309 and 314/314 figures are historical. The current full suite is 366 tests (365 pass, 1 skip, 0 fail) and includes the RPC/wallet files.

## Audit session — 2026-10-22

Evidence report: `docs/reports/BTCS-L2-FULL-PROJECT-AUDIT-2026-10-22.md`.

| Task ID | Task | Status | Deliverable | Next action |
|---|---|---|---|---|
| BTCS-L2-AUDIT-20261022 | Evidence-based product audit against the master checklist | READY_FOR_REVIEW | `docs/reports/BTCS-L2-FULL-PROJECT-AUDIT-2026-10-22.md` | Read the report before editing. Do not rebuild the EVM, deposit, or asset-service paths that the report marks verified. |
| BTCS-L2-GAS-001 | Prove native gas debit on the canonical processor | READY_FOR_REVIEW | `execution/evm/tests/btcsGasAccounting.test.ts`, `execution/evm/src/depositPrelude.ts` (`SATOSHI_TO_WEI` export), `execution/evm/README.md` | Focused file passed 4/4. Full `npm test` result is recorded in the audit. Do not change the fee recipient without an owner decision: coinbase is the zero address. |
| BTCS-L2-FTS1-001 | Specify BSNA-FTS1 without renaming ERC-20 or BSNA-20 | READY_FOR_REVIEW | `docs/BSNA-FTS1-PROPOSAL.md`, `contracts/token/BSNAFTS1.sol` | Name is decided as BSNA-FTS1. Contract conformance tests pass 13/13 on the local BTCS L2 chain. Do not label it verified until a reviewer checks the implementation against the proposal. Do not add a Studio button that only pretends to deploy it. |
| BTCS-L2-FTS1-002 | Integrate BSNA-FTS1 into the asset engine, asset service, and Studio | READY_FOR_REVIEW | `execution/evm/src/assetEngine/fts1.ts`, `execution/evm/src/assetEngine/session.ts`, `execution/evm/src/assetEngine/registry.ts`, `services/asset-service/src/assetEngineService.ts`, `services/asset-service/src/httpServer.ts`, `studio/src/pages/TokenStudio.jsx`, `studio/src/lib/api.js` | Node v24.17.0 evidence: EVM engine FTS1 test 1/1; asset-service FTS1 service test 1/1; HTTP end-to-end test 1/1 (ERC-20 and BSNA-FTS1 deploy, registry list, logo GET, authorized mint, fixed-supply mint refusal); Studio `npm run build` succeeds. Studio supports standard selection, policy fields, registry loading on mount, real receipt display, digest-backed logo URLs, and BSNA-FTS1 authorized mint. NFT deployment is disabled rather than faked. | Independent review and a manual restart/persistence pass. Full EVM and asset-service suites are recorded in the handoff. |

Older rows below were written before this audit. Where they disagree with the audit about withdrawals, Studio completeness, or test counts, the audit is the later evidence. Do not mark those older rows COMPLETE from this session.

## Current priorities

| Task ID | Task | Status | Deliverable | Next action |
|---|---|---|---|---|
| BTCS-L2-CLIENT-001 | Client integration, use cases, and communication | COMPLETE | docs/CLIENT-INTEGRATION-PLAN-v0.1.md | Reviewed and committed as 4d27324 |
| BTCS-L2-CLIENT-002 | Reproducible local client demonstration | READY_FOR_REVIEW | execution/evm/scripts/demo-client.ts, execution/evm/tests/clientDemo.test.ts, execution/evm/README.md | Verified on Node v24.17.0: `npm run typecheck` passes; `npm test` 178/178; no-arg `npm run demo:client` exits 0 and leaves an existing batch file whose `settlement.batchHash` (`0d86d1db…491179`) matches `npm run verify:batch:execution` (PASSED) |
| BTCS-L2-STAGE4-001 | Reproducible, fail-fast L1 deposit-to-settlement E2E | READY_FOR_REVIEW | execution/evm/scripts/regtest-deposit-settlement-e2e.ts, execution/evm/tests/depositE2EPreflight.test.ts, execution/evm/package.json, execution/evm/README.md, docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md | Live run PASS on Node v24.17.0: confirmed 0.1 BTC deposit at L1 height 303; L2 credit persisted/replayed; v2 settlement independently verified with matching state root and recipient balance. BTCS Core requires 201 funding blocks because coinbase maturity is 200. Current typecheck passes; full suite 229/229; preflight tests 11/11. |
| BTCS-L2-SECURITY-001 | Deposit reorg accounting invariant and reorg classification | READY_FOR_REVIEW | execution/evm/src/depositReorgAccounting.ts, execution/evm/tests/depositReorgAccounting.test.ts, docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md, execution/evm/README.md | Specifies and tests `creditedWei <= securedWei` over real deposit-store records and canonical L2 credits; classifies reorg-before-credit, after-credit-before-spend, after-spend, re-inclusion (same/changed inclusion), duplicate and over-credit. Canonical re-derivation/adoption are implemented under SECURITY-002/004; conservative replay-derived spend classification is implemented under SECURITY-005 |
| BTCS-L2-SECURITY-002 | Canonical L2 re-derivation prototype and enforced recovery gate | READY_FOR_REVIEW | execution/evm/src/depositReorgRecovery.ts, execution/evm/src/depositRecoveryGate.ts, execution/evm/src/blockProcessor.ts, execution/evm/tests/depositReorgRecovery.test.ts, docs/DEPOSIT-REORG-RECOVERY-v0.1.md, execution/evm/README.md | Re-derives canonical L2 after an invalidated credit by replaying the untouched prefix into a fresh store and rebuilding from the earliest affected height with the stale credit removed, using only existing `acceptBlock`/`buildNextBlock` primitives; fails closed with a typed `DepositReorgRecoveryError` when a descendant transaction depended on the removed credit. SECURITY-004 adds automatic adoption; SECURITY-005 adds conservative replay-derived spend evidence; SECURITY-006 adds local cross-process locking. Source-specific fungible-credit attribution and multi-host coordination remain partial |
| BTCS-L2-SECURITY-003A | Close deposit recovery gate bypass | READY_FOR_REVIEW | execution/evm/src/blockProcessor.ts, execution/evm/tests/depositReorgRecovery.test.ts, docs/DEPOSIT-REORG-RECOVERY-v0.1.md, execution/evm/README.md | Recovery captures the current canonical view, persists the freeze, and re-derives under the processor operation queue; an in-flight extension is included before the gate and later extensions are refused. SECURITY-006 adds a local OS-level lock for cooperating processes. Verified in the Node v24.17.0 full suite |
| BTCS-L2-SECURITY-004 | Atomically adopt re-derived canonical store | READY_FOR_REVIEW | execution/evm/src/blockProcessor.ts, execution/evm/src/depositReorgRecovery.ts, execution/evm/tests/depositReorgRecovery.test.ts, docs/DEPOSIT-REORG-RECOVERY-v0.1.md, execution/evm/README.md | `recoverDepositReorg` installs the verified candidate by copying immutable records, atomically committing `chain.json`, then clearing the gate; a failed pre-commit adoption leaves the old tip frozen and candidate retryable. Node v24.17.0: typecheck passes; full suite 222/222 |
| BTCS-L2-SECURITY-005 | Canonical EVM spend evidence and conservative reorg classification | READY_FOR_REVIEW | execution/evm/src/blockProcessor.ts, execution/evm/src/depositReorgAccounting.ts, execution/evm/tests/depositReorgAccounting.test.ts, docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md | Canonical replay traces direct and nested value transfers, sender fees, and selfdestructs; incomplete evidence freezes unbacked credits, while complete no-outflow evidence permits re-derivation. Node v24.17.0: typecheck passes; focused accounting tests 20/20; full EVM suite 227/227 |
| BTCS-L2-SECURITY-006 | Coordinate chain writes and deposit recovery across processes | READY_FOR_REVIEW | execution/evm/src/chainDirectoryLock.ts, execution/evm/src/blockProcessor.ts, execution/evm/src/depositReorgRecovery.ts, execution/evm/tests/chainDirectoryLock.test.ts, execution/evm/tests/fixtures/chain-directory-writer.ts, execution/evm/README.md, docs/DEPOSIT-REORG-RECOVERY-v0.1.md | Initialization, canonical writes, read snapshots, checkpoint export, and the complete recovery freeze/rederive/adopt flow use a fail-closed OS file lock and refresh `chain.json`. Two fresh processes serialize genesis and concurrent appends; a stale long-lived processor refreshes, stale/malformed lock tests preserve metadata. Node v24.17.0 typecheck passes; full EVM suite 229/229 |
| BTCS-L2-L1-001 | Reproducible real regtest settlement-anchor publication | READY_FOR_REVIEW (rerun required) | execution/evm/package.json, execution/evm/scripts/regtest-anchor-e2e.ts, execution/evm/scripts/bind-publication-continuity.ts, execution/evm/README.md, docs/REGTEST-ANCHOR-E2E-RESULTS-2026-10-21.md | Historical Node v24.17.0 run PASS: signed transaction with exactly one expected anchor was mempool-accepted, confirmed at block 305, independently matched the 2-block batch commitment, and the confirmed publication record survived store reopen. Batch body was not published. The E2E now requires a bound continuity store and a fresh continuity directory for a new genesis run; the recorded live run predates that change, so rerun with isolated stores before treating the live evidence as current. |
| BTCS-L2-L1-002 | Poll configured L1 deposit outputs and reconcile reorgs | READY_FOR_REVIEW | execution/evm/src/btcsL1DepositWatcher.ts, execution/evm/src/btcsL1DepositWatchStore.ts, execution/evm/src/btcsL1DepositStore.ts, execution/evm/src/btcsL1CoreRpc.ts, execution/evm/tests/btcsL1DepositWatcher.test.ts, execution/evm/README.md | Node v24.17.0 typecheck passes; watcher tests 7/7; integrated EVM suite 236/236. Lifetime OS locks cover cursor and deposit store; durable bounded cursor, confirmed-only records, shallow-reorg invalidation/re-inclusion, temporary RPC fail-safe, and deep-reorg stop are implemented. Watcher reports invalidated IDs; operator invokes L2 recovery. |
| BTCS-L2-L1-003 | Publish and reconstruct settlement batch data from L1 | READY_FOR_REVIEW | execution/evm/src/btcsL1BatchData.ts, execution/evm/tests/btcsL1BatchData.test.ts, execution/evm/scripts/regtest-batch-data-e2e.ts, execution/evm/package.json, execution/evm/README.md, docs/REGTEST-BATCH-DATA-E2E-RESULTS-2026-10-21.md | Live Node v24.17.0 regtest PASS: 4,472 canonical batch bytes published as 128 fragments plus the matching commitment; all transactions confirmed in block 507; reconstruction from Core block outputs matched exact bytes and existing batch hash. Codec/reconstruction tests 6/6; full EVM suite 242/242; typecheck passes. |
| BTCS-L2-L1-004 | Reorg-aware L1 publication data and watcher operation | READY_FOR_REVIEW | execution/evm/src/btcsL1BatchDataAvailability.ts, execution/evm/tests/btcsL1BatchDataAvailability.test.ts, execution/evm/scripts/regtest-batch-data-e2e.ts, execution/evm/README.md, docs/ | A stateless bounded active-chain scan tracks expected anchor/fragments, confirmation depth, and exact reconstruction; it now brackets every scan with an active tip-height and tip-hash re-read and fails closed on a chain extension (height change) or same-height reorganization, so no `available` report can mix two chain states. Deterministic auto tests pass on Node v24.17.0: typecheck clean, focused suite 5/5 (confirmation waiting, orphan reporting, replacement re-inclusion, tip-height extension, same-height reorg), full EVM suite 247/247. A dedicated opt-in regtest (`BTCS_L2_BATCH_DATA_REGTEST_REORG_TEST=1`) live run PASSED on the disposable reorg node (RPC 29446, datadir `btcs-l2-regtest-reorg-20261011`, wallet `btcs-l2-reorg-test`): a 4,472-byte / 128-fragment batch was published and confirmed at L1 height 555, the publication branch was invalidated, the scanner reported `incomplete` with all 129 expected txs orphaned, and the replacement branch re-included all 129 txs with byte-exact reconstruction (orphan count 129 = re-inclusion count 129). Restart recomputes from active Core data; polling cadence remains caller/supervisor controlled. |

## Mandate priority run — 2026-10-21 (autonomous)

| Priority | Task | Status | Evidence |
|---|---|---|---|
| P1 | Checkpoint vs whitepaper v1.2 audit + hardening | COMPLETE | Node v24.17.0 `npm run typecheck` clean; full suite 248/248. Adoption defense-in-depth guard added in `PersistentBlockProcessor.adoptReDerivedStoreUnlocked` (refuses a re-derived candidate that still credits a frozen deposit). Deterministic store ordering: `localeCompare` replaced with code-unit comparison in `btcsL1PublicationStore.ts` and `btcsL1DepositStore.ts`. Regression test added to `depositReorgRecovery.test.ts`. |
| P2 | Real Core regtest deposit flow | COMPLETE | `npm run e2e:deposit` PASS on a fresh isolated `build-noipc` node (RPC 29450): deposit `add1502ed51db1ad9c67120515fa1788bafa161767a856242a60ee7b86c9733d:0`, L1 height 202, 2 confirmations, credited `100000000000000000` wei, state root `0x680666…a9f9b`. See `docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md`. |
| P3 | Deposit reorg recovery scenarios | PARTIAL | Unit recovery/gate/accounting suites green (adoption refusal, freeze, re-derive, re-inclusion, mixed deposits, cross-reopen), plus new adoption-refusal test. Destructive real-Core reorg remains deferred (see Blockers). |
| P4 | L1 settlement publication + independent reconstruction | COMPLETE | `npm run e2e:batch-data` PASS (batch `c31e6c18…`, 128 fragments, 4,472 bytes reconstructed byte-exact, commitment at L1 height 402) and `npm run e2e:anchor` PASS (confirmed at height 204, publication recovered after store reopen). Plus a live destructive reorg run PASS on the disposable node (batch `aae918c8…`, 129 orphaned → 129 re-included, byte-exact). See results doc. |
| P5 | Integrated prototype workflow / runbook | COMPLETE | `docs/INTEGRATED-PROTOTYPE-RUNBOOK.md` (validated deposit → execution → batch-data → anchor → reorg commands and environment caveats). |

### Deliverables produced (2026-10-21)

- `docs/INTEGRATED-PROTOTYPE-RUNBOOK.md` — end-to-end prototype runbook.
- `docs/SECURITY-GAP-REGISTER.md` — honest security/safety gap inventory (SG-01…SG-12).
- `docs/PRIVATE-TESTNET-RELEASE-READINESS.md` — private-testnet/release checklist.
- `docs/REQUIREMENTS-IMPLEMENTATION-MATRIX-v1.2.md` — whitepaper v1.2 requirements→implementation mapping.
- `docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md` — updated with fresh-node deposit, batch-data, anchor, and reorg live evidence.

### Regtest harness environment findings (2026-10-21)

- **`e2e:batch-data` requires a wallet funded with ≥ fragments+1 mature confirmed UTXOs.** It publishes ~129 independent `minconf:1` transactions; after the first spend the only fresh coin is unconfirmed change, so a thinly-funded wallet fails partway with the misleading Core error `The total exceeds your balance when the … fee is included` even though `getbalances.mine.trusted` is large and `listunspent` is empty. Mitigation used: mature 201 coinbases (tip 401). Recommended hardening: have the runner assert/auto-provision enough mature UTXOs.
- **No Core build divergence (earlier hypothesis corrected).** `fundrawtransaction {"minconf":1,"fee_rate":2}` works on both the `build/bin` and `build-noipc` daemons once confirmed UTXOs exist (re-verified on `build-noipc`, RPC 29450). The earlier "build" difference was a misdiagnosis of wallet state. Real requirement: a fee source. `e2e:anchor` (no fee options, line 165) and `e2e:deposit` need `-fallbackfee` when fee estimation is unavailable (e.g. the `build/bin` node on 29443 fails with `Fee estimation failed`); `e2e:batch-data` passes an explicit `fee_rate` and instead needs confirmed UTXOs (previous bullet).
- `COINBASE_MATURITY = 200`; funding flows must mature ≥ 201 coinbases before spending.
- **Harness timeout fragility (fixed).** After mining a block that contains ~129 wallet transactions, the wallet endpoint can exceed the `regtest-batch-data-e2e.ts` 15s RPC timeout on a slow daemon: `getnewaddress` timed out reproducibly right after mining. The script's long-timeout set was extended to cover `getnewaddress` and `getwalletinfo` (orchestration timeouts only; no assertion or validation gate was relaxed).

### Blockers

- `e2e:anchor` reorg mode live evidence captured on 29444 (datadir `btcs-l2-regtest-reorg-20261011`, store `btcs-l2-regtest-reorg-publications-20261011`, wallet `btcs-l2-reorg-test`): original publication invalidated and removed from active chain, state persisted/reopened after invalidation, replacement branch re-included the anchor tx and was confirmed (batch `ebdaabe2…`, confirmed at L1 height 556 in replacement block `18a37616…`). Node had to be unloaded/reloaded between steps because it held no wallet on fresh start.
- Withdrawals/exit security, censorship resistance, and the fraud/validity proof architecture are blocked on an unresolved protocol decision; no mechanism should be invented.

## Acceptance criteria

### BTCS-L2-STAGE4-001

- `npm run e2e:deposit` invokes `scripts/regtest-deposit-settlement-e2e.ts` through the installed local `tsx`.
- Before any mining or transaction construction, the runner verifies: the Core CLI exists and is executable; the data directory already exists and is never created or initialized by the runner; the RPC cookie is readable and syntactically valid; Core RPC is reachable with the configured CLI/data-dir/port; and `getblockchaininfo` reports exactly `chain=regtest`.
- RPC cookie contents are never printed; each failed precondition produces a concise, actionable error and a nonzero exit.
- `execution/evm/README.md` documents prerequisites, environment-variable overrides, the run command, expected side effects (201 mined blocks to satisfy BTCS Core's 200-block coinbase maturity, one regtest deposit transaction and two confirmation blocks, persistent Core wallet/data, temporary L2 scratch cleanup), and safe shutdown of only the test daemon.
- The live run result, transaction/block identifiers, L2 credit, settlement commitment, and limits are recorded in `docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md`.
- Preflight fail-fast behavior is covered by unit tests that do not require a running Core daemon.
- `npm run typecheck` and `npm test` pass.
- On Node v24.17.0, the live regtest E2E passes from the existing dedicated chain at height 101; the recorded deposit has two confirmations and the settlement replay matches the independently derived state root and recipient balance.
- Reorg-after-spend is conservatively detected and freezes the bridge; source-specific attribution among fungible credits and automatic reorg watching remain unresolved.

### BTCS-L2-L1-001

- `npm run e2e:anchor` invokes the local `tsx` script and never starts or stops Core.
- Preflight requires readable cookie, reachable Core, `chain=regtest`, and the configured wallet.
- The runner independently verifies the batch before signing and broadcasting one transaction containing exactly one expected anchor script.
- It verifies the active-chain inclusion through trusted Core RPC and confirms the durable publication state survives store reopen.
- Documentation describes configuration, persistent wallet/data/store effects, safe shutdown, and that the L1 transaction publishes only the batch commitment (not the batch data).
- A live regtest result is saved with transaction, block, and commitment identifiers; destructive reorg mode remains separate and opt-in.
- Node v24.17.0 npm run e2e:anchor passes against a dedicated regtest; the confirmed publication record survives store reopen.

### BTCS-L2-L1-002

- The watcher scans active-chain blocks using an explicit deposit payment script and start height.
- Only canonical deposits meeting their configured confirmation threshold enter the durable deposit store.
- The cursor and recent block hashes persist across reopen; canonical-tip changes rewind to a retained common ancestor and rescan.
- Confirmed deposit inclusions removed by a reorg are durably invalidated; same-identity re-inclusions are verified and re-observed.
- Temporary RPC failures never invalidate records or advance the cursor.
- Invalidated deposit IDs are reported to an operator for the existing L2 recovery workflow; watcher does not credit or mutate L2.
- A reorg deeper than retained history fails closed with an actionable error; one watcher process is the supported operating mode.
- The watcher holds OS file locks on its dedicated cursor and deposit store directories for its lifetime, refuses another owner, and releases on `close()`; stale/malformed locks fail closed.
- Unit tests cover discovery, confirmation delay, cursor reopen, shallow reorg, re-inclusion, deep reorg, RPC failure, and competing owners without Core.
- Node v24.17.0 typecheck passes; the focused watcher suite passes 7/7; the integrated EVM suite passes 236/236 after the shared-store lock addition.

### BTCS-L2-L1-003

- `encodeBtcsL1BatchData` verifies the settlement batch against explicit starting anchors before serializing deterministic canonical JSON.
- Fragments use a versioned `BTCD` marker, the existing 32-byte batch hash, bounded index/count/total-length fields, and 35-byte payload chunks. Each output fits the 83-byte standard OP_RETURN script bound; a batch is capped at 16 KiB and 468 fragments.
- Reconstruction accepts scripts from Core verbosity-2 blocks, joins fragments by index, rejects missing/duplicate/conflicting chunks, enforces canonical JSON, verifies trusted start anchors, and matches the existing batch hash.
- `e2e:batch-data` requires an existing local regtest daemon and loaded test wallet; it never starts/stops Core, publishes every fragment plus the commitment, mines one block, checks active inclusion, reconstructs bytes from that block, and verifies exact bytes/hash.
- The live result file records Core identifiers, fragment count/size, transaction inclusion, and explicit limits; no reorg or production data-availability claim is made.
- Tests cover encoding, round-trip reconstruction, ordering, missing/duplicate/tampered fragments, incorrect anchors/hash, unrelated OP_RETURN data, and scan bounds.
- Node v24.17.0 typecheck passes; the focused batch-data codec/reconstruction suite passes 6/6; live regtest publication and reconstruction pass as recorded in `docs/REGTEST-BATCH-DATA-E2E-RESULTS-2026-10-21.md`.

### BTCS-L2-L1-004

- Availability is `available` only when the anchor and every expected fragment transaction are found on the active chain, each meets the configured confirmation threshold, and canonical batch reconstruction matches the trusted start anchors and batch hash.
- Missing or orphaned publication transactions yield `incomplete`; present but shallow inclusions yield `awaiting-confirmations`. Re-included transactions are revalidated at their replacement block and confirmations are recomputed.
- The bounded scanner fails closed if the chain changes during inspection (either the active tip height or the active tip hash differs when re-read after the scan) or the configured scan exceeds 10,000 blocks/100,000 outputs. Re-checking the tip hash at an unchanged tip height also proves no already-scanned block changed, because the tip commits to its ancestry. It uses trusted loopback Core RPC and does not claim SPV proofs or production finality.
- Restart behavior is stateless: re-run with the same expected transaction IDs, batch hash, start height, and confirmation target. Previous report data is optional and used only to list orphaned/reorganized transaction IDs. There is no bundled timer; the caller or external supervisor schedules repeated polls. The scanner is read-only and has no lock to recover.
- Unit tests cover confirmation waiting, full reconstruction, reorg invalidation, orphan reporting, replacement inclusion, renewed availability, a tip-height extension during a scan, and a same-height reorganization during a scan. Deterministic auto evidence (Node v24.17.0): typecheck clean, focused suite 5/5, full EVM suite 247/247. A dedicated opt-in regtest result records the invalidated and replacement block hashes, transaction counts, reconstruction result, and limits: on the disposable reorg node the orphaned publication block was invalidated (129 expected txs orphaned) and the replacement block re-included all 129 with byte-exact reconstruction, so L1-004 now has live reorg evidence.
- Node v24.17.0 typecheck and the integrated suite must pass; the live reorg scenario is restricted to the dedicated test port/datadir/wallet.

### BTCS-L2-SECURITY-001

- `calculateDepositAccounting` computes `creditedWei <= securedWei` over confirmed L1 deposit records and canonical L2 deposit credits, and reports `unbacked-credit`, `amount-mismatch`, `duplicate-credit`, and `over-credit` without throwing on expected protocol states.
- `classifyDepositReorg` returns a deterministic plan for reorg-before-credit, after-credit-before-spend, after-spend, re-inclusion (same and changed inclusion), and awaiting-credit cases, mapping to `invalidate-l1-only`, `revert-l2-credit`, `freeze-bridge`, `no-op`, or `credit-l2-once`.
- `assessCreditSpend` derives canonical address-level outflow evidence from replay; `classifyCanonicalDepositReorg` freezes on observed or unknown spend and allows re-derivation only after a complete no-outflow trace.
- `docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md` documents the invariant, reorg cases, replay-derived outflow evidence, conservative false-positive policy, and the source-specific fungibility limit; it does not claim trustless or production bridge safety.
- Tests exercise both the pure accounting/classifier and real `BtcsL1DepositStore` + `PersistentBlockProcessor` chains without a BTCS Core node.
- `npm run typecheck` and `npm test` pass; canonical re-derivation is implemented under SECURITY-002/004, and conservative replay-derived spend evidence is implemented under SECURITY-005. Source-specific attribution among fungible credits remains PARTIAL.

### BTCS-L2-SECURITY-002

- `rederiveCanonicalL2AfterDepositInvalidation` replays the canonical prefix into a fresh store via `acceptBlock`, then rebuilds every block from the earliest invalidated credit's height through the tip via `buildNextBlock` with the invalidated deposit operations removed; it uses only existing, verified primitives and verifies that no invalidated credit remains in the re-derived chain.
- Re-derivation fails closed with a typed `DepositReorgRecoveryError` (`rebuild-failed`, `residual-credit`, `output-directory-not-usable`) when recovery cannot be proven; it never fabricates a replacement chain and never mutates the source store.
- `recoverDepositReorg` persists a fail-closed gate (`deposit-recovery-gate.json`) in the source chain store before attempting re-derivation, and leaves it engaged on failure.
- The gate is enforced in `PersistentBlockProcessor.buildNextBlock`, so every canonical-extension path (including the RPC `btcs_dev_mine` → `DevelopmentSequencer` path) is refused while the store is frozen; the freeze persists across process reopen.
- Tests cover: no-op when nothing was credited; removal of an unspent credit (balance/credit effects); preservation of independent post-credit transactions; fail-closed when a descendant spent the credit; continuation blocked on the frozen store; clearing the gate after adoption; re-inclusion crediting exactly once; mixed multi-deposit blocks; deterministic repeated recovery; malformed inputs; existing output directory; and cross-reopen persistence.
- `docs/DEPOSIT-REORG-RECOVERY-v0.1.md` documents the algorithm, the fail-closed cases, the enforcement point, and the remaining gaps (source-specific fungible-credit attribution and cross-process coordination).
- `npm run typecheck` and `npm test` pass (217/217). Automatic adoption was subsequently implemented and verified under SECURITY-004; conservative address-level spend evidence is tracked under SECURITY-005.

### BTCS-L2-SECURITY-003A

- The deposit-recovery gate is enforced in both public canonical tip-advancing entry points, `PersistentBlockProcessor.buildNextBlock` and `PersistentBlockProcessor.acceptBlock`; the private `appendBlockUnlocked` is reachable only through those two gated methods.
- An invalid or unreadable recovery-gate marker fails closed on both extension paths (the operation is refused rather than treated as open).
- Legitimate historical replay, settlement batch verification, and recovery reconstruction still work because they import into separate fresh stores that carry no gate marker; no ordinary bypass of the gate is provided.
- All other canonical mutation paths were audited and cannot extend a frozen store: genesis bootstrap runs only on an empty store, `reconcileTipAfterFailedWrite` runs only inside the append path, and `exportStateCheckpoint` writes to a separate directory.
- Tests cover: `buildNextBlock` rejected on a frozen store; `acceptBlock` rejected on a frozen store with the canonical tip and persisted chain unchanged; the freeze surviving a processor reopen; isolated replay into a separate fresh store succeeding while the source is frozen; and a malformed gate marker failing closed on both paths.
- `docs/DEPOSIT-REORG-RECOVERY-v0.1.md` and `execution/evm/README.md` document the gate as covering both extension entry points (correcting the earlier single-choke-point claim).
- `npm run typecheck` and `npm test` pass (220/220). Store adoption is covered by SECURITY-004; conservative address-level spend evidence is tracked under SECURITY-005.

- Recovery captures the current canonical view, persists the gate, and re-derives while holding the same exclusive operation queue used by both tip-advancing paths. An extension already in progress completes before the snapshot; queued extensions run after the freeze and are refused.
- A deterministic concurrency test proves the recovery snapshot includes an in-flight extension that commits before the gate. The lock is in-process and per processor instance; multiple processes sharing one chain directory are not coordinated.

### BTCS-L2-SECURITY-004

- Operator recovery automatically adopts the fully replay-verified re-derived chain in the running processor.
- Canonical block records are copied before `chain.json`; the atomic metadata replacement is the adoption commit point, so a pre-commit failure preserves the old canonical tip.
- The recovery gate is removed only after the metadata commit; a failed adoption remains frozen and can be retried from the candidate output directory.
- In-memory tip state is reconciled if a failure occurs after the metadata rename.
- Tests prove successful adoption and continuation, persistence across reopen, and retry after an injected pre-commit failure.
- On Node v24.17.0, `npm run typecheck` passes, `npm test` passes 222/222, and `git diff --check` is clean.
- Source-specific transaction attribution among fungible credits and cross-process recovery coordination remain PARTIAL; conservative address-level evidence is tracked under SECURITY-005.

### BTCS-L2-SECURITY-005

- Canonical replay records native-value outflows from top-level transactions and nested EVM calls, transaction fees paid by transaction senders, and selfdestruct balance exits, with block and transaction evidence where available.
- Spend assessment applies to activity at or after the credit's canonical L2 block; later deposits do not erase earlier outflow evidence.
- An observed outflow is treated as potentially spent; a complete trace with no outflow is treated as unspent; an incomplete trace with no positive evidence remains unknown and freezes an unbacked credit.
- `classifyCanonicalDepositReorg` uses that assessment, so an unbacked credit is reverted only when the full canonical trace proves no post-credit outflow.
- Tests cover direct EOA value transfer, internal contract value transfer, selfdestruct, fee-only spend, later funding that raises balance above the prior credit, untouched credits, unknown/incomplete traces, and the resulting freeze/re-derive decisions.
- Documentation states that this is conservative address-level evidence, not source-specific attribution among fungible credits, and that operator recovery is not an always-on L1 watcher.
- On Node v24.17.0, `npm run typecheck` passes, the focused accounting suite passes 20/20, and `npm test` passes 227/227. The work is READY_FOR_REVIEW; cross-process locking is the next bounded task.

### BTCS-L2-SECURITY-006

- Initial genesis creation and canonical metadata repair are serialized across processes.
- Every canonical tip mutation (block build/import and recovery adoption) refreshes `chain.json` after acquiring the per-directory OS lock, then validates and commits against the current tip.
- Deposit recovery holds the same lock from canonical snapshot capture through gate persistence, re-derivation, and adoption; no second recovery or writer can race the freeze/adoption boundary.
- Read snapshots and checkpoint export refresh the canonical tip; a long-lived processor refreshes before async reads/writes. The synchronous `tip` getter remains the last refreshed local snapshot.
- Lock timeout, malformed owner metadata, and a detected stale owner fail closed with actionable diagnostics; automatic stale-lock removal is avoided.
- Tests spawn separate Node processes against one directory, force a stale-tip race and retry, verify both blocks remain canonical, and verify stale/malformed locks leave canonical metadata unchanged.
- Documentation specifies the lock path, wait behavior, one-filesystem requirement, stale-lock recovery, and the remaining limits.
- `npm run typecheck` and `npm test` pass.

## Working rules

1. Assign one bounded task at a time.
2. Every task must have an ID and a saved deliverable.
3. Record findings in repository files, not only in agent conversations.
4. Distinguish IMPLEMENTED, PARTIAL, PLANNED, and MISSING.
5. Keep protocol and source-code changes out of documentation tasks.
6. Mark tasks READY_FOR_REVIEW when deliverables are saved.
7. Mark tasks COMPLETE only after human review.
8. Do not commit or push without explicit approval.

## Status definitions

- READY_FOR_AGENT: Defined and waiting for an agent to work on it.
- IN_PROGRESS: An agent has started the task.
- READY_FOR_REVIEW: Deliverables are saved and await review.
- BLOCKED: Work cannot continue without resolving a dependency.
- COMPLETE: Reviewed and accepted.

## BSNA Standard (Proposed - Future)
- [ ] BSNA-001: BSNA Technical Specification v1.0 (PROPOSED)
- [ ] BSNA-002: ERC-20/721 reference implementations with IBSNA interface (PROPOSED)
- [ ] BSNA-003: Conformance tests and fixtures (PROPOSED)
- [ ] BSNA-004: Explorer/wallet recognition (PROPOSED)
- [ ] BSNA-005: BTCS Core integration (PROPOSED - no consensus changes)
- [ ] BSNA-006: Versioning/governance/conformance policy (PROPOSED)

## BSNA-20 / BSNA-721 Profiles (Proposed)
- [ ] BSNA-20-001: BSNA-20 specification finalization (PROPOSED)
- [ ] BSNA-20-002: BSNA-20 reference contract with IBSNA interface (PROPOSED)
- [ ] BSNA-20-003: BSNA-20 conformance tests (PROPOSED)
- [ ] BSNA-721-001: BSNA-721 specification finalization (PROPOSED)
- [ ] BSNA-721-002: BSNA-721 reference contract with IBSNA interface (PROPOSED)
- [ ] BSNA-721-003: BSNA-721 conformance tests (PROPOSED)
- [ ] BSNA-INT-001: Silver Forge integration for both profiles (PROPOSED)

## SilverForge Studio GUI — 2026-10-22

| Task ID | Task | Status | Deliverable | Next action |
|---|---|---|---|---|
| BTCS-L2-GUI-001 | Image upload component with validation | COMPLETE | studio/src/components/ImageUpload.jsx | Handles PNG/JPEG/GIF/WebP, size/dimension limits, preview, remove, error states. Integrated with asset service API. |
| BTCS-L2-GUI-002 | TokenStudio rewrite with real deployment | READY_FOR_REVIEW | studio/src/pages/TokenStudio.jsx | ERC-20/BSNA-FTS1 form with standard selection, atomic supply, supply/burn/pause policy, metadata mutable flag, and logo upload. Deploys through the asset engine, loads the registry on mount, and shows a real receipt. Logo is mandatory in the UI and enforced by the HTTP route and engine service; a no-logo deploy is rejected. NFT deployment remains disabled pending GUI-014; the Mint tab uses the BSNA-FTS1 authorized-mint asset-engine route. |
| BTCS-L2-GUI-003 | Dashboard with live RPC status | COMPLETE | studio/src/pages/Dashboard.jsx | Fetches eth_blockNumber, eth_chainId, eth_gasPrice, net_version, net_listening, net_peerCount. Mine block button calls btcs_dev_mine. Auto-refresh. Copy RPC/Chain ID buttons. |
| BTCS-L2-GUI-004 | Nodes page with dual-node status | COMPLETE | studio/src/pages/Nodes.jsx | Checks L1 (bitcoinsilverd on 18443) and L2 (EVM on 8545) independently. Shows block height, chain, client version. MetaMask config helper. Launcher command reference. |
| BTCS-L2-GUI-005 | Transactions page with real data | COMPLETE | studio/src/pages/Transactions.jsx | Fetches last 10 blocks and their transactions via eth_getBlockByNumber. Shows block details, tx list with from/to/value/gas/status. Auto-refresh. |
| BTCS-L2-GUI-006 | API client library for Studio | COMPLETE | studio/src/lib/api.js | uploadAssetLogo, fetchAssetServiceLimits, rpcCall, engine networks/connect/estimate/deploy/list/mint, and registry-logo URL translation. |
| BTCS-L2-GUI-007 | Design system and responsive CSS | COMPLETE | studio/src/styles/index.css | Form layout (form-row, form-col), button variants, image upload styles, token cards, modal animations, validation errors, select styling, mobile breakpoints. |
| BTCS-L2-GUI-008 | Studio production build verification | COMPLETE | studio/dist/ | `npm run build` succeeds. Vite 5.4.21. 187 modules transformed. |
| BTCS-L2-GUI-009 | Connect TokenStudio to asset engine | READY_FOR_REVIEW | studio/src/pages/TokenStudio.jsx, studio/src/lib/api.js, services/asset-service/src/assetEngineService.ts, services/asset-service/src/httpServer.ts | TokenStudio uses the asset engine for network selection, fee estimation, deployment, registry listing, logos, and BSNA-FTS1 mint. Network lookup matches `profile.id`, so `btcs-l2-local` connects. Authenticated/real receipt display. |
| BTCS-L2-GUI-010 | BSNA-FTS1 contract implementation | READY_FOR_REVIEW | contracts/token/BSNAFTS1.sol, execution/evm/src/assetEngine/fts1.ts, services/asset-service/tests/contract/bsnaFts1.test.ts | Name decided as BSNA-FTS1. Contract and section 10 conformance tests pass 13/13 on Node v24.17.0. Implementation is additive beside `EvmFungibleAsset` and `BSNA20`. |
| BTCS-L2-GUI-011 | MetaMask wallet connection | PLANNED | | Add "Connect Wallet" button using ethers.js BrowserProvider. Show account, balance, network. Switch/add BTCS L2 network. |
| BTCS-L2-GUI-012 | Contract verification UI | PLANNED | | Display verification status from asset engine (unsupported/not-submitted). Link to explorer when available. |
| BTCS-L2-GUI-013 | Deployment receipt and confirmation UI | READY_FOR_REVIEW | studio/src/pages/TokenStudio.jsx | Detailed deployment receipt modal with real transaction status, contract address, tx hash, chain ID, network, block number, gas used, effective gas price, logs, fee estimate, contract standard/details, metadata, logo, and full JSON. |
| BTCS-L2-GUI-014 | NFT deploy/mint/transfer lifecycle | OPEN / REQUIRED (was BLOCKED) | studio/src/pages/TokenStudio.jsx, contracts, asset engine/service, wallet, Silver Scan | No ERC-721/BSNA-721 reference bytecode exists in this tree; the old form sent calldata without creation bytecode and remains disabled. The 2026-10-22 ecosystem directive requires completing this lifecycle rather than leaving it disabled. | Implement a real reference contract, metadata/image storage, deploy/mint/ownership/transfer, wallet/explorer indexing, and restart/replay tests. Do not restore placeholder bytecode or mark the UI control as success without contract state. |
| BTCS-L2-GUI-015 | Mint tab asset engine integration | READY_FOR_REVIEW | studio/src/pages/TokenStudio.jsx, services/asset-service/src/assetEngineService.ts, services/asset-service/src/httpServer.ts, execution/evm/src/assetEngine/session.ts | Mint tab lists registry deployments whose supply policy is authorized-mint, posts to `/api/asset-engine/mint`, and displays the real transaction hash and on-chain total supply. The engine sets the deployer as minter when the contract has no minter and the deployer is admin. Fixed-supply and legacy ERC-20 deployments are refused before signing. |
| BTCS-L2-GUI-016 | Integrated end-to-end test workflow | PARTIAL | services/asset-service/tests/httpAssetEngineFts1.test.ts | Automated HTTP test covers connect, ERC-20 deploy, BSNA-FTS1 deploy, registry list, logo serving, authorized mint, and fixed-supply mint refusal. A manual browser flow with service restart is still required. |
| BTCS-L2-GUI-017 | Alpha distribution documentation | READY_FOR_REVIEW | docs/TEAM-TESTING-GUIDE.md, docs/KNOWN-LIMITATIONS.md, docs/SECURITY-AND-TEST-NETWORK-BOUNDARIES.md | Documents installation, workflows, limitations, and security boundaries. Must be rechecked against the final test counts before distribution. |
