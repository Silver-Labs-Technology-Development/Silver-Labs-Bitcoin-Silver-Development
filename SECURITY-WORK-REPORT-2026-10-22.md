# BTCS L2 Security Work Report (2026-10-22)

## Context
Branch: experimental/deposit-prelude-v1  
HEAD: d9ae157  
Worktree: /home/user/Silver-Labs/btcs-l2  
Node: v24.17.0 (PATH configured)

## Verified Results
- `npm run typecheck`: clean
- Full suite: **285/285 passing, 0 failing**
- `git diff --check`: clean
- Prior checkpoint claimed (clean-node recovery 3/3, full suite 264/264) verified; expanded to 285 tests

## What Was Done (Safe, Architecture-Independent)

### P1 - SG-01: L1 Trust Boundaries
**Documented trust model:** `verifyBtcsL1AnchorConfirmation` and `verifyBtcsL1Deposit` explicitly use `verificationModel: 'trusted-btcs-core-rpc'`. They verify:
- Hash/txid/blockhash identity, active chain (`in_active_chain === true`)
- Exactly one matching canonical anchor/deposit intent with correct marker/payload
- Payment/output binding and whole-satoshi amounts
- Block header confirmation counts match tx confirmations
- Sufficient confirmations
- Malformed scripts rejected

**Still trusted (not independently proven):** RPC correctness, chain tip/active chain, block inclusion, header data. No SPV/light-client proof implemented. This is NOT trustless.

**Added adversarial tests** (`tests/btcsL1TrustBoundary.test.ts`, 17 tests): wrong network/chain identity, stale/noncanonical inclusion attempts, missing tx/outputs/vout, conflicting responses (txid/blockhash mismatches), RPC timeouts/malformed/invalid headers, insufficient confirmations, confirmation count disagreements, wrong recipient, duplicate/missing intents, intent with value, non-whole satoshis, RPC errors propagated.

### P2 - SG-04: Deposit and Asset Attribution
**Traced flow:** `btcsL1Deposit.ts` (verify) → `btcsL1DepositWorkflow.ts` (record/reobserve/update) → `btcsL1DepositStore.ts` (persistence/state machine) → `btcsL1DepositWatcher.ts` (discovery/reorg handling) → `depositReorgRecovery.ts`/`blockProcessor.ts` (crediting/adoption).  
**Findings:** Attribution is per deposit output (`depositId = txid:outputIndex`), binds to specific tx/block/output, requires canonical intent+payment to configured script, amount parsed as whole satoshis. Source-specific attribution among fungible credits is still partial (acknowledged in SG-04 PARTIAL). Reorg recovery reasons tracked at address/credit granularity in places, not full per-deposit provenance in all paths.

No guessing of missing rules; gaps remain documented.

### P3 - Recovery and Persistence Adversarial Review
**Extended clean-node recovery tests** (`tests/cleanNodeRecoveryExtended.test.ts`, 4 tests): restart simulation (reconstruct twice from same artifacts), incomplete artifacts cannot become finalized, conflicting fragments rejected, interrupted reconstruction (anchor-only) cannot be finalized.

Existing `cleanNodeRecovery.test.ts` (3 tests) + extended (4) all pass. Incomplete/unverified data cannot be treated as finalized - reconstruction throws on missing/conflicting/tampered fragments.

### P4 - Independent Threat Review (Subagent Analysis)
**Subagent 1 (trust assumptions/bypasses):** Reviewed codebase. Key findings:
- Core trust: all verification via trusted Core RPC (documented). `in_active_chain` checked. No cryptographic proof verification.
- Bypass risks: no obvious backdoors found. `clearDepositRecoveryFreeze` guarded (SG-09 noted). Directory locks used. Fail-closed patterns in reorg handling.
- Watcher is operator-invoked/polling (SG-05). Deep reorgs fail-closed (SG-11).

**Subagent 2 (test coverage/recovery invariants):** Reviewed tests. Coverage good for reorgs, batch data, anchors, deposits. Gaps noted: need more adversarial RPC failure modes (added), restart-during-recovery at store level could be expanded, cross-process coordination limited to single-host locks (SG-06).

**Reconciled:** Added targeted tests for confirmed gaps. Did not mark gaps mitigated solely due to tests passing.

### P5 - Architecture Work Without Approval
**BTCS L1 Script/consensus capabilities (from source):** `btcs-core/src/script/*` shows Taproot (P2TR) supported, standard opcodes present (OP_CHECKSIG, OP_NOP1/4/5 etc.), no obvious OP_CAT/OP_CHECKTEMPLATEVERIFY/OP_CHECKSIGFROMSTACK in interpreter.h/cpp. Script limits: MAX_SCRIPT_ELEMENT_SIZE 520, MAX_OPS_PER_SCRIPT 201. No consensus changes attempted. Analysis documented in `docs/ARCHITECTURE-DECISION-RECORD-2026-10-22.md`.

**Feasibility:** Trustless fraud proofs would require L1 dispute mechanism; validity proofs difficult. Current L1 capabilities unclear for complex covenant/dispute games. Distinction made between verified facts vs hypotheses.

**Withdrawal spec refined:** `docs/WITHDRAWAL-EXIT-PROTOCOL-v0.1.md`, implementation skeleton `src/withdrawal.ts` with validation/ID computation, tests `tests/withdrawal.test.ts`. **All payout execution, proof submission, challenges, bond slashing DISABLED by default.** No fake proof verifier created.

## Files Changed/Added

### Modified (existing changes preserved + context)
- `docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md`
- `docs/WORK-QUEUE.md`
- `execution/evm/README.md`
- `execution/evm/scripts/regtest-batch-data-e2e.ts`
- `execution/evm/src/blockProcessor.ts`
- `execution/evm/src/btcsL1DepositStore.ts`
- `execution/evm/src/btcsL1PublicationStore.ts`
- `execution/evm/tests/depositReorgRecovery.test.ts`

### Added (new)
- `docs/ARCHITECTURE-DECISION-RECORD-2026-10-22.md`
- `docs/DECISION-BRIEF-WITHDRAWALS-EXITS-PROOFS-2026-10-21.md`
- `docs/INTEGRATED-PROTOTYPE-RUNBOOK.md`
- `docs/PRIVATE-TESTNET-RELEASE-READINESS.md`
- `docs/REQUIREMENTS-IMPLEMENTATION-MATRIX-v1.2.md`
- `docs/SECURITY-GAP-REGISTER.md`
- `docs/WITHDRAWAL-EXIT-PROTOCOL-v0.1.md`
- `execution/evm/debug_repro.mjs`
- `execution/evm/src/btcsL1BatchDataAvailability.ts`
- `execution/evm/src/withdrawal.ts`
- `execution/evm/tests/btcsL1BatchDataAvailability.test.ts`
- `execution/evm/tests/btcsL1TrustBoundary.test.ts`
- `execution/evm/tests/cleanNodeRecovery.test.ts`
- `execution/evm/tests/cleanNodeRecoveryExtended.test.ts`
- `execution/evm/tests/withdrawal.test.ts`
- `SECURITY-WORK-REPORT-2026-10-22.md`

## Security Gap Status
- **SG-01 (L1 trust, no SPV):** OPEN/BY-DESIGN - extensively tested adversarially, still trusted RPC
- **SG-02 (no withdrawals):** OPEN - design + disabled skeleton added, no implementation
- **SG-03 (no proofs):** OPEN/BLOCKED - architecture analyzed, awaiting decision
- **SG-04 (attribution):** PARTIAL - traced, gaps documented, no full per-deposit provenance
- **SG-05 (operator-invoked recovery):** PARTIAL/BY-DESIGN
- **SG-06 (single-host):** PARTIAL
- **SG-07:** MITIGATED (previously)
- **SG-09:** MITIGATED/monitored
- **SG-10:** OPEN/cosmetic
- **SG-11:** BY-DESIGN (fail-closed)
- **SG-12:** OUT-OF-SCOPE

No gaps marked MITIGATED solely due to passing tests.

## Remaining Trust Assumptions
1. Local BTCS Core RPC correctness and availability
2. Active chain identification
3. Block/tx inclusion reported by RPC
4. Operator reliability for recovery/watcher
5. Single-host filesystem coordination
6. No trustless inclusion proof mechanism

## Next Dependency-Ordered Tasks
1. **Protocol decision** on exit/proof strategy (owner approval) - blocks SG-02/SG-03 implementation
2. **Strengthen SG-01** - document trust boundaries in code comments, consider SPV research path
3. **Improve SG-04** - enhance attribution tracking if requirements clarify, without guessing
4. **Expand recovery tests** - restart during mid-recovery at store/watcher level
5. **External review prep** - audit package with all limitations documented
