# BTCS L2 Alpha — Release Checklist

**Version:** Alpha (commit `148d14f` + uncommitted work)  
**Date:** 2026-10-22  
**Status:** [x] LEGACY GATE A/B TOKEN WORKFLOW / [ ] INTEGRATED ECOSYSTEM MILESTONE / [ ] PRODUCTION READY

> **2026-10-22 ecosystem directive:** the earlier Gate B acceptance covered the
> token-deployment path, not the required end-to-end wallet/explorer/NFT
> ecosystem. The current build does **not** yet satisfy the new milestone. See
> “Integrated Ecosystem Acceptance” below.

## Release status — independent

| Status | Current state | Boundary |
|---|---|---|
| Local prototype | **PARTIAL** | Real local components and focused tests exist; SG-01 canonical selection, SG-02/SG-03, SilverPay signing/send/receive/history, Silver Scan, NFT lifecycle, and integrated restart E2E remain incomplete. |
| Public developer test | **NOT STARTED / BLOCKED** | No public testnet, public RPC hardening, monitoring, or approval. |
| Production-readiness approval | **NOT GRANTED** | No independent audit, security sign-off, operations review, or legal review. |
| Public production release | **NOT APPROVED / NOT AUTHORIZED** | Real-value withdrawal, payment, bridge, and settlement paths remain disabled/unauthorized. |

## Public-release Stage 1–5 tracking

Detailed definitions and evidence: `docs/PUBLIC-RELEASE-STAGES.md`. These stages
are separate from the whitepaper's technical Stage 1–5 implementation milestones.

| Stage | Owner / role | Dependencies | Acceptance focus | Current evidence | Status | Release-blocking impact |
|---|---|---|---|---|---|---|
| PR-1 Local prototype validation | Engineering Lead; QA/Test Lead; Security Review | Disposable Core regtest, local L2 RPC, asset service, Studio | Reproducible local setup; real reads/deploys; honest unavailable/stale/partial states | SG-01 focused 60/60; EVM full suite 366 tests (365 pass, 1 skip); SilverPay service 15/15; Studio adapter 6/6; real L1 read 356 UTXOs; Studio build passes | **IN PROGRESS / PARTIAL** | Blocks every later stage. |
| PR-2 Private team developer test | Engineering Lead; QA/Test Lead; Product Owner (scope); Security Review | PR-1 evidence; reviewed package; team guide; triage | Invited team reproduces documented local scope; no real value; integrated journey demonstrated or excluded | Legacy token Gate B scope only; SilverPay read-only; Silver Scan/NFT/E2E absent | **PARTIAL — LEGACY TOKEN SCOPE ONLY** | Blocks distribution beyond invited local team. |
| PR-3 Public developer test (testnet) | Product Owner; Engineering Lead; Security Review; Operations; Legal/Compliance | PR-2 exit; testnet topology; public hardening; monitoring/backups; legal review | External developers can connect; trusted/indexed/verified labels; abuse controls and rollback | None; loopback-only local services; SG-01/02/03 open | **BLOCKED** | Blocks public testnet and public ecosystem claims. |
| PR-4 Production-readiness approval | Security Review (lead); Engineering Lead; Operations; Legal/Compliance; Product Owner (accountable) | PR-3 exit; independent audit; SG-01/02/03/13 closure; custody/keys; ops/DR; load/adversarial tests; supply chain; legal | Blocking gaps resolved or risk-accepted; production paths reviewed; runbooks exercised; go/no-go recorded | None; no independent audit or production operations evidence | **BLOCKED** | Blocks production deployment and real-value pilots. |
| PR-5 Public production release | Product Owner (accountable); Operations (release manager); Security Review; Legal/Compliance; Engineering Lead | PR-4 approval; explicit written authorization; deployment/rollback rehearsal; live monitoring/support | Named scope matches approval; real-value paths gated; disclosures complete; incident response live | None | **NOT AUTHORIZED** | Blocks real-value withdrawal/payment/bridge/settlement. Do not change L1 consensus. |

Named approvers remain pending. Role ownership does not imply approval.

---

## Gate A — Internal Engineering Test ✅

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| A1 | Repository builds reproducibly | [x] PASS | `npm run build` in studio, `npm install` in all packages |
| A2 | Core automated tests pass | [x] PASS | EVM: 366 tests, 365 pass, 1 skipped (live BNB), 0 fail, 187.3s, typecheck clean; Asset Service: 82/82; contracts: 18/18 incl. BSNA-FTS1 conformance 13/13; Studio build passes; SilverPay service 15/15 and Studio adapter 6/6 |
| A3 | Major GUI workflows inspectable | [x] PASS | TokenStudio ERC-20 create→deploy→verify works end-to-end |
| A4 | Known failures recorded | [x] PASS | `docs/KNOWN-LIMITATIONS.md` (64 tracked limitation rows) |
| A5 | Security boundaries documented | [x] PASS | `docs/SECURITY-AND-TEST-NETWORK-BOUNDARIES.md` |
| A6 | No secrets in repo | [x] PASS | `.gitignore` excludes `.regtest/`, `.asset-store/`, cookies, wallet.dat |

---

## Gate B — Team Developer-Testing Release

| # | Criterion | Status | Evidence / Notes |
|---|-----------|--------|------------------|
| B1 | **Reproducible setup** | [x] PASS | `docs/TEAM-TESTING-GUIDE.md` Sections 2-4 |
| B2 | **Working Studio + asset-service integration** | [x] PASS | ERC-20 deploy via asset engine API |
| B3 | **Working local asset creation and deployment** | [x] PASS | ERC-20 tab: form → fee estimate → deploy → receipt |
| B4 | **Logo upload and persistence supported** | [x] PASS | ImageUpload + asset service + registry validate, persist, digest-address, and display a supplied logo. The 2026-10-22 directive made it mandatory: the Studio form requires a logo, `/api/asset-engine/deploy` rejects a missing `logoBase64`, and the engine service rejects missing bytes. Asset-service 82/82 and Studio build pass. |
| B5 | **Transaction, contract, chain identity verification** | [x] PASS | Receipt modal shows tx hash, contract addr, chain ID, gas, logs |
| B6 | **Relevant automated tests passing** | [x] PASS | All test suites pass (see Gate A) |
| B7 | **No unresolved critical issue for local team testing** | [ ] PARTIAL | Withdrawals disabled and non-RPC, no production writes, boundaries documented. SG-13 now has a store-bound continuity guard with 27 focused and full-suite evidence but records residual production gaps. SG-01 now fetches and locally verifies a partial Merkle proof when `gettxoutproof` is exposed, and confirmation/deposit fail closed on malformed/wrong-txid/wrong-block/header-root mismatches; the header and active-chain view still come from trusted Core RPC, so canonical/most-work selection, peer consensus, and finality remain absent. SG-03 (no fraud/validity proof) still blocks production/trustless claims. SilverPay Wallet is read-only; Silver Scan and the NFT lifecycle are absent. The integrated SilverPay Wallet/explorer/NFT milestone is not met. |
| B8 | **Clear security boundaries and known limitations** | [x] PASS | `docs/KNOWN-LIMITATIONS.md`, `docs/SECURITY-AND-TEST-NETWORK-BOUNDARIES.md` |
| B9 | **Team-testing guide and bug-report procedure** | [x] PASS | `docs/TEAM-TESTING-GUIDE.md`, `docs/BUG-REPORT-TEMPLATE.md` |
| B10 | **Release-candidate audit completed** | [x] PASS | This checklist + `docs/WORK-QUEUE.md` |

---

## Integrated Ecosystem Acceptance — 2026-10-22 (NEW; NOT MET)

Required journey:
`CREATE → DEPLOY → SEE IN SILVERPAY WALLET → SEE IN SILVER SCAN → SEND → RECEIVE → VERIFY → RESTART → VERIFY AGAIN`.
NFT journey:
`DEPLOY NFT CONTRACT → UPLOAD METADATA/IMAGE → MINT → SEE IN SILVERPAY WALLET → SEE IN SILVER SCAN → TRANSFER → VERIFY NEW OWNER`.

**SilverPay product decision (2026-10-22):** SilverPay is the unified
wallet-and-payments product. SilverPay Wallet is Phase 1 and the initial
priority; SilverPay Payments is Phase 2 and remains explicitly planned. The
separate Silver Wallet product is retired, and the existing BTCS Silver Wallet
application is not a required dependency. SilverForge and Silver Scan remain
separate integrated products. See
`docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

| # | Criterion | Status | Current evidence / gap |
|---|---|---|---|
| E1 | One reproducible isolated L1/L2 environment with health/status | [ ] NOT MET | No single startup/shutdown orchestrator or indexing-health view. Nodes page only probes endpoints. |
| E2 | SilverPay Wallet shows real separate L1 and L2 accounts, balances, UTXOs, tokens, NFTs, history | [ ] PARTIAL — READ-ONLY | A real read-only Studio page and loopback service show separate L1 Core wallet/UTXOs and L2 EVM account/network reads with loading/unavailable/stale/partial states. No signing, send/receive, recovery, history, token/NFT balances, account switching, or payments; no browser-driven test recorded. |
| E3 | Token creation with mandatory logo deploys through real signing | [ ] PARTIAL | Mandatory-logo validation is implemented in the Studio, HTTP route, and engine service; ERC-20/BSNA-FTS1 deploy, persistence, and receipts pass asset-service tests. Still missing: SilverPay Wallet and Silver Scan visibility of the deployed token. |
| E4 | Two accounts A/B send/receive with real receipts, errors, no duplicates | [ ] NOT MET | Transfer primitives exist; no two-account integrated SilverPay Wallet/Silver Scan acceptance flow. |
| E5 | NFT contract deploy, metadata/image, mint, display, transfer, restart | [ ] NOT MET | GUI-014 is disabled; no ERC-721/BSNA-721 reference contract. |
| E6 | Silver Scan shows real L1/L2 blocks, txs, receipts, tokens, NFTs, settlement | [ ] NOT MET | No integrated explorer/indexer. |
| E7 | Machine- and human-readable E2E fails on state/UI/indexer disagreement | [ ] NOT MET | Only an HTTP asset-service integration test exists. |
| E8 | Restart, failure, duplicate, indexer recovery, trusted-vs-verified labels | [ ] NOT MET | Not implemented as an end-to-end acceptance test. |
| E9 | SilverPay Payments Phase 2 (requests, QR, checkout, invoices, reconciliation) | [ ] PLANNED / NOT STARTED | Explicitly later. It must not block SilverPay Wallet, and a submitted transaction must not be described as a completed payment. |

The milestone remains open until every required user journey runs against real
services and actual transactions. Passing unit/regression suites does not
satisfy it.

---

## Gate C — Public Testnet Readiness (NOT REQUIRED FOR ALPHA)

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| C1 | External testnet deployment verified | ⏸️ NOT REQUIRED | Alpha is local-only |
| C2 | Independent L1/L2 settlement verification | ⏸️ NOT REQUIRED | Regtest only in alpha |
| C3 | Cryptographic proof architecture | ⏸️ NOT REQUIRED | SG-03 open |
| C4 | Checkpoint/replay completeness | ⏸️ NOT REQUIRED | Partial in alpha |
| C5 | Sequencer fault tolerance | ⏸️ NOT REQUIRED | Dev sequencer only |
| C6 | Independent security review | ⏸️ NOT REQUIRED | Post-alpha |
| C7 | Load/adversarial testing | ⏸️ NOT REQUIRED | Post-alpha |
| C8 | Production-grade storage/backups | ⏸️ NOT REQUIRED | Local-dev only |
| C9 | External contract verification | ⏸️ NOT REQUIRED | No explorer integration |
| C10 | Key management / operational security | ⏸️ NOT REQUIRED | Dev key only |

---

## Gate D — Production Release (NOT REQUIRED FOR ALPHA)

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| D1 | Production bridge/withdrawal security | ⏸️ NOT REQUIRED | Withdrawals disabled |
| D2 | Fraud/validity proof implementation | ⏸️ NOT REQUIRED | SG-03 |
| D3 | Forced inclusion / censorship resistance | ⏸️ NOT REQUIRED | SG-02 |
| D4 | Independent audit completion | ⏸️ NOT REQUIRED | Post-alpha |
| D5 | Legal/compliance review | ⏸️ NOT REQUIRED | Post-alpha |
| D6 | Reproducible builds / supply chain | ⏸️ NOT REQUIRED | Post-alpha |

---

## Feature Matrix — What's in Alpha

| Feature | Status | Notes |
|---------|--------|-------|
| **EVM Execution** | ✅ | Osaka, chain 31337, BTCS gas |
| **RPC Methods** | ✅ | eth_call, eth_estimateGas, eth_getTransactionByHash, net_*, btcs_dev_mine |
| **Asset Engine** | ✅ | Multi-network, fee estimation, registry, signing |
| **ERC-20 / BSNA-FTS1 Deploy** | ✅ | Full workflow: form → estimate → deploy → receipt |
| **Logo Upload** | ✅ | PNG/JPEG/GIF/WebP, validation, preview, mandatory for token deployment, persistence |
| **Asset Service API** | ✅ | Upload, limits, health, objects, asset engine endpoints |
| **Deployment Registry** | ✅ | Persistent, network-scoped, cross-chain isolation |
| **NFT (ERC-721) Deploy** | ❌ NOT IMPLEMENTED / REQUIRED | No reference bytecode; GUI-014 disabled. Required by the ecosystem milestone. |
| **Mint Operations** | ⚠️ FUNGIBLE ONLY | GUI-015 authorized mint through the asset engine for supported fungible assets; NFT mint unavailable |
| **SilverPay Wallet (Phase 1)** | ⚠️ PARTIAL — READ-ONLY | Separate L1/L2 reads and UTXO/account display exist through a loopback service. No signing, send/receive, recovery, history, token/NFT balances, account switching, or payments. Replaces the retired Silver Wallet product. |
| **SilverPay Payments (Phase 2)** | ⏸️ PLANNED / LATER | Payment requests, QR, checkout, invoices, reconciliation, and settlement are not implemented |
| **Silver Scan Explorer** | ❌ NOT IMPLEMENTED | No L1/L2 indexer/explorer |
| **MetaMask Connection** | ❌ PLANNED | Service-side signing only |
| **Contract Verification UI** | ❌ PLANNED | Status shown but no explorer link |
| **L1 Deposit Watching** | ✅ TESTS PASS | Regtest only; not in Studio |
| **Settlement Batch Publication** | ✅ TESTS PASS | Regtest only; not in Studio |
| **Reorg Recovery** | ✅ TESTS PASS | Operator-invoked; durably freezes a configured L2 store on deep/permanent invalidation; not in Studio |

---

## Blocker Summary

| Blocker | Task ID | Impact on Alpha |
|---------|---------|-----------------|
| BSNA-FTS1 name decision | BTCS-L2-V15-C / BTCS-L2-GUI-010 | Resolved: `BSNA-FTS1` is implemented additively; no alpha blocker |
| NFT deploy/mint/transfer | BTCS-L2-GUI-014 / ECO-005 | Blocks the required NFT journey; tab remains disabled |
| SilverPay Wallet + Silver Scan | BTCS-L2-ECO-002 / ECO-006 | Blocks the required see/send/receive/verify journey |
| Integrated restart E2E | BTCS-L2-ECO-007 | Blocks acceptance; no machine-readable proof yet |
| MetaMask wallet | BTCS-L2-GUI-011 | Browser signing not available |
| Contract verification UI | BTCS-L2-GUI-012 | No explorer integration |

**These now block the integrated developer-ecosystem milestone, even though the
legacy ERC-20 deploy path still works. Production and trustless-settlement claims
remain blocked by SG-01, SG-03, and the SG-13 production residuals.**

---

## Test Evidence Summary (2026-10-22)

| Suite | Command | Pass | Fail | Skipped | Duration |
|-------|---------|------|------|---------|----------|
| EVM full suite | `cd execution/evm && npx tsc --noEmit && npm test` | 365 | 0 | 1 (live BNB) | 187.3s |
| SG-01 focused confirmation/deposit/store/header/workflow | `npx tsx --test tests/btcsL1Confirmation.test.ts tests/btcsL1Deposit.test.ts tests/btcsL1DepositStore.test.ts tests/l1HeaderVerification.test.ts tests/btcsL1PublicationWorkflow.test.ts` | 60 | 0 | 0 | 4.4s |
| SilverPay read-only service | `node --test services/silverpay-service/tests/*.test.mjs` | 15 | 0 | 0 | 0.3s |
| SilverPay Studio adapter | `cd studio && node --test src/lib/silverpay.test.js` | 6 | 0 | 0 | 0.1s |
| Real local L1 read | start service with Core cookie, `GET /api/silverpay/l1/wallet` | ✅ | 0 | 0 | — |
| Integrated trusted E2E | `npx tsx scripts/integrated-e2e.ts` | ✅ | 0 | 0 | — |
| Asset Service | `cd services/asset-service && npm test` | 82 | 0 | 0 | 26.4s |
| Contracts (BSNA + FTS1) | `npm run test:contracts` | 18 | 0 | 0 | 243.3s |
| BSNA-FTS1 conformance | included above | 13 | 0 | 0 | — |
| Studio Build | `npm run build` | ✅ | — | — | 2.3s |

The real local L1 read returned regtest height 556 and 356 Core wallet UTXOs with
exact satoshi conversion. The L2 endpoint was not running during that check; the
service reported `L2 RPC is unavailable` rather than fabricating a balance. This
is local regtest evidence, not a public testnet or production result.

**No failing test is recorded in this pass. The only skip is the live BNB test, which
requires external credentials and network access. These results cover local
prototype behavior only; they do not establish production or trustless
settlement safety.**

---

## Distribution Artifacts

| Artifact | Location | Verified |
|----------|----------|----------|
| Studio production build | `studio/dist/` | ✅ |
| Team Testing Guide | `docs/TEAM-TESTING-GUIDE.md` | ✅ |
| Known Limitations | `docs/KNOWN-LIMITATIONS.md` | ✅ |
| Security Boundaries | `docs/SECURITY-AND-TEST-NETWORK-BOUNDARIES.md` | ✅ |
| Bug Report Template | `docs/BUG-REPORT-TEMPLATE.md` | ✅ |
| Work Queue | `docs/WORK-QUEUE.md` | ✅ |
| Source commit | Base `git rev-parse HEAD` → `148d14f`; all reviewed work is currently uncommitted | ⚠️ Commit before packaging |

---

## Sign-Off

| Role | Name | Signature | Date |
|------|------|-----------|------|
| Engineering Lead | [Nemotron] | [Automated] | 2026-10-22 |
| Security Review | [Pending] | | |
| Product Owner | [Joshua] | | |

---

## Distribution Command

```bash
# SAFETY: the reviewed work is uncommitted. Do not archive HEAD yet.
# Commit the reviewed tree first, then create the package from that commit.
cd ~/Silver-Labs/btcs-l2
git status --short
# git add ... && git commit ...
# git archive --format=tar.gz --prefix=btcs-l2-alpha-20261022/ \
#   -o btcs-l2-alpha-20261022.tar.gz HEAD

# Verify
# tar -tzf btcs-l2-alpha-20261022.tar.gz | head -20
```

---

## Final Verdict

### ✅ ALPHA RELEASE APPROVED FOR TEAM TESTING

**Rationale:** The legacy Gate B token-deployment workflow is evidenced for
local, trusted team testing. It does not satisfy the later integrated ecosystem
milestone: a real SilverPay Wallet, Silver Scan, two-account token/NFT transfers, the NFT
lifecycle, and restart/failure acceptance are still missing. Mandatory-logo
enforcement is implemented. Security boundaries are documented and enforced;
withdrawals remain disabled.

This is **not** a production-readiness or trustless-settlement approval. The
prototype remains a trusted single-operator execution layer anchored to BTCS L1:
there is no fraud/validity proof, forced inclusion, SPV inclusion proof, or
trustless exit, and withdrawals/payouts remain disabled outside explicit local
tests.

**Next:** Distribute `TEAM-TESTING-GUIDE.md` + repository access to internal testers. Collect bug reports via `BUG-REPORT-TEMPLATE.md`. Address alpha-blockers in priority order per `WORK-QUEUE.md`.

---

**Checklist completed by:** Nemotron (automated engineering agent)  
**Date:** 2026-10-22  
**Commit:** `148d14f` (plus uncommitted work documented in `git status --short`)