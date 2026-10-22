# BTCS L2 — Work Queue

Purpose: Track tasks, saved deliverables, reviews, and next steps.

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
| BTCS-L2-L1-001 | Reproducible real regtest settlement-anchor publication | READY_FOR_REVIEW | execution/evm/package.json, execution/evm/scripts/regtest-anchor-e2e.ts, execution/evm/README.md, docs/REGTEST-ANCHOR-E2E-RESULTS-2026-10-21.md | Node v24.17.0 npm run e2e:anchor PASS: signed transaction with exactly one expected anchor was mempool-accepted, confirmed at block 305, independently matched the 2-block batch commitment, and the confirmed publication record survived store reopen. Batch body was not published. |
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
