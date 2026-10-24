# BTCS L2 — Trust-Critical Internal Review

**Date:** 2026-10-22  
**Scope:** Local prototype on `experimental/deposit-prelude-v1`, HEAD
`148d14f4247ca3dbb1a4f0e69a4d2075e0666993`, plus uncommitted work.  
**Status:** Internal adversarial review, **not** an independent third-party
audit and **not** a production-readiness approval.

## Post-review update (same day, later session)

This review's original findings remain valid, but two current-state claims below
were superseded after it was written:

- **SG-01 proof integration:** anchor confirmation and deposit acceptance now
  fetch a Core `gettxoutproof`, verify the partial Merkle proof and header PoW
  locally, and fail closed on mismatched/malformed cases. The header and active
  chain still come from trusted Core RPC; canonical/most-work selection, peer
  consensus, and finality remain absent. A verified partial proof is **not**
  canonical membership. Focused confirmation/deposit/store/header/workflow
  tests: **60/60**.
- **SilverPay read-only slice:** a loopback service and Studio page now show
  separate real L1 UTXOs/balance and L2 account/network reads, with explicit
  unavailable/partial states. Service tests **15/15**, Studio adapter **6/6**,
  production build passes. This is not a complete wallet: signing, send/receive,
  recovery, history, token/NFT balances, account switching, payments, and a
  browser-driven test remain missing.
- **Current full suite:** **366 tests, 365 pass, 1 skipped live BNB, 0 fail,
  187.3s**, `tsc --noEmit` clean.
- Independent status: local prototype **PARTIAL**; public developer test
  **NOT STARTED/BLOCKED**; production readiness **NOT GRANTED**; public
  production release **NOT APPROVED/NOT AUTHORIZED**.

## Scope reviewed

- Settlement batch continuity and the L1 publication workflow.
- Batch-data encoding/reconstruction and mandatory execution replay.
- Withdrawal lifecycle, solvency reservations, persistence, and payout
  confirmation.
- Deposit accounting, reorg classification, recovery gate durability, and
  watcher behavior.
- Documentation claims that could be read as production or trustless-settlement
  guarantees.

## Findings fixed in this pass

| Finding | Fix | Evidence |
|---|---|---|
| Settlement continuity existed but publication confirmation could be persisted before continuity rejection, and low-level publication callers could bypass the wrapper. | `BtcsL1PublicationStore` now requires and durably binds one continuity store; `observe`/`reobserve` require the exact batch value and commit continuity before persisting `confirmed`. Reopening with a different continuity store or a missing binding fails closed. | `btcsL1PublicationStore.ts`, `btcsL1PublicationWorkflow.ts`, `settlementContinuity.ts`; 27 focused tests including direct mismatch/gap/competing-genesis/wrong-continuity/missing-binding/failed-write retry; full EVM 366 tests 365 pass / 1 skip / 0 fail. |
| Deposit/anchor confirmation verified only against trusted Core RPC responses, even though a local proof verifier existed. | Confirmation and deposit now request `gettxoutproof`, verify the partial Merkle proof and header PoW locally when available, reject malformed/wrong-txid/wrong-block/wrong-root/wrong-previous-hash cases, and label the trusted-RPC-only versus local-proof model. | `l1HeaderVerifier.ts`, `btcsL1Confirmation.ts`, `btcsL1Deposit.ts`, `tests/fixtures/btcsL1ProofFixture.ts`; focused 60/60. Canonical selection is still absent. |
| Batch-data encode/reconstruct execution verification could silently treat an unknown verification mode as genesis. | The shared verifier now rejects unsupported modes before replay. | `btcsL1BatchData.ts`, focused batch-data test. |
| A failed withdrawal store write before rename left memory ahead of disk while the service remained usable. | Any failed write now marks persistence uncertain; further mutations require a restart. | `withdrawalService.ts`, withdrawal lifecycle tests 13/13. |
| Persisted active withdrawal records were not required to reserve exactly their requested amount. | Reload now rejects active statuses whose reservation differs from the request, in addition to reservation-accounting reconciliation. | `withdrawalService.ts`, active-record mismatch test. |
| A failed watcher freeze write was not retried because the cursor had already advanced and the invalidation was no longer in the current poll's list. | Freeze derivation now uses all persisted `invalidated` deposit records, retrying on later polls; an existing gate is not overwritten. | `btcsL1DepositWatcher.ts`, watcher tests 9/9 including gate-write failure retry. |
| Gate writes/clears and continuity/withdrawal persistence lacked durable directory sync. | Atomic temp-file rename plus file and directory fsync, with fail-closed uncertain-write handling. | `depositRecoveryGate.ts`, `settlementContinuity.ts`, `withdrawalService.ts`. |
| Earlier documentation described logo upload as optional. | The 2026-10-22 ecosystem directive made it mandatory. The Studio form, HTTP deploy route, and engine service now reject a token deployment without a logo; the HTTP integration suite includes a no-logo rejection regression. | `ALPHA-RELEASE-CHECKLIST.md` B4; `studio/src/pages/TokenStudio.jsx`; `httpServer.ts`; `assetEngineService.ts`; asset-service 82/82. |

## Residual risks that block production/trustless claims

1. **Trusted Core RPC boundary (SG-01).** Deposit and publication inclusion now
   use a locally verified partial Merkle proof when the RPC exposes
   `gettxoutproof`, but the header and active-chain view still come from the
   trusted Core RPC. There is no independent most-work selection, peer
   consensus, finality, or canonical SPV proof; fallback remains trusted-RPC
   only.
2. **No fraud or validity proof (SG-03).** The operator can produce an invalid L2
   state root and no challenge process can force a correction.
3. **No forced inclusion or trustless exit (SG-02).** Users cannot bypass the
   operator to exit. Withdrawals remain disabled outside explicit local tests.
4. **Continuity residuals (SG-13).** Publication confirmation now requires a
   durably bound continuity store, and direct store confirmation methods cannot
   bypass replay. There is still no production orchestrator; if the continuity
   commit succeeds and the publication write fails, the cursor can be one batch
   ahead until retry. Out-of-band filesystem rebuilding is outside the in-process
   guard.
5. **Operator recovery.** Deep reorgs and permanently invalidated deposits now
   freeze a configured L2 store, but re-derivation/adoption remains
   operator-invoked.
6. **No independent audit.** This review was performed by the same engineering
   agent that made the changes. It is not evidence of independent security.

## Verification recorded

- EVM full suite: 366 tests, 365 pass, 1 skipped live BNB, 0 fail, 187.3s;
  `npx tsc --noEmit` clean (2026-10-22).
- SilverPay service: 15/15; Studio adapter: 6/6; Studio build passes.
- Real local L1 read: 356 UTXOs with exact satoshi conversion. L2 was not
  running and was reported unavailable; no browser-driven wallet test exists.
- Integrated trusted E2E: batch encode/reconstruct, withdrawal lifecycle,
  restart recovery, and duplicate prevention completed.
- Asset Service: 82/82, including the new no-logo deployment rejection
  (2026-10-22).
- Contracts: 18/18 (5 BSNA + 13 BSNA-FTS1; historical in this pass).
- Studio production build: passes (2026-10-22).

## Ecosystem milestone not met

Mandatory-logo enforcement is implemented. SilverPay is now the unified
wallet-and-payments product: SilverPay Wallet is Phase 1 and SilverPay Payments
is Phase 2, planned later. The required SilverPay Wallet is only a read-only
L1/L2 slice; signing, send/receive, recovery, history, token/NFT display,
Silver Scan, the NFT lifecycle, and the two-account restart/failure acceptance
journey are **not implemented or not integrated**. The token-deployment path
alone is not acceptance. See
`docs/ALPHA-RELEASE-CHECKLIST.md` “Integrated Ecosystem Acceptance” and
`docs/WORK-QUEUE.md` ECO-001 through ECO-009.

## Conclusion

The prototype is best described as a **trusted single-operator execution layer
anchored to BTCS L1**, with fail-closed local checks around deposits,
settlement continuity, and withdrawals, plus optional local partial Merkle-proof
verification. It is not a rollup in the trustless sense, does not have
production bridge safety, and must not be presented as having canonical
inclusion, finality, forced exit, or fraud-proof guarantees.
