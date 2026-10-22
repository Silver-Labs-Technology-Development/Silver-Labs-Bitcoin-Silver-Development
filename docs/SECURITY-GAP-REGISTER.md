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
| SG-01 | L1 inclusion is trusted, not proven. Deposit/anchor verification trusts a local Core RPC; there is no SPV or trustless inclusion proof. | High | OPEN / BY-DESIGN | `btcsL1Confirmation`, `depositReorgRecovery` docs; results-doc "Limits" |
| SG-02 | No withdrawal/exit path. Deposits can be credited on L2 but cannot be trustlessly withdrawn to L1; the bridge is effectively one-way and has not modeled exit fraud proofs or challenge windows. | High | OPEN | Whitepaper v1.2 open items; no `withdraw*` implementation |
| SG-03 | No fraud/validity proof architecture. Settlement commitments are optimistic and operator-trusted; dispute resolution is undefined. | High | OPEN / BLOCKED | requires unresolved protocol decision |
| SG-04 | Source-specific attribution among fungible deposit credits is partial. Reorg recovery reasons at address/credit granularity, not per-deposit provenance. | Medium | PARTIAL | `depositReorgAccounting.ts`, `docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md` |
| SG-05 | Reorg recovery is operator-invoked, not an automatic always-on L1 watcher. Invalidated IDs are reported; a human/operator must trigger recovery. | Medium | PARTIAL / BY-DESIGN | `btcsL1DepositWatcher.ts`, results doc |
| SG-06 | Coordination is single-host. Cross-process safety uses one OS file lock on a shared filesystem; multi-host concurrency is not coordinated. | Medium | PARTIAL | `chainDirectoryLock.ts`, SECURITY-006 |
| SG-07 | Batch-data scanner error handling. The availability scanner throws on some malformed/duplicated fragment sets instead of returning a typed `incomplete` report. | Medium | MITIGATED | Now throws typed `ProtocolError` for malformed fragments, conflicting batch hashes, duplicates, and multiple fragments; returns `incomplete` for unrelated OP_RETURN / missing valid fragments. Adversarial tests added (2026-10-21). |
| SG-08 | Tip-hash bracketing residual. Re-reading the active tip hash at an unchanged height proves no *already-scanned* block changed only under the assumption the tip commits to its ancestry; a transient reorg-and-revert during a scan is not fully excluded. Documented residual. | Low–Medium | BY-DESIGN / documented | `btcsL1BatchDataAvailability.ts`, L1-004 criteria |
| SG-09 | `clearDepositRecoveryFreeze` has no verification or lock and no in-tree callers. If exposed later it must be guarded like adoption. | Low | MITIGATED / monitored | Only used by controlled recovery/adoption paths that hold the chain directory lock and clear after verified adoption; no unguarded external callers in-tree (2026-10-21). |
| SG-10 | Confirmation count is never lowered. Cosmetic reporting gap; does not affect credit correctness. | Low | OPEN / cosmetic | subagent audit 2026-10-21 |
| SG-11 | Deep L1 reorg handling is a fail-closed stop, not recovery. The watcher leaves records unchanged and reports an actionable error; deeper-than-retained-history reorgs are not recoverable automatically. | Medium | BY-DESIGN | `btcsL1DepositWatcher.test.ts` (deep-reorg test) |
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

## Notes on evidence quality

- Deterministic unit/integration tests and real-Core regtest E2Es are recorded
  separately in `docs/REGTEST-*-E2E-RESULTS-2026-10-21.md` and
  `docs/WORK-QUEUE.md`. Live regtest runs trust local Core RPC and are not
  independent-recovery or production evidence.
