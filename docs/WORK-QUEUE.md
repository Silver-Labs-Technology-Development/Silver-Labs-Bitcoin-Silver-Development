# BTCS L2 — Work Queue

Purpose: Track tasks, saved deliverables, reviews, and next steps.

## Current priorities

| Task ID | Task | Status | Deliverable | Next action |
|---|---|---|---|---|
| BTCS-L2-CLIENT-001 | Client integration, use cases, and communication | COMPLETE | docs/CLIENT-INTEGRATION-PLAN-v0.1.md | Reviewed and committed as 4d27324 |
| BTCS-L2-CLIENT-002 | Reproducible local client demonstration | READY_FOR_REVIEW | execution/evm/scripts/demo-client.ts, execution/evm/tests/clientDemo.test.ts, execution/evm/README.md | Verified on Node v24.17.0: `npm run typecheck` passes; `npm test` 178/178; no-arg `npm run demo:client` exits 0 and leaves an existing batch file whose `settlement.batchHash` (`0d86d1db…491179`) matches `npm run verify:batch:execution` (PASSED) |
| BTCS-L2-STAGE4-001 | Reproducible, fail-fast L1 deposit-to-settlement E2E | READY_FOR_REVIEW | execution/evm/scripts/regtest-deposit-settlement-e2e.ts, execution/evm/tests/depositE2EPreflight.test.ts, execution/evm/package.json, execution/evm/README.md | Added `npm run e2e:deposit` (local `tsx`); non-destructive preflight validates CLI executable, existing data dir (never created by runner), cookie readability/syntax, RPC reachability, and `chain=regtest`, printing no cookie contents. On Node v24.17.0: `npm run typecheck` passes; `npm test` 189/189 (was 178; +11 preflight tests). Full E2E not run: no Core daemon was started. Reorg-after-spend recovery remains an unresolved critical gap |
| BTCS-L2-SECURITY-001 | Deposit reorg accounting invariant and reorg classification | READY_FOR_REVIEW | execution/evm/src/depositReorgAccounting.ts, execution/evm/tests/depositReorgAccounting.test.ts, docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md, execution/evm/README.md | Specifies and tests `creditedWei <= securedWei` over real deposit-store records and canonical L2 credits; classifies reorg-before-credit, after-credit-before-spend, after-spend, re-inclusion (same/changed inclusion), duplicate and over-credit. After-credit cases require L2 re-derivation (not implemented); after-spend freezes the bridge per whitepaper §25/§28/§50. On Node v24.17.0: `npm run typecheck` passes; `npm test` 204/204 (+15 tests). Full recovery/auto spend attribution remains PARTIAL |
| BTCS-L2-SECURITY-002 | Canonical L2 re-derivation prototype and enforced recovery gate | READY_FOR_REVIEW | execution/evm/src/depositReorgRecovery.ts, execution/evm/src/depositRecoveryGate.ts, execution/evm/src/blockProcessor.ts, execution/evm/tests/depositReorgRecovery.test.ts, docs/DEPOSIT-REORG-RECOVERY-v0.1.md, execution/evm/README.md | Re-derives canonical L2 after an invalidated credit by replaying the untouched prefix into a fresh store and rebuilding from the earliest affected height with the stale credit removed, using only existing `acceptBlock`/`buildNextBlock` primitives; fails closed with a typed `DepositReorgRecoveryError` when a descendant transaction depended on the removed credit. A persisted, fail-closed gate (`deposit-recovery-gate.json`) is enforced in `PersistentBlockProcessor.buildNextBlock` (incl. the RPC `btcs_dev_mine` → `DevelopmentSequencer` path); SECURITY-003A extends the same gate to the `acceptBlock` import path, the other public tip-advancing entry point. On Node v24.17.0: `npm run typecheck` passes; `npm test` 217/217 (+13 tests). Automatic adoption was added under SECURITY-004; automatic EVM spend attribution remains PARTIAL |
| BTCS-L2-SECURITY-003A | Close deposit recovery gate bypass | READY_FOR_REVIEW | execution/evm/src/blockProcessor.ts, execution/evm/tests/depositReorgRecovery.test.ts, docs/DEPOSIT-REORG-RECOVERY-v0.1.md, execution/evm/README.md | Recovery captures the current canonical view, persists the freeze, and re-derives under the processor operation queue; an in-flight extension is included before the gate and later extensions are refused. Verified on Node v24.17.0: typecheck passes; npm test 221/221. Cross-process coordination remains PARTIAL |
| BTCS-L2-SECURITY-004 | Atomically adopt re-derived canonical store | READY_FOR_REVIEW | execution/evm/src/blockProcessor.ts, execution/evm/src/depositReorgRecovery.ts, execution/evm/tests/depositReorgRecovery.test.ts, docs/DEPOSIT-REORG-RECOVERY-v0.1.md, execution/evm/README.md | `recoverDepositReorg` installs the verified candidate by copying immutable records, atomically committing `chain.json`, then clearing the gate; a failed pre-commit adoption leaves the old tip frozen and candidate retryable. Node v24.17.0: typecheck passes; full suite 222/222 |

## Acceptance criteria

### BTCS-L2-STAGE4-001

- `npm run e2e:deposit` invokes `scripts/regtest-deposit-settlement-e2e.ts` through the installed local `tsx`.
- Before any mining or transaction construction, the runner verifies: the Core CLI exists and is executable; the data directory already exists and is never created or initialized by the runner; the RPC cookie is readable and syntactically valid; Core RPC is reachable with the configured CLI/data-dir/port; and `getblockchaininfo` reports exactly `chain=regtest`.
- RPC cookie contents are never printed; each failed precondition produces a concise, actionable error and a nonzero exit.
- `execution/evm/README.md` documents prerequisites, environment-variable overrides, the run command, expected side effects (101 mined blocks, one regtest deposit transaction and two confirmation blocks, persistent Core wallet/data, temporary L2 scratch cleanup), and safe shutdown of only the test daemon.
- Preflight fail-fast behavior is covered by unit tests that do not require a running Core daemon.
- `npm run typecheck` and `npm test` pass.
- Reorg-after-spend recovery is documented as a critical unresolved issue and is not implemented here.

### BTCS-L2-SECURITY-001

- `calculateDepositAccounting` computes `creditedWei <= securedWei` over confirmed L1 deposit records and canonical L2 deposit credits, and reports `unbacked-credit`, `amount-mismatch`, `duplicate-credit`, and `over-credit` without throwing on expected protocol states.
- `classifyDepositReorg` returns a deterministic plan for reorg-before-credit, after-credit-before-spend, after-spend, re-inclusion (same and changed inclusion), and awaiting-credit cases, mapping to `invalidate-l1-only`, `revert-l2-credit`, `freeze-bridge`, `no-op`, or `credit-l2-once`.
- A reorganized-out deposit whose L2 credit was spent is detected and produces a `freeze-bridge` plan; a reorganized-out credit that cannot be proven spent is treated conservatively.
- `docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md` documents the invariant, the cases, the partial spend signal, and the explicit open decisions; it does not claim trustless or production bridge safety.
- Tests exercise both the pure accounting/classifier and real `BtcsL1DepositStore` + `PersistentBlockProcessor` chains without a BTCS Core node.
- `npm run typecheck` and `npm test` pass; canonical re-derivation is implemented, and automatic adoption is covered by SECURITY-004; automatic EVM spend attribution remains PARTIAL.

### BTCS-L2-SECURITY-002

- `rederiveCanonicalL2AfterDepositInvalidation` replays the canonical prefix into a fresh store via `acceptBlock`, then rebuilds every block from the earliest invalidated credit's height through the tip via `buildNextBlock` with the invalidated deposit operations removed; it uses only existing, verified primitives and verifies that no invalidated credit remains in the re-derived chain.
- Re-derivation fails closed with a typed `DepositReorgRecoveryError` (`rebuild-failed`, `residual-credit`, `output-directory-not-usable`) when recovery cannot be proven; it never fabricates a replacement chain and never mutates the source store.
- `recoverDepositReorg` persists a fail-closed gate (`deposit-recovery-gate.json`) in the source chain store before attempting re-derivation, and leaves it engaged on failure.
- The gate is enforced in `PersistentBlockProcessor.buildNextBlock`, so every canonical-extension path (including the RPC `btcs_dev_mine` → `DevelopmentSequencer` path) is refused while the store is frozen; the freeze persists across process reopen.
- Tests cover: no-op when nothing was credited; removal of an unspent credit (balance/credit effects); preservation of independent post-credit transactions; fail-closed when a descendant spent the credit; continuation blocked on the frozen store; clearing the gate after adoption; re-inclusion crediting exactly once; mixed multi-deposit blocks; deterministic repeated recovery; malformed inputs; existing output directory; and cross-reopen persistence.
- `docs/DEPOSIT-REORG-RECOVERY-v0.1.md` documents the algorithm, the fail-closed cases, the enforcement point, and the remaining gaps (automatic spend attribution and cross-process coordination).
- `npm run typecheck` and `npm test` pass (217/217). Automatic adoption was subsequently implemented and verified under SECURITY-004; automatic spend attribution remains PARTIAL.

### BTCS-L2-SECURITY-003A

- The deposit-recovery gate is enforced in both public canonical tip-advancing entry points, `PersistentBlockProcessor.buildNextBlock` and `PersistentBlockProcessor.acceptBlock`; the private `appendBlockUnlocked` is reachable only through those two gated methods.
- An invalid or unreadable recovery-gate marker fails closed on both extension paths (the operation is refused rather than treated as open).
- Legitimate historical replay, settlement batch verification, and recovery reconstruction still work because they import into separate fresh stores that carry no gate marker; no ordinary bypass of the gate is provided.
- All other canonical mutation paths were audited and cannot extend a frozen store: genesis bootstrap runs only on an empty store, `reconcileTipAfterFailedWrite` runs only inside the append path, and `exportStateCheckpoint` writes to a separate directory.
- Tests cover: `buildNextBlock` rejected on a frozen store; `acceptBlock` rejected on a frozen store with the canonical tip and persisted chain unchanged; the freeze surviving a processor reopen; isolated replay into a separate fresh store succeeding while the source is frozen; and a malformed gate marker failing closed on both paths.
- `docs/DEPOSIT-REORG-RECOVERY-v0.1.md` and `execution/evm/README.md` document the gate as covering both extension entry points (correcting the earlier single-choke-point claim).
- `npm run typecheck` and `npm test` pass (220/220). Store adoption is covered by SECURITY-004; automatic EVM spend attribution remains PARTIAL.

- Recovery captures the current canonical view, persists the gate, and re-derives while holding the same exclusive operation queue used by both tip-advancing paths. An extension already in progress completes before the snapshot; queued extensions run after the freeze and are refused.
- A deterministic concurrency test proves the recovery snapshot includes an in-flight extension that commits before the gate. The lock is in-process and per processor instance; multiple processes sharing one chain directory are not coordinated.

### BTCS-L2-SECURITY-004

- Operator recovery automatically adopts the fully replay-verified re-derived chain in the running processor.
- Canonical block records are copied before `chain.json`; the atomic metadata replacement is the adoption commit point, so a pre-commit failure preserves the old canonical tip.
- The recovery gate is removed only after the metadata commit; a failed adoption remains frozen and can be retried from the candidate output directory.
- In-memory tip state is reconciled if a failure occurs after the metadata rename.
- Tests prove successful adoption and continuation, persistence across reopen, and retry after an injected pre-commit failure.
- On Node v24.17.0, `npm run typecheck` passes, `npm test` passes 222/222, and `git diff --check` is clean.
- Automatic transaction spend attribution and cross-process recovery coordination remain PARTIAL.

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
