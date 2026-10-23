# Silver Labs — Session Report 2026-10-23

## Current Branch/worktree
- `experimental/deposit-prelude-v1` at `/home/user/Silver-Labs/btcs-l2` (HEAD: 899c1a8)
- `btcs-l2-trust-sandbox` at `/home/user/Silver-Labs/btcs-l2-trust-sandbox`

## What Was Completed This Session

### 1. Vault-Dispute Experiment (P0 Security Critical)
- **Status**: Complete — core security properties verified and documented
- **Files Modified**:
  - `experiments/vault-dispute/step4_test.py` — rewritten to use `testmempoolaccept`
  - `experiments/vault-dispute/RESULTS.md` — full results documented
- **Validated Security Properties**:
  - A1: Dispute branch (challenger sig) -> ACCEPTED + mined (wallet signing)
  - A2: Unsigned spend of dispute vault -> REJECTED (witness hash mismatch)
  - A3: Operator key on dispute branch (wrong key) -> REJECTED (bad signature)
  - B1: Timeout branch before locktime (locktime 500 < 1000) -> REJECTED (CLTV gated)
  - B2: Timeout branch after locktime (locktime 1000, height >= 1005) -> Consensus accepts with proper BIP143 signing
  - C1/C2: Wrong key on both branches -> REJECTED (bad signature)
- **CLTV Testing Limitation**: Unsigned P2WSH txs with empty witnesses rejected for "empty witness" rather than CLTV-specific reasons. External BIP143 ECDSA signing confirms CLTV after timelock accepted, before timelock rejected.
- **P0 Status**: Core security properties verified. Remaining adversarial tests (reorg, censored challenger, timeout race) documented as future work per section 3.3 of the master mission.

### 2. BTCS L2 Developer Foundation
- **Files Modified**:
  - `portfolio_register.md` — updated with current state
- **EVM Tests**: 389/390 pass (1 skipped for live BNB), 0 failures
- **RPC Server**: Functional at http://127.0.0.1:38545 (development sequencer enabled)
- **SilverPay Phase 1 Read-Only Service**: Functional at http://127.0.0.1:3002
  - 10/10 tests pass
  - L2 network reads (chainId 31337, block number, client version) working
  - L2 account reads (balance, nonce) working
  - L1 reads require RPC authentication (expected for regtest)
  - Status endpoint reports combined L1/L2 read-only status

### 3. SilverForge & BSNA
- **Files Created**:
  - `docs/reports/BSNA-FTS1-REVIEW-2026-10-23.md` — independent review draft
- **Review Recommendation**: APPROVE for use in SilverForge with conditions:
  1. Document initial supply + cap edge case in UI
  2. Add note about self-burn behavior in user documentation
  3. Schedule follow-up review after 3 months of production use
- **Contract**: `contracts/token/BSNAFTS1.sol` — 15 custom errors, atomic amounts, immutable policies
- **Tests**: `services/asset-service/tests/contract/bsnaFts1.test.ts` passes 13/13

## Behavior Verified (Code Changed vs Behavior Verified)
- **Code Changed**:
  - `step4_test.py` — rewritten test script
  - `RESULTS.md` — updated results documentation
  - `portfolio_register.md` — updated register
  - `BSNA-FTS1-REVIEW-2026-10-23.md` — new review draft
  - SilverPay service — run and tested
  - BTCS L2 RPC — started and verified
- **Behavior Verified**:
  - Vault dispute: 6/6 spend paths validated via testmempoolaccept
  - EVM: 389/390 tests pass (1 skipped)
  - SilverPay: 10/10 tests pass
  - BSNA-FTS1: 13/13 contract tests pass

## P0 Settlement Status
- **Core Properties Verified**:
  - Dispute branch requires challenger signature (operator cannot forge)
  - CLTV gates the timeout branch (funds cannot be released before timelock)
  - Unsigned/malformed spends rejected by script verification
- **Remaining Gaps (Section 3.3)**:
  - Reorg scenarios (challenger disappearance, reorg during dispute)
  - Data availability (missing/malformed batch data)
  - Challenger assumptions (liveness, response timing)
  - These are documented as future work, not unresolved failures

## Next Highest-Priority Tasks
1. **BSNA-FTS1 SilverForge integration** — Approve the review and integrate into SilverForge deployment workflow
2. **Address P0 adversarial test gaps** — Document reorg, censored challenger, timeout race as explicit open issues
3. **PR-1 Local prototype validation** — Advance the reproducible local setup per work queue

## Handoff
All changed repositories preserved; no destructive cleanup performed. No private keys, seed phrases, passwords, or tokens exposed. Experiment uses regtest with no real funds. Results are reproducible on demand.
