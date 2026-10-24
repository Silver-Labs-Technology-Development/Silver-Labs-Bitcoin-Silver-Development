# BTCS L2 security-gap register

Status: draft, 2026-10-21. Purpose: an honest, non-marketing inventory of
security and safety gaps in the local prototype. Severity is relative to a
production mainnet bridge, not to the prototype's current scope. No item here
should be read as resolved unless its status says so.

Status values: OPEN (unaddressed), PARTIAL (partly addressed), MITIGATED
(defense-in-depth added; underlying gap remains), BY-DESIGN (accepted prototype
limitation), OUT-OF-SCOPE (explicitly not attempted).

| ID | Gap | Severity | Status | Evidence / reference |
|---|---|---|---|---|
| SG-01 | L1 inclusion is not canonically proven beyond the verified candidate set. Deposit/anchor confirmation now fetches a Core `gettxoutproof` when available and locally derives the 80-byte header hash, checks proof of work, parses the partial Merkle tree, and matches the requested txid and header root. Malformed, wrong-txid, wrong-block, wrong-root, and previous-header-hash mismatches fail closed. Reports distinguish `trusted-btcs-core-rpc`, `trusted-btcs-core-rpc+local-inclusion-proof`, `local-best-chain-only`, and `local-best-chain+local-inclusion-proof`. A locally selected best chain (checkpoint-anchored, cumulative-work tip from validated candidate headers) is used when the stronger model is reported. The header and active-chain view still come from the configured Core RPC as data input; the RPC is not treated as chain-selection authority. There is no P2P header/peer consensus, no independent chain discovery, and no finality proof. Fallback without local best-chain verification remains trusted-RPC only. A locally verified partial proof is not canonical membership or finality. Single-source candidate withholding remains a documented limitation. | High | PARTIAL / LOCAL BEST-CHAIN SELECTION, CANONICAL OPEN | `execution/evm/src/l1HeaderVerifier.ts` (`BestChainSelector`, `Checkpoint`, `ChainConsensusParams`, `computeChainwork`, `encodeCompact`, `computeNextTarget`, `medianTimePast`), `btcsL1CoreRpc.ts` (`getTxOutProof`), `btcsL1Confirmation.ts`, `btcsL1Deposit.ts`, `tests/fixtures/btcsL1ProofFixture.ts`, `tests/l1BestChainSelection.test.ts`, `tests/btcsL1Confirmation.test.ts`, `tests/btcsL1Deposit.test.ts`; focused 24 new + 60 existing; full EVM 390 tests (389 pass, 1 skip, 0 fail) |
| SG-02 | No trustless withdrawal/exit path. A disabled operator lifecycle exists (`withdrawal.ts`, `withdrawalService.ts`, `l1PayoutAdapter.ts`). `isWithdrawalEnabled()` requires both `BTCS_ENABLE_WITHDRAWALS` and `BTCS_WITHDRAWALS_UNSAFE`. `canProcessPayout()` is hard-coded `false`. The withdrawal id is not keccak256. Deposits can be credited on L2, but users cannot force an exit, and no fraud-proof or challenge window enforces it. The service now requires a trusted L2 balance reader, refuses unfunded/double reservations, serializes mutations, persists atomically/fsynced, fails closed on corrupt state, defaults `payoutsEnabled` to false, obtains payout confirmations from a trusted reader rather than caller input, and rejects persisted active records whose reservation does not equal the requested amount. Any failed store write now makes the service require a restart instead of risking a later write that commits a half-observed mutation. | High | PARTIAL / UNSAFE PATH DISABLED | `execution/evm/src/withdrawal.ts`, `withdrawalService.ts`, `l1PayoutAdapter.ts`; tests in `withdrawal.test.ts` and `withdrawalLifecycle.test.ts` (13/13). Do not expose the service over RPC. |
| SG-03 | No fraud/validity proof architecture. Settlement commitments are optimistic and operator-trusted; dispute resolution is undefined. | High | OPEN / BLOCKED | requires unresolved protocol decision |
| SG-04 | Source-specific attribution among fungible deposit credits is partial. Reorg recovery reasons at address/credit granularity, not per-deposit provenance. | Medium | PARTIAL | `depositReorgAccounting.ts`, `docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md` |
| SG-05 | Reorg recovery is operator-invoked, not automatic. The watcher can durably freeze a configured L2 chain when a confirmed deposit is invalidated and not re-included, or when a reorg is deeper than retained history. It does not re-derive or adopt a replacement chain. | Medium | PARTIAL / BY-DESIGN | `btcsL1DepositWatcher.ts`, `depositRecoveryGate.ts`; watcher tests 9/9 (deep-reorg freeze, permanent-invalidation freeze, and retry after gate-write failure). |
| SG-06 | Coordination is single-host. Cross-process safety uses one OS file lock on a shared filesystem; multi-host concurrency is not coordinated. | Medium | PARTIAL | `chainDirectoryLock.ts`, SECURITY-006 |
| SG-07 | Batch-data scanner error handling. The availability scanner throws on some malformed/duplicated fragment sets instead of returning a typed `incomplete` report. | Medium | MITIGATED | Now throws typed `ProtocolError` for malformed fragments, conflicting batch hashes, duplicates, and multiple fragments; returns `incomplete` for unrelated OP_RETURN / missing valid fragments. Adversarial tests added (2026-10-21). |
| SG-08 | Tip-hash bracketing residual. Re-reading the active tip hash at an unchanged height proves no *already-scanned* block changed only under the assumption the tip commits to its ancestry; a transient reorg-and-revert during a scan is not fully excluded. Documented residual. | Low–Medium | BY-DESIGN / documented | `btcsL1BatchDataAvailability.ts`, L1-004 criteria |
| SG-09 | `clearDepositRecoveryFreeze` has no verification or lock and no in-tree callers. If exposed later it must be guarded like adoption. | Low | MITIGATED / monitored | Only used by controlled recovery/adoption paths that hold the chain directory lock and clear after verified adoption; no unguarded external callers in-tree (2026-10-21). |
| SG-10 | Confirmation count is never lowered. Cosmetic reporting gap; does not affect credit correctness. | Low | OPEN / cosmetic | subagent audit 2026-10-21 |
| SG-11 | Deep L1 reorg handling is a fail-closed stop, not recovery. The watcher leaves records unchanged, durably freezes a configured L2 chain, and reports an actionable error; deeper-than-retained-history reorgs are not recoverable automatically. | Medium | BY-DESIGN | `btcsL1DepositWatcher.test.ts` (deep-reorg freeze test) |
| SG-13 | Cross-batch settlement continuity. Every `BtcsL1PublicationStore` now requires one `SettlementContinuityStore` at create/open and persists a durable continuity-binding sidecar; reopening with a different continuity store or without a binding fails closed. Direct `observe`/`reobserve` are the only confirmation transitions and require the exact batch value; gaps, forks, altered batches, competing genesis histories, and mismatched batch values are rejected without persisting an observed/confirmed record. Confirmation commits continuity before writing `confirmed`. Residual: there is no production orchestrator; a failed publication write after the continuity commit can leave the cursor one batch ahead until retry; filesystem tampering and rebuilding both stores out of band are outside the in-process guard; L1 inclusion still trusts Core RPC for the header and active-chain view; local partial proof verification is integrated when `gettxoutproof` is available (SG-01). | High | MITIGATED / NOT PRODUCTION-CLOSED | `execution/evm/src/btcsL1PublicationStore.ts`, `execution/evm/src/btcsL1PublicationWorkflow.ts`, `execution/evm/tests/btcsL1PublicationStore.test.ts`, `execution/evm/tests/btcsL1PublicationStoreWorkflow.test.ts`, `execution/evm/tests/settlementContinuity.test.ts`; focused 27/27; full EVM 366 tests: 365 pass, 1 skipped live BNB, 0 fail (2026-10-22). |
| SG-12 | Production escrow and the BTC↔BTCS asset model are undefined. Real-value custody, escrow keys, and peg mechanics are not implemented. | High | OUT-OF-SCOPE | whitepaper v1.2 open items |

## Closed during the 2026-10-21 run (for traceability)

- Adoption bypass: a re-derived store could previously be adopted while a frozen
  credit remained. `adoptReDerivedStoreUnlocked` now scans canonical heights and
  refuses adoption if any frozen deposit is still credited. Regression test added.
- Deterministic ordering: `localeCompare` replaced with code-unit comparison in
  `btcsL1PublicationStore.ts` and `btcsL1DepositStore.ts` so store ordering is
  locale-independent/canonical.
- Harness reliability (not a protocol gap): post-mining wallet RPC timeout raised
  in `regtest-batch-data-e2e.ts`.

## Addendum 2026-10-22

SG-02's original "no `withdraw*` implementation" line was stale after commit
`88dbce7`. The lifecycle code is real and tested, and it is still not an exit.
Payout broadcast remains hard-disabled. This addendum does not approve enabling
it. Fraud proofs, forced inclusion, and operator-independent recovery stay open
(SG-01, SG-03).

## Addendum 2026-10-22 — trust-critical hardening

- **Settlement continuity:** `SettlementContinuityStore` now enforces exact
  height/previous-commitment/parent-hash linkage, replays each batch before
  acceptance, persists atomically with file and directory fsync, fails closed on
  corrupt/missing state, and supports non-mutating prepare plus stale-token
  rejection. `BtcsL1PublicationStore` requires and durably binds one continuity
  store; its `observe`/`reobserve` transitions replay the exact batch and commit
  continuity before persisting `confirmed`. A gap, fork, missing checkpoint, or
  mismatched batch value leaves the publication unchanged; a competing
  publication cannot reuse a fresh continuity prefix. The previous statement
  that low-level publication callers could bypass continuity is superseded.
  This is still not proof of L1 finality, and the post-commit publication-write
  residual is recorded in SG-13.
- **Batch-data execution verification:** encoding and reconstruction of
  settlement batch data now independently re-execute the batch and reject a
  structurally valid batch with a bogus state root. Unknown verification modes
  are rejected rather than being treated as genesis verification.
- **L1 proof integration (SG-01, superseding the primitive-only note):**
  `l1HeaderVerifier.ts` derives the header hash locally from the 80-byte
  serialization, enforces the compact PoW target, parses a Core
  `gettxoutproof` partial Merkle tree, and verifies the requested txid against
  the header Merkle root. Anchor confirmation and deposit acceptance now fetch
  the proof, verify it, and fail closed on malformed, truncated, wrong-txid,
  wrong-block, wrong-root, previous-header-hash, and invalid-PoW cases. A real
  regtest fixture from block `18a37616…` passes. Reports explicitly label the
  trusted-RPC-only and trusted-RPC-plus-local-proof models. **Residual:** the
  RPC still supplies the header and active-chain view; no independent
  canonical/most-work chain selection, P2P peer/header consensus, or finality
  proof is implemented. Without `getTxoutproof`, confirmation remains
  trusted-RPC only. SG-01 remains open for production/trustless claims.
- **Withdrawals:** the service now requires trusted balance and payout
  confirmation readers, reserves against actual L2 solvency, serializes all
  mutations, uses atomic/fsynced persistence, validates reloaded state and
  reservation accounting (including that every active record reserves exactly
  its requested amount), fails closed on corruption, and keeps payouts
  disabled unless explicitly constructed for a test/regtest run. Any failed
  write marks persistence uncertain and requires a restart. It remains
  operator-controlled, non-RPC, and not a trustless exit.
- **Deposit accounting:** duplicate secured records no longer inflate backing;
  conflicting duplicates throw. Reorg classification now rejects deposit-ID
  mismatches and treats same-inclusion recipient/amount mismatches as
  revert/freeze rather than a no-op.
- **Recovery gate durability:** gate writes and clears now fsync both the file
  and containing directory.
- **Watcher freeze:** deep reorgs and permanently invalidated confirmed deposits
  write a durable L2 recovery gate when `chainDirectory` is configured.
  Persisted invalidations retry a failed gate write on later polls. Automatic
  re-derivation/adoption remains operator-invoked.

## Notes on evidence quality

- Deterministic unit/integration tests and real-Core regtest E2Es are recorded
  separately in `docs/REGTEST-*-E2E-RESULTS-2026-10-21.md` and
  `docs/WORK-QUEUE.md`. Live regtest runs trust local Core RPC and are not
  independent-recovery or production evidence.
