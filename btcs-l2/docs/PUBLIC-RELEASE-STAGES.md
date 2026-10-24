# BTCS L2 Public-Release Stages 1–5

**Date:** 2026-10-22  
**Status:** Planning and evidence record. No stage below is a production or
trustless-settlement approval. This release track is separate from the
whitepaper's technical Stage 1–5 implementation milestones.

## Purpose

This document makes the release path explicit so that local prototype evidence,
private team testing, public developer testing, production-readiness approval,
and public production release are never treated as the same achievement. A green
test suite or a documentation update does not advance a stage by itself.

## Stage summary

| Stage | Name | Owner / accountable role | Status | Release-blocking impact |
|---|---|---|---|---|
| PR-1 | Local prototype validation | Engineering Lead (implementation); QA/Test Lead (evidence); Security Review (boundary review) | **IN PROGRESS / PARTIAL** | Blocks every later stage until the required local journey is reproducible. |
| PR-2 | Private team developer test | Engineering Lead; QA/Test Lead; Product Owner (scope); Security Review | **PARTIAL — LEGACY TOKEN SCOPE ONLY** | Blocks distribution beyond the invited local team. The integrated wallet/explorer/NFT milestone is not met. |
| PR-3 | Public developer test (testnet) | Product Owner; Engineering Lead; Security Review; Operations; Legal/Compliance | **BLOCKED** | Blocks public testnet access, public developer onboarding, and any public claim of a usable ecosystem. |
| PR-4 | Production-readiness approval | Security Review (lead); Engineering Lead; Operations; Legal/Compliance; Product Owner (accountable) | **BLOCKED** | Blocks production deployment and any real-value pilot. Approval is a decision, not a test result. |
| PR-5 | Public production release | Product Owner (accountable); Operations (release manager); Security Review; Legal/Compliance; Engineering Lead | **NOT AUTHORIZED** | Blocks real-value withdrawal, payment, bridge, and settlement paths. Requires explicit written authorization. |

**Named approvers remain pending.** The role names above identify who must own
each gate. They do not imply that a person has reviewed or approved the stage.

## Independent status definitions

These four statuses must be reported separately:

| Status | Current state | Meaning |
|---|---|---|
| Local prototype | **PARTIAL** | Real local components and tests exist, but the required integrated journey is incomplete and some trust boundaries remain trusted. |
| Public developer test | **NOT STARTED / BLOCKED** | No public developer testnet has been approved or operated. |
| Production-readiness approval | **NOT GRANTED** | No independent audit, security sign-off, operations review, or legal review has approved production. |
| Public production release | **NOT APPROVED / NOT AUTHORIZED** | No real-value release is authorized. Withdrawals/payments/bridge/settlement remain disabled outside explicit local tests. |

## Stage 1 — Local prototype validation

**Purpose:** Prove the local system is reproducible and that each displayed or
reported capability is backed by real local services, not mocks.

**Owner / role:** Engineering Lead (implementation); QA/Test Lead (evidence);
Security Review (trust-boundary review). Named approver: pending.

**Dependencies:** A disposable BTCS Core regtest node, a local BTCS L2 RPC,
the asset service, the Studio build, and isolated test directories. No public
network, real keys, or real funds.

**Acceptance criteria:**

- The documented setup works from a clean local environment.
- Core EVM, asset-service, contract, Studio adapter, and SilverPay service tests
  pass on the pinned Node runtime.
- The token deploy path requires a real logo and produces a real receipt.
- SilverPay Wallet shows separate L1 and L2 identities from real RPC reads and
  clearly marks unavailable, stale, and partial states. It does not claim
  signing, sending, receiving, recovery, history, tokens, NFTs, or payments.
- SG-01 proof handling is honestly labeled: a locally verified partial Merkle
  proof does not establish canonical/most-work chain membership or finality.
- Known limitations and security boundaries match the code.

**Current evidence:**

- EVM focused SG-01/confirmation/deposit/header tests: **60/60 pass**.
- SilverPay service tests: **15/15 pass**; Studio adapter tests: **6/6 pass**.
- Real local L1 read through the service: regtest at height 556, Core wallet
  returned 356 UTXOs with exact satoshi conversion. L2 was not running and the
  service reported it as unavailable rather than filling in a balance.
- Studio production build passes.
- Full EVM suite: **366 tests, 365 pass, 1 skipped live-BNB test, 0 fail,
  187.3s**, typecheck clean. Earlier 361-test figures are historical.
- No browser-driven SilverPay UI test has been recorded. No public network was
  used. No independent review was performed.

**Status:** **IN PROGRESS / PARTIAL.** The local token workflow is evidence for a
legacy slice, not evidence that the integrated ecosystem stage is complete.

## Stage 2 — Private team developer test

**Purpose:** Let a small, invited team test the documented local workflow with
real local services and report defects under a controlled process.

**Owner / role:** Engineering Lead; QA/Test Lead; Product Owner (scope);
Security Review. Named approver: pending.

**Dependencies:** Stage 1 evidence; a distribution artifact built from a
reviewed commit; a team-testing guide and bug-report procedure; no unresolved
critical defect for the documented local scope.

**Acceptance criteria:**

- The package is built from a reviewed commit, not from an undocumented dirty
  worktree.
- The team can reproduce token creation/deploy/receipt and the read-only
  SilverPay L1/L2 view.
- Every failed, unavailable, stale, or unsupported state is visible to the
  tester.
- Testers cannot reach production networks, real keys, or real funds.
- Bug reports are triaged, and release-blocking defects have named owners.
- The integrated journey
  `create/deploy → see in SilverPay Wallet → see in Silver Scan → send A→B →
  receive → verify → restart → verify again`
  is either demonstrated or explicitly excluded from the tested scope.

**Current evidence:** The legacy token-deployment Gate B workflow is evidenced
for local team testing. It does **not** satisfy the integrated ecosystem
milestone: SilverPay Wallet is read-only, Silver Scan is absent, the NFT
lifecycle is absent, and no two-account restart/failure acceptance test exists.
The work is uncommitted on `experimental/deposit-prelude-v1`.

**Status:** **PARTIAL — LEGACY TOKEN SCOPE ONLY.** Do not describe the current
tree as a complete private developer test of the ecosystem.

## Stage 3 — Public developer test (testnet)

**Purpose:** Expose a clearly labeled testnet to external developers without
real value and collect reproducible integration feedback.

**Owner / role:** Product Owner; Engineering Lead; Security Review; Operations;
Legal/Compliance. Named approver: pending.

**Dependencies:** Stage 2 exit; an approved testnet topology and chain identity;
public RPC/API hardening; rate limits, monitoring, backups, incident response;
resolved SG-01/SG-03 claims appropriate to the testnet scope; published
limitations and support process; legal review of public testnet terms.

**Acceptance criteria:**

- A public developer can follow the documentation and connect without a
  privileged local setup.
- Testnet keys and funds have no real value and are clearly labeled.
- The wallet/explorer surfaces show trusted, indexed, and verified data
  distinctly; no testnet feature is represented as production finality.
- Public endpoints have authentication/authorization appropriate to their data,
  rate limiting, abuse controls, and monitoring.
- Critical defects have owners, and a rollback/kill-switch procedure exists.
- The integrated wallet/explorer/NFT journeys pass or the missing journeys are
  explicitly excluded from the public test scope.

**Current evidence:** None. No public testnet has been deployed or approved. The
local RPC and SilverPay service are loopback-only. SG-01 still lacks canonical
most-work selection, P2P consensus, and finality; SG-03 fraud/validity proofs
and SG-02 forced inclusion remain open.

**Status:** **BLOCKED.** This stage cannot begin from test-suite success alone.

## Stage 4 — Production-readiness approval

**Purpose:** Decide whether a production deployment is safe enough to authorize.
This is a risk-acceptance decision, not an engineering claim.

**Owner / role:** Security Review (lead); Engineering Lead; Operations;
Legal/Compliance; Product Owner (accountable). Named approver: pending.

**Dependencies:** Stage 3 exit; independent security audit; SG-01 canonical
inclusion and finality policy; SG-03 fraud/validity proofs; SG-02 forced
inclusion/trustless exit; SG-13 production orchestration and residual closure;
production key management, custody, incident response, monitoring, backups,
disaster recovery, capacity/load testing, supply-chain/reproducible-build
review, and legal/compliance approval.

**Acceptance criteria:**

- All release-blocking security gaps have an approved resolution or an explicit,
  documented risk acceptance with an accountable owner.
- The production custody and withdrawal/payment/bridge/settlement paths have
  passed independent review and adversarial testing.
- Operational runbooks, on-call ownership, rollback, monitoring, and incident
  response are exercised.
- The build is reproducible from a signed/reviewed source state, and dependency
  provenance is reviewed.
- Legal/compliance review is complete for the intended jurisdictions and asset
  flows.
- The Product Owner records a go/no-go decision with conditions and expiry.

**Current evidence:** None. There is no independent audit, no production
orchestrator, no trustless exit, no fraud/validity proof, and no production
operations evidence. SG-01 proof verification still relies on a trusted Core
header source for canonical selection.

**Status:** **BLOCKED.**

## Stage 5 — Public production release

**Purpose:** Make real-value services available to the public.

**Owner / role:** Product Owner (accountable); Operations (release manager);
Security Review; Legal/Compliance; Engineering Lead. Named approver: pending.

**Dependencies:** Stage 4 approval; explicit written authorization for the
specific release scope; production deployment and rollback rehearsal; real-value
safeguards; monitored incident response; user disclosures for custody, fees,
recovery, and supported assets.

**Acceptance criteria:**

- The release scope is named and matches what Stage 4 approved.
- Every real-value path has passed the approved security and operational gates.
- Withdrawals, payments, bridge, and settlement are enabled only through an
  explicit, reviewed configuration change.
- Monitoring, alerts, support, and incident response are live before users can
  deposit value.
- The public release notes state the trust model, known limitations, supported
  networks/assets, and recovery/custody assumptions.

**Current evidence:** None. No production deployment, real-value authorization,
or operational sign-off exists.

**Status:** **NOT AUTHORIZED.** Do not deploy real-value withdrawal, payment,
bridge, or settlement paths, and do not change BTCS L1 consensus while security
gates remain unsatisfied.

## Current blockers by area

| Area | Blocker | Stage impact |
|---|---|---|
| L1 inclusion | SG-01: local partial Merkle proof verification is integrated when `gettxoutproof` is available, but the header/canonical chain is still trusted; no most-work selection, P2P consensus, or finality. | PR-3/PR-4/PR-5 |
| Exit and disputes | SG-02 forced inclusion/trustless exit; SG-03 fraud/validity proofs. | PR-4/PR-5 |
| Settlement continuity | SG-13 production orchestrator and post-commit/write residuals. | PR-4/PR-5 |
| SilverPay Wallet | Read-only L1/L2 slice only; no signing, send/receive, recovery, history, tokens/NFTs, account switching, or payments. | PR-2/PR-3 |
| Silver Scan | No integrated L1/L2 indexer/explorer. | PR-2/PR-3 |
| NFT lifecycle | No ERC-721/BSNA-721 reference contract or integrated deploy/mint/transfer path. | PR-2/PR-3 |
| Integrated acceptance | No two-account restart/failure E2E; no browser-driven wallet test. | PR-2 |
| Audit and operations | No independent audit, production ops, legal review, or real-value authorization. | PR-4/PR-5 |

## Reporting rule

When reporting status, always use the four independent statuses above. Do not
write “approved,” “production-ready,” “trustless,” “SPV-verified,” or “final”
unless the specific stage, scope, and evidence support that exact claim. A
verified partial Merkle proof is not a canonical-chain proof, and a read-only
balance display is not a wallet or a payment.
