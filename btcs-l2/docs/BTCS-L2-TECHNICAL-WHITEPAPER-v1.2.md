# BTCS L2

## Bitcoin Silver Ecosystem Rollup

### Technical Whitepaper Draft v1.2 — Repository Audit and L1 Integration Update

**Project:** Bitcoin Silver (BTCS)\
**Development:** Silver Labs Technology & Development\
**Status:** Evolving technical specification / prototype engineering record\
**Primary objective:** Extend Bitcoin Silver with a programmable, EVM-compatible Layer 2 while preserving BTCS as the monetary, store-of-value, gas, and settlement base.

## Current Engineering Snapshot — 2026-10-21 (v1.2 update)

Historical audit notes later in §2.6 describe the repository as it stood on
2026-10-11; this snapshot supersedes their current-status and next-task
statements.

**Position:** the local execution, persistence/replay/checkpoint, settlement,
deposit-recovery, and local cross-process locking prototypes are implemented.
Under Node `v24.17.0`, `npm run typecheck` passes and the full EVM suite passes
242/242. Real BTCS Core regtest runs confirmed a 0.1 BTC L1 deposit and L2
settlement, published a settlement commitment, and published/reconstructed a
4,472-byte batch from 128 L1 data fragments. These runs use trusted local Core
RPC; the new batch-data format is capped at 16 KiB and the watcher has not had a
live reorg test. Local chain-directory coordination is implemented for
cooperating processes on one local filesystem; the spend evidence remains
conservative address-level evidence. **This is a verified prototype, not a
production rollup or trustless bridge.**

| Workstream | Current status | Evidence and boundary |
| :--- | :--- | :--- |
| Local EVM execution, canonical blocks, persistence and replay | **Prototype implemented and tested** | Signed type-2 transactions, contracts, receipts/logs, state roots, persistent reopen, replay, tamper rejection and failure-boundary behavior are covered by tests. |
| Checkpoints and continuation replay | **Prototype implemented and tested** | Checkpoints are checked against replay-derived canonical history; continuation replay is tested. This is not yet a trust-authentic checkpoint bootstrap from BTCS-published data. |
| Settlement envelopes and batch verification | **Prototype implemented and tested** | Ordered batches, parent/commitment links, deterministic hashes, independent execution replay and tamper rejection are covered by the local suite. |
| Local RPC and development sequencer | **Prototype implemented and tested** | Loopback-only read RPC and explicit development transaction production are covered. Pending transactions are in memory and are lost on process restart. |
| Client integration demo (`BTCS-L2-CLIENT-002`) | **READY_FOR_REVIEW** | The demo test and batch-verifier integration test pass in the reported suite. The work queue requires human review before marking the task complete. |
| BTCS L1 anchor and batch data | **Commitment and bounded data publication/reconstruction E2Es PASS; scalable availability PARTIAL** | A signed batch commitment was confirmed at height 305. A 4,472-byte canonical batch was published as 128 fragments plus its commitment and reconstructed byte-for-byte from active Core block outputs at height 507. The 16 KiB cap and trusted-Core requirement are prototype limits; see both saved regtest result files. |
| BTCS L1 deposits and L2 credit | **Deposit-prelude prototype implemented; real regtest E2E PASS** | A 0.1 BTC deposit was verified through trusted local Core RPC, stored durably, credited into the L2 state root, and included in an independently replayed v2 settlement batch. See `docs/REGTEST-DEPOSIT-SETTLEMENT-E2E-RESULTS-2026-10-21.md`. |
| BTCS L1 deposit monitoring and reorg handling | **Bounded one-process polling watcher implemented and unit tested** | The watcher persists a recent-chain cursor, records only confirmed deposits, invalidates shallow-reorg inclusions, re-observes replacements, and fails closed beyond retained history. It reports IDs for operator recovery; continuous scheduling, live watcher reorg E2E, and multi-host coordination remain open. |
| Deposit reorganization and recovery | **Fail-closed prototype implemented; source attribution remains partial** | Canonical EVM replay tracks native value outflow, fees, and selfdestructs; local recovery freezes, re-derives, and adopts under a cross-process directory lock. Address-level spend evidence can false-positive among fungible credits. |
| L1 batch data | **16 KiB fragment prototype and live regtest reconstruction PASS** | The codec reconstructs canonical batch bytes from caller-supplied Core block outputs and verifies trusted anchors plus the existing batch hash. It is not an inclusion proof, does not track L1 reorgs, and is not a scalable DA design. See `docs/REGTEST-BATCH-DATA-E2E-RESULTS-2026-10-21.md`. |
| Production rollup security | **Not delivered** | Trust-minimized custody, withdrawals, forced inclusion, complete data availability and clean-node reconstruction from BTCS data, fraud/validity proof enforcement, and production reorg/accounting guarantees remain open. |

### Latest verified evidence

In `execution/evm`, Node `v24.17.0` passes `npm run typecheck` and the full EVM
suite passes **242/242**, including seven deposit-watcher and six batch-data
tests. The real deposit-to-settlement, anchor-publication, and batch-data
publication/reconstruction E2Es pass. Their result files preserve identifiers
and limits.

### Deposit E2E configuration and observed effects

`npm run e2e:deposit` uses the defaults and overrides documented in
`execution/evm/README.md`. It requires an already running dedicated Core
regtest daemon and does not start or stop Core itself. BTCS Core's coinbase
maturity is 200 blocks, so the runner mines 201 funding blocks before creating,
signing, and broadcasting one 0.1 BTC test deposit, then mines two confirmation
blocks. The wallet, cookie, and mined regtest chain persist; temporary L2
scratch data is removed. The successful run started from height 101, included
the deposit at height 303, and stopped only the dedicated test daemon afterward.

The test establishes the local deposit → trusted-Core-RPC verification →
durable record → state-root-committed L2 credit → independently replayed
settlement path. It does not establish an L1 anchor publication workflow,
trustless inclusion, an L1 reorg test, production escrow, or withdrawals.

### What the deposit prototype does — and does not mean

The current model uses a BTCS transaction containing a `BTCSL2D` OP_RETURN intent that identifies the EVM recipient, alongside a payment to the configured deposit destination. A configured BTCS Core RPC is trusted to report transaction and active-chain details. After the required confirmations, a durable deposit record can be converted into a canonical L2 deposit operation; the operation is committed into L2 block state and protected against duplicate credit in the prototype.

This is **not a trustless bridge**. The current implementation does not itself provide a BTCS SPV/light-client proof, an enforceable production vault, or a withdrawal/exit protocol. It detects address-level outflows conservatively and freezes on a potentially spent invalidated credit. The L1 watcher is an operator-scheduled polling component, not a continuously managed service. Source-specific attribution remains incomplete. The fixed test recipient and regtest amount are fixtures, not production defaults to expose to users.

### Current stage map

| Stage | v1.2 position | Next exit requirement |
| :--- | :--- | :--- |
| **1 — EVM execution** | Local prototype broadly tested; pinned-runtime acceptance still outstanding | Run typecheck, full suite, client demo and verifier under Node `24.17.0`; later differential testing and production-engine decision. |
| **2 — Storage, replay and recovery** | Persistence, canonical replay, checkpoint continuation tested | Define trusted bootstrap from L1-published data; broaden crash/corruption/reorg recovery. |
| **3 — Settlement envelopes and batches** | Local validation and independent replay tested; deposit settlement passed on regtest | Maintain adversarial coverage; connect publication to L1 and reconstruct published batch data. |
| **4 — BTCS L1 settlement and deposits** | Deposit-to-settlement, commitment publication, and bounded batch-data publication/reconstruction E2Es PASS; watcher code is implemented | Add reorg-aware fragment/anchor availability tracking, test watcher behavior against regtest, and define scheduled polling/restart behavior. |
| **5 — Rollup security** | Local recovery is fail-closed; production security mechanisms remain unimplemented | Specify and prototype data availability, forced inclusion, disputes/proofs, withdrawals, and enforceable bridge custody/accounting. |
| **6 — Production readiness** | Not reached | Independent security review, adversarial testnet, operational recovery drills, monitoring and governance. |

### Engineering priority — next work, in bounded tasks

**Completed prototype gates:** the client demo, SECURITY-001 through SECURITY-006,
and the real deposit-to-settlement E2E are saved as `READY_FOR_REVIEW` items in
`docs/WORK-QUEUE.md`; none is marked `COMPLETE` pending human review.

**Next bounded integration target:** track anchor and batch-data fragments
through reorgs and test deposit-watcher/reconstruction recovery against regtest.
The deposit watcher, one-shot anchor, and batch-data publication are saved as
`READY_FOR_REVIEW` tasks; the work queue requires human review before marking
them complete. Keep trusted-Core-RPC, local-filesystem, and prototype security
boundaries explicit.

**Later gates:** proof/dispute enforcement, forced inclusion, withdrawals, and
trust-minimized custody require separate protocol designs and adversarial
validation. Production readiness also requires independent audit, adversarial
testnet evidence, and operational recovery drills; this repository cannot
substitute for those external reviews.
---

# 1. Abstract

Bitcoin Silver (BTCS) is intended to remain the monetary foundation of its ecosystem.

BTCS L2 therefore does not replace BTCS with another base asset, move the ecosystem onto Ethereum or another external blockchain, or create a competing monetary network.

The purpose of BTCS L2 is to make **BTCS programmable**.

BTCS L1 remains responsible for Proof-of-Work security, the UTXO monetary layer, base-layer ownership, and final settlement.

BTCS L2 provides programmable execution for:

- smart contracts;
- EVM-compatible applications;
- tokens;
- NFTs;
- DeFi;
- games;
- payments;
- commerce;
- decentralized applications;
- application-specific scaling;
- future L3s where useful.

The architecture reuses mature technology where practical. Syscoin is used as a Bitcoin-derived UTXO/EVM reference. Geth remains a production-candidate execution direction, while the current running local harness uses EthereumJS VM in a TypeScript/Node.js prototype; those are distinct implementation facts. OP Stack supplies modular rollup architecture. Alpen supplies a Bitcoin-rollup reference for data availability and unilateral recovery. BitVM and BitVMX supply research and implementation material for optimistic verification and dispute-based computation.

The central BTCS-specific problem is not EVM execution.

It is:

> **How can L2 state, deposits, withdrawals, disputes, and user ownership be enforced by BTCS rather than by another blockchain or a permanent trusted operator?**

The current production candidate is therefore:

> **A BTCS-native optimistic rollup using deterministic EVM execution, BTCS-published L2 data, canonical UTXO settlement, forced inclusion, bonded state commitments, interactive dispute resolution, and a BitVMX-style verification environment.**

This document intentionally separates:

**Specified** — protocol rule sufficiently defined for implementation.

**Prototype Target** — implementation direction used for private testing.

**Benchmark Required** — cannot be finalized until measured.

**Open Research** — security-critical mechanism requiring cryptographic validation.

A prototype that successfully executes EVM transactions and publishes state roots is **not** considered a secure rollup.

---

# 2. Document Status, Evolution, and Versioning

This white paper is an **evolving engineering record**.

It is not a claim that the final BTCS L2 production protocol has already been completely designed.

The project currently knows how to assemble a number of proven technologies into a coherent prototype architecture. The final production system is intentionally not frozen until the prototype demonstrates which components work, which assumptions survive testing, which mechanisms must be redesigned, and which parts can be removed.

The project therefore treats the architecture as a **prototype system under investigation** rather than pretending that every current component is already a permanent protocol rule.

### 2.1 Versioning principle

Each white paper revision records the state of the project at that point in development.

A later version may:

- retain an earlier mechanism;
- modify an earlier mechanism;
- replace an earlier mechanism;
- reject an earlier mechanism;
- move a mechanism from prototype to specified protocol behavior;
- move a mechanism back to research if testing exposes an unresolved problem.

Earlier versions remain part of the engineering history rather than being silently overwritten.

The objective is to preserve a record of **what we proposed, what we built, what we tested, what failed, what changed, and why**.

### 2.2 Version history

| Version  | Purpose                                                                                                                                                           | Document position                        |
| :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- |
| **v0.1** | Initial BTCS L2 architecture and feasibility direction                                                                                                            | Early architecture / research            |
| **v0.2** | Expanded settlement, bridge, data-availability, proof, and security model                                                                                         | Research blueprint                       |
| **v0.3** | Integrated prototype candidate, status labels, hard gates, recovery, dispute, and threat-model requirements                                                       | Protocol + prototype blueprint           |
| **v0.4** | Explicit prototype/production boundary, first-workspace scope, interface controls, workspace ownership, shared test artifacts, and implementation readiness gates | Prototype engineering record             |
| **v0.5** | Recorded first Silver Labs L2 development-interface implementation in BTCS Core, repository/commit traceability, and build-verification status                    | Prototype engineering record             |
| **v0.6** | Deterministic execution engine, chained batch commitments, execution-derived batch records, and independent verification/tamper testing                           | **Completed prototype milestone**        |
| **v0.7** | Sequencer milestone: deterministic transaction intake, ordering, batch production, automated state handoff, failure rejection, and independent verification | **Completed prototype milestone** |
| **v0.8** | Durable EVM state checkpoints, manifest validation, restoration tests, and checkpoint metadata verification against replay-verified canonical history | **Completed prototype milestone; recovery integration remains next** |
| **v0.9** | Checkpoint-resumed continuation replay, local ancestry/BLOCKHASH seeding, first BTCS L1 anchor and confirmation components, read-only Core RPC and publication lifecycle prototype status | Historical engineering snapshot; L1 publication and production security remain incomplete |
| **v1.0** | Deposit-prelude workflow, durable deposit records, deposit operations committed into L2 state, client-demo status, updated 178-test evidence, and initial Stage 4 integration plan | Historical checkpoint; deposit E2E pending, reorg-after-spend unresolved, not production-ready |
| **v1.1** | Audited the deposit E2E's actual lifecycle and cleanup; confirmed the expected CLI binary exists; tightened the pinned-runtime and read-only Core preflight gates | **Current engineering checkpoint; E2E not run, node availability not confirmed, reorg-after-spend unresolved** |
| **v1.2** | Incorporated the OpenCode read-only repository audit: branch/HEAD, stale documentation findings, missing npm/README E2E wiring, Node 24 installation, and unreachable dedicated RPC | **Current task ordering: harden/document the E2E runner first; execute only after review and dedicated-node preflight** |

### 2.3 v0.6 Completion Record

Version 0.6 is the first completed execution/commitment milestone in the current workspace.

The prototype demonstrated:

- deterministic sequential execution of L2 transfer transactions;
- deterministic state output from identical inputs;
- execution-derived batch records;
- chained batches using the previous state commitment;
- transaction commitments and transaction-root calculation for the prototype fixture;
- transition commitments;
- canonical batch commitments;
- independent Python verification of the batch components;
- deliberate tamper detection against a modified state fixture;
- clean Git checkpoints for the implementation artifacts.

The v0.6 implementation remains a prototype. The current state commitment is a deterministic hash of canonical fixture output, not yet a production generalized state trie/root. The transaction-root implementation is also a prototype construction and must later be generalized and formally specified.

v0.6 acceptance therefore means **the deterministic execution and commitment pipeline works for the defined prototype corpus**, not that production rollup security has been achieved.

### 2.4 v0.7 Active Milestone — Sequencer

Version 0.7 begins the next subsystem: converting the deterministic execution pipeline into an actual L2 block/batch production flow.

The v0.7 target is:

```text
incoming L2 transactions
        ↓
validation
        ↓
deterministic ordering
        ↓
sequencer batch
        ↓
execution
        ↓
state commitment
        ↓
batch commitment
        ↓
verifiable batch artifact
```

The v0.7 milestone is considered complete only when the sequencer can produce batches from transaction input without manually assembling the batch artifacts, and an independent verifier can reproduce the resulting commitments from the published inputs.

Initial v0.7 scope:

1. transaction intake;
2. deterministic ordering rules;
3. sequence/nonce handling appropriate to the prototype;
4. automatic batch construction;
5. integration with the existing execution engine;
6. automatic commitment generation;
7. independent verification;
8. failure/rejection tests;
9. reproducible command-line workflow;
10. documentation of the completed milestone.

Explicitly not required for v0.7:

- EVM execution;
- production networking;
- production sequencer decentralization;
- forced inclusion;
- production data availability;
- bridge custody;
- fault proofs;
- mainnet integration.

Those remain later milestones.

### 2.4.1 v0.7 Implementation Progress Record

The v0.7 sequencer prototype is now executing the intended pipeline end-to-end for the current deterministic transfer corpus. The implementation currently consists of a pending transaction input file, deterministic ordering, automatic batch construction, transaction-file generation, reuse of the v0.6 execution engine, automatic commitment generation, and independent batch-record verification.

The demonstrated flow is:

```text
pending transactions
        ↓
deterministic ordering
        ↓
automatically generated batch
        ↓
automatically generated transaction inputs
        ↓
deterministic execution
        ↓
state output
        ↓
TX root + state commitment + transition commitment + batch commitment
        ↓
independent verification
```

The sequencer has been tested with two chained batches. Batch 1 produced the state:

```text
alice=900
bob=60
carol=40
```

Batch 1 commitments:

```text
PREVSTATE=dfdff9103fbd96a9e62c64ffbe32fcf569cf995c4dd5a1ea867c2c5fad4650fd
TXROOT=f0d1c1cf969a7c09f5775bcee22bce943d19fb33f3a9a5a70765d32e507c34ea
STATE=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e
TRANSITION=a67bf21888327ec1d67afab90c94416d399698edf2ab9a2523816834c56f3189
BATCH=519f3f0d8d799be8c30b1254a79f3083e502acf79c22091d5a0af667b5153934
```

Batch 2 was then executed from the committed Batch 1 state and produced:

```text
alice=885
bob=85
carol=30
```

Batch 2 commitments:

```text
PREVSTATE=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e
TXROOT=a9a8b8db62cd2968ae74efa7ecb6dc70e94e01ffa16e4d46c32b0131f4c38afe
STATE=16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b
TRANSITION=1c5a0ba253ce7a7e7839232123b099a10c385db69bb0bc58e558a6ee9f2430bd
BATCH=c9ebef2e044513ded4e9d25a6a8fc71d8fc2973578d531bcac1bd313fc2254a9
```

Both automatically generated batch records have passed independent verification across all current prototype commitment checks:

```text
PREVSTATE: PASS
TXROOT: PASS
STATE: PASS
TRANSITION: PASS
BATCH: PASS
BATCH RECORD END-TO-END PASS
```

This establishes the v0.7 sequencer's core acceptance property: batches can be produced from transaction input without manually assembling the batch and can be independently reconstructed and verified.

During chained testing, a sequencing orchestration bug was discovered: using the same state file as both execution input and output caused the output file to truncate the input before execution. The executor correctly rejected the resulting empty state. The sequencer was hardened by giving each batch a distinct state-output artifact (`state-result-<batch-number>.txt`) and explicitly rejecting input/output path collisions. A clean Batch 1 → Batch 2 run then consumed Batch 1's generated state directly and produced the expected chained result.

Final v0.7 state artifacts:

```text
Batch 1 state: 87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e
Batch 2 state: 16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b
```

Final automatically generated batch artifacts:

```text
Batch 1 file: 3024fba644eb1479b31312ad07f7a95e1fcebb513de4ab83ac91337a6f8c2f0c
Batch 2 file: edc87c303792b6d5cb240bb2c7127e17f118ccdcef9edbcba6c5e0c2a6ef46fe
```

Batch 2 final commitment record:

```text
PREVSTATE=87eca051ccb42bd31270dda57203e11630e140d9fa574b54c4837a94a6c98b2e
TXROOT=a9a8b8db62cd2968ae74efa7ecb6dc70e94e01ffa16e4d46c32b0131f4c38afe
STATE=16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b
TRANSITION=1c5a0ba253ce7a7e7839232123b099a10c385db69bb0bc58e558a6ee9f2430bd
BATCH=c9ebef2e044513ded4e9d25a6a8fc71d8fc2973578d531bcac1bd313fc2254a9
```

Independent verification of the final Batch 2 record produced:

```text
PREVSTATE: PASS
TXROOT: PASS
STATE: PASS
TRANSITION: PASS
BATCH: PASS
BATCH RECORD END-TO-END PASS
```

Failure testing also passed at the execution boundary. Invalid transactions were rejected for insufficient balance, unknown account, and invalid amount. The valid Batch 2 state remained unchanged after those failed executions and retained hash `16508f6aece3650f7e0fa6b8fae772a8574623f2dbccda26b93ed207f5b6a59b`.

The v0.7 acceptance gates are therefore complete for the defined prototype corpus. Version 0.7 is recorded as a **completed prototype milestone**. This does not promote the sequencer, state commitment construction, transaction-root construction, or execution engine to production security status; those remain prototype mechanisms subject to later formalization, generalization, adversarial testing, and production acceptance gates.

### 2.5 v0.8 Engineering Status — Durable Checkpoints and Canonical Verification

> **Historical snapshot:** the statements in this v0.8 subsection describe the state before checkpoint-based continuation replay was implemented. The v0.9 status update below supersedes its “next active milestone” wording for the local prototype, but does not promote checkpoint startup, L1 settlement, or production recovery to a production security claim.

**Status as of 2026-10-10:** the local EVM prototype has added durable state-checkpoint storage and a verifier that compares checkpoint metadata with a canonical read view reconstructed through the existing replay path.

This revision records two committed implementation milestones:

| Commit | Change | Evidence recorded |
| :--- | :--- | :--- |
| `3093df4` | `feat(evm): add durable state checkpoints` | Checkpoint manifest and database persistence; restored account and contract state tests; malformed-manifest rejection tests. |
| `986a6ab` | `feat(evm): verify checkpoints against canonical history` | Canonical-history metadata verifier and five tests covering matching genesis metadata, profile mismatch, height mismatch, absent canonical block hash, and state-root mismatch. |

The full automated suite reported **82 tests passed, 0 failed**, and TypeScript typechecking passed after the verifier was added. The checkpoint-verification commit was confirmed on branch `master`; the working tree was clean immediately after the commit.

#### What the checkpoint implementation currently does

- Stores checkpoint state in a durable database directory and records metadata in `checkpoint.json`.
- Validates manifest format, profile identifier, decimal block height, 32-byte hexadecimal block hash and state root, and optional trusted-anchor shape.
- Restores the state manager using the manifest's state root and checks that the root can be restored.
- Tests account balance, nonce, contract code, contract storage, and restored state-root behavior.
- Compares checkpoint profile, block height, block hash, and state root against a replay-verified local canonical block record.

#### What this does not yet prove

- A manifest's optional `trustedAnchor` is a reference field; its authenticity is not independently established by this verifier.
- The checkpoint verifier checks consistency against local replay-verified history. It does not independently authenticate the history against BTCS L1.
- This work does not establish BTCS L1 data publication, settlement enforcement, withdrawal safety, dispute/fault-proof security, or L1 finality.
- The current implementation has not yet established that the production node can safely start execution from a checkpoint instead of replaying from genesis.
- A successful restore/root check alone is not proof that the checkpoint's block identity or trusted anchor is authentic.

#### Current engineering position

The prototype now has three relevant local capabilities: deterministic execution/batch prototype work recorded in v0.6–v0.7, durable state checkpoint creation/restoration, and metadata comparison against replay-verified canonical history. The existing replay and canonical execution path remains the reference behavior. It must not be bypassed or weakened merely to make checkpoint startup faster.

#### Next active milestone — Safe checkpoint-based recovery

The next milestone is to design and test checkpoint-assisted recovery while preserving the current genesis-replay path as the reference and fallback. Before implementation is accepted, work should define:

1. how the checkpoint is tied to an exact canonical block and profile;
2. how checkpoint contents and metadata are validated before use;
3. how blocks after the checkpoint are replayed and checked against canonical records;
4. how corruption, stale checkpoints, profile changes, missing data, and reorganization scenarios fail safely;
5. when the node must reject a checkpoint and fall back to full replay;
6. reproducible tests showing checkpoint-assisted recovery produces the same canonical state and execution results as replay from genesis.

Do not claim checkpoint-assisted startup or recovery is complete until those behaviors are implemented and tested. Keep local execution integrity, checkpoint authenticity, and BTCS L1 settlement/finality as separate security claims.

### 2.6 v0.9 Engineering Update — Checkpoint Continuation and Initial BTCS L1 Anchor Components

**Snapshot date:** 2026-10-11. This subsection records discoveries after v0.8. It separates completed local behavior from integration work that has only been designed or unit-tested.

#### 2.6.1 Checkpoint-based continuation replay

The checkpoint-recovery integration milestone is now implemented in the local execution harness. The genesis-starting replay verifier remains available as a reference path; non-genesis batches use a separate checkpoint-continuation entry point.

The continuation path:

1. opens a durable checkpoint and validates its manifest/state root;
2. compares the checkpoint's profile, height, block hash, and state root against a `CanonicalReadView` constructed from replay-verified local history;
3. requires the checkpoint block to be the immediate parent of the first block in the continuation batch;
4. initializes a fresh execution VM with the recovered state manager **without overwriting it with genesis balances or re-running genesis state initialization**;
5. loads the recent verified canonical ancestry needed for EVM `BLOCKHASH` queries (up to the prior 256-height window, including the checkpoint block);
6. validates continuation block headers and parent links, executes each block, and checks the computed state root against the block header;
7. compares the re-executed serialized block and execution summary with its settlement envelope.

The stateful acceptance test deploys the Counter contract in block 1, exports and verifies a checkpoint at height 1, then executes the contract's `increment()` call in block 2 from the recovered checkpoint. A checkpoint that is too far behind the batch start is rejected. The continuation report distinguishes blocks re-executed from canonical ancestry blocks loaded.

Current repository evidence:

```text
commit: 9f32ea7
message: Add checkpoint-based settlement batch replay
branch at recorded check: master
latest recorded test run: 117 passed, 0 failed
TypeScript typecheck: passed
```

This closes the **local prototype** gap described in v0.8. It does not yet establish checkpoint-based production-node startup, checkpoint trust-anchor authenticity, reconstruction from BTCS-published data, L1 finality, or the safety of a public bridge. The checkpoint must still be compared with replay-verified local history; a manifest by itself is not a source of truth.

#### 2.6.2 Current EVM implementation versus production candidate

The current runnable prototype is a TypeScript/Node.js harness using EthereumJS VM with the local profile `btcs-l2-local-v0.11-osaka` and local EVM chain ID `31337`. Its work includes EVM transaction validation, canonical block construction/processing, receipts and logs, state-root verification, durable LevelDB/Merkle state persistence, replay, and checkpoint recovery.

The older architecture sections identify Geth as the production-candidate execution component. That remains a design direction, not a claim that Geth is already the running engine in this local harness. Engine selection, fork-rule parity, state-root equivalence, and proof/verifier compatibility remain explicit decisions and acceptance gates.

#### 2.6.3 Versioned settlement envelope and batch verification

The current prototype includes versioned settlement envelopes and batches. Batch verification checks the ordered block sequence, canonical envelope fields, parent hashes, consecutive heights, previous/terminal commitments, and deterministic batch hash. Independent replay verifies execution-derived state roots and compares re-executed block bytes and key roots against the envelope. Tampered metadata, invalid starting anchors, broken parent links, malformed data, and unsupported fields are covered by tests.

A key boundary remains: an internally consistent commitment chain is not proof that its commitment was published on BTCS, that the data is available from BTCS, or that the L1 claim is final. The expected initial commitment/parent anchors are supplied to the verifier and must come from an independently trusted context.

#### 2.6.4 First BTCS L1 anchor components

The current L1 integration work has produced these prototype components and their automated tests:

- a deterministic 39-byte BTCS L1 anchor payload encoding a batch hash;
- canonical OP_RETURN script encode/decode and rejection of altered, malformed, or unsupported scripts;
- anchor preparation that first requires a batch to pass the local independent execution verifier;
- a confirmation verifier that checks the requested transaction ID, block hash, active-chain flag, exactly one matching canonical anchor script, matching batch hash, block-header identity, and consistent confirmation counts against a required threshold;
- a read-only BTCS Core JSON-RPC adapter restricted to HTTP loopback addresses, with optional HTTP Basic authentication provided separately from the URL, request timeouts, and validation of RPC response IDs/errors/results;
- a publication-record state machine that models `prepared → submitted → observed → confirmed`, with explicit invalidation and re-observation handling for changed/removed inclusion data.

These components are a first implementation layer, **not live L1 settlement**. The confirmation report explicitly uses the `trusted-btcs-core-rpc` verification model. It trusts a configured BTCS Core RPC response; it is not itself a light client, an SPV verifier, a BTCS consensus proof, or a proof that any external anchor is authentic. Tests using fixtures/mocks establish local code behavior, not successful publication on a live BTCS node.

#### 2.6.5 Current Stage 4 integration gaps

The current anchor-preparation function still calls the genesis-starting independent replay verifier. As a result, checkpoint-based replay and anchor preparation are not yet joined for non-genesis batches. A follow-up should expose a checkpoint-backed anchor-preparation route that requires the same verified checkpoint and expected commitment/parent anchors, then make the transition explicit in the publication workflow.

The following work remains outstanding before Stage 4 can be considered end-to-end:

1. connect the preparation artifact to actual BTCS Core transaction construction, transaction signing, and broadcast under controlled regtest conditions;
2. observe the real transaction in the active chain and verify the exact published OP_RETURN payload;
3. connect the read-only RPC adapter, confirmation verifier, and publication state machine into a continuously running workflow;
4. implement and test real active-chain reorganization detection, invalidation, and re-observation rather than relying only on the tested state transition functions;
5. test dropped, replaced, malformed, missing, duplicated, and insufficiently confirmed transactions against a live/regtest Core instance;
6. support checkpoint-verified non-genesis batches in the L1 anchor-preparation path;
7. publish and reconstruct the full batch data required for data availability, not merely the 39-byte anchor commitment.

No public/mainnet transaction publication is established by this status record. The current components also do not change BTCS L1 consensus or supply missing Script covenant/introspection capabilities.

#### 2.6.6 Updated stage map

| Stage | Current v0.9 position | Exit requirement still outstanding |
| :--- | :--- | :--- |
| **1 — EVM execution** | Local prototype runs signed transactions, contracts, receipts and logs. | Broader differential testing and final production engine decision. |
| **2 — Storage, replay and recovery** | Persistent canonical history, replay checks, durable checkpoints and checkpoint continuation tested. | Production checkpoint startup/fallback, corruption/reorg recovery and recovery from L1-published data. |
| **3 — Settlement envelopes and batches** | Versioned envelope/batch validation, chained commitments, independent execution replay and tamper rejection tested. | Complete differential/adversarial coverage and integration with checkpoint-backed anchor preparation. |
| **4 — BTCS L1 settlement** | Anchor payload/script, preparation gate, trusted-RPC confirmation verifier, read-only Core adapter and publication state model prototyped. | Actual transaction signing/broadcast, live/regtest end-to-end publication, active-chain watcher/reorg workflow and full data availability. |
| **5 — Rollup security** | Research/architecture direction exists; production security mechanism not implemented as a complete enforceable rollup. | State-transition proof/verification, forced inclusion, dispute resolution, deposit/withdrawal guarantees and vault/accounting enforcement. |
| **6 — Production readiness** | Not reached. | Independent security audit, adversarial testnet, operational drills, monitoring, recovery and governance procedures. |

**v0.9 focus at the time of that snapshot:** close the Stage 4 integration gap while hardening the Stage 1–3 foundations. The latest engineering checkpoint at the start of this document supersedes the historical next-task ordering; a green unit-test suite still does not establish production readiness.


### 2.6.7 v1.0 Engineering Decision Record — Deposit Integration

This section records the current implementation boundary and next-task decision as of 2026-10-11. It supplements the v0.9 history; it does not retroactively claim that the E2E test has passed.

**Current branch:** `experimental/deposit-prelude-v1`.

**Current task state:** `BTCS-L2-CLIENT-002` is `READY_FOR_REVIEW`, not complete. Its local demo is intended to be runnable without BTCS Core, while the separate deposit-settlement E2E requires the dedicated BTCS Core regtest harness.

**Test evidence:** the full EVM package reported 178 passing tests and TypeScript typechecking passed under Node `v18.19.1`. The project pins Node `>=24.17.0 <25`, so pinned-runtime verification remains outstanding. The latest observed Git status was clean on the active branch.

**Decision:** Stage 4 integration is the immediate engineering focus. First inspect the regtest script's process lifecycle and destructive cleanup behavior; then verify the client demo under the pinned runtime; then run the isolated deposit-settlement E2E and capture reproducible evidence. Do not skip directly to public deployment, token issuance, or a production bridge claim.

**Critical blocker:** if an L1 deposit is reorganized out after its L2 credit has already been spent, the current prototype has no complete recovery/accounting mechanism. This must be treated as a protocol safety blocker, not merely an operational edge case. Before production claims, the project needs a documented invariant and tested handling for each timing of reorg relative to verification, credit, L2 spending, and re-inclusion.

**Explicitly not proven by v1.0:** successful regtest E2E; trustless verification of BTCS L1; trustless custody; safe withdrawals; full data availability/reconstruction; forced inclusion; enforceable fraud/validity proofs; safe reorg-after-spend recovery; production readiness.

### 2.6.8 v1.1 Engineering Decision Record — E2E Harness Audit

This record supplements v1.0 and captures what was learned by reading `execution/evm/scripts/regtest-deposit-settlement-e2e.ts` and `execution/evm/package.json` on the active branch. It does not claim the E2E has run.

**Observed repository state:** branch `experimental/deposit-prelude-v1`; the reported `git status --short --branch` output was only `## experimental/deposit-prelude-v1`, indicating no displayed tracked/untracked changes at that check. The expected CLI file `~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli` exists and is executable.

**E2E invocation and lifecycle:** `package.json` has no named script for this E2E. The script imports and calls the CLI but does not launch or stop Core. It expects the dedicated regtest daemon to be running at datadir `~/.local/share/btcs-l2-deposit-regtest-20261011`, RPC port `29445`, cookie `<datadir>/regtest/.cookie`. It verifies the chain name before doing any test work. It then loads or creates wallet `btcs-l2-deposit-e2e`, mines 101 regtest blocks for spendable funds, broadcasts the 0.1 BTC test deposit, mines two confirmation blocks, verifies the L1 inclusion through trusted local Core RPC, persists/reopens the deposit record, credits the fixed test EVM address, reopens/replays L2 state, and independently replays the settlement batch. The `finally` clause removes only the temporary L2 scratch directory created by `mkdtemp`; there is no Core shutdown and no deletion of the configured Core datadir in the inspected code.

**Current status:** the E2E script and its cleanup behavior have been inspected, but the dedicated node's availability and identity have not yet been confirmed by a read-only RPC preflight. The E2E has not been run. The successful 178-test/typecheck report came from Node `v18.19.1`; this does not meet the documented Node `>=24.17.0 <25` runtime pin. The task `BTCS-L2-CLIENT-002` remains `READY_FOR_REVIEW`.

**Next safe sequence:** (1) locate/select the pinned Node 24 runtime without modifying the repository; (2) run the client-demo acceptance commands under that runtime; (3) run `getblockchaininfo` using the exact dedicated datadir and RPC port, and confirm `chain=regtest`; (4) only then invoke the script with the local `tsx` executable and record the entire output. Do not start the script if the RPC identity is unclear. Mining 101 plus two more blocks is expected on this isolated regtest and must not be redirected at any shared or valuable data directory.

**Security interpretation remains unchanged:** this E2E can demonstrate the local deposit → trusted-RPC confirmation → durable record → L2 credit → deterministic settlement replay path. It cannot establish a trustless inclusion proof, production escrow, withdrawals, complete data availability, proof-enforced settlement, or safe recovery from a reorg after the credited L2 funds have been spent.

### 2.6.9 v1.2 Engineering Decision Record — OpenCode Repository Audit

This record captures the read-only OpenCode audit performed on 2026-10-11. No repository files were changed, no services were started/stopped, and no mining or transactions were performed during the audit.

**Repository state reported by audit:** branch `experimental/deposit-prelude-v1`; HEAD `1ffcdb6`. The existing work queue shows `BTCS-L2-CLIENT-002` as `READY_FOR_REVIEW`, not complete. That status must be changed only after human review, consistent with `docs/WORK-QUEUE.md` rules.

**Execution prerequisites:** `~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli` exists and is executable. Node `v24.17.0` exists at `~/.nvm/versions/node/v24.17.0/bin/node`, but the default `/usr/bin/node` is `v18.19.1`. A read-only request to `127.0.0.1:29445` failed with a connection timeout; the audit concluded the dedicated `bitcoinsilverd` service was not running/reachable. A prior dedicated datadir path exists, but its contents were not examined during the audit. Do not assume it is safe to reuse merely because its name is dedicated.

**E2E integration gap:** `execution/evm/scripts/regtest-deposit-settlement-e2e.ts` is a work-in-progress integration runner. It uses `execFileSync` to call the Core CLI; it does not start or stop Core. The CLI is used for wallet setup, mining, transaction construction/signing/broadcast, and chain inspection. A project `BtcsL1CoreRpcClient` then verifies the L1 inclusion through authenticated loopback RPC. After the L1 confirmation step, the script creates a temporary directory for the deposit store and two EVM chains, asserts the exact L2 credit and durable replay, builds a settlement-v2 batch, and independently re-executes the child block. Its `finally` block removes only its temporary L2 scratch directory. Core wallet/data and mined regtest blocks persist.

**Preflight ordering issue:** the runner checks that Core reports `chain=regtest` before proceeding, but the RPC cookie is read only after it has already mined 101 blocks, broadcast the deposit transaction, and mined two more blocks. Therefore the next code task should validate all non-destructive prerequisites—CLI path/executable, successful RPC connectivity, `chain=regtest`, and cookie availability/readability—before the first mining call or transaction broadcast.

**Missing reproducibility wiring:** `execution/evm/package.json` has no `e2e:deposit` script; `execution/evm/README.md` documents the client demo but not the regtest deposit runner; the runner is not part of the `npm test` suite or CI because it relies on a running external Core daemon. Do not describe the E2E as demonstrated passing. Only the individual unit tests and source behavior are currently evidenced; the full L1-to-L2 integration result is pending.

**Documentation drift identified by audit:**

- `docs/CLIENT-INTEGRATION-PLAN-v0.1.md` has stale repository provenance, lists paths as untracked that have since been committed, cites 176 tests instead of the current reported 178, and describes the deposit E2E as exercised without the required caveat that it has not been run in this environment.
- `docs/SETTLEMENT.md` still describes an initial regtest experiment as the next target and says OP_RETURN anchoring will be investigated, although local anchor payload/script, confirmation-verifier, publication-lifecycle, deposit-store and settlement-batch components now exist in prototype form. Its described file layout also differs from the current `execution/evm/src/` architecture and separate legacy Python path.
- These docs should be reconciled in a dedicated documentation task after the preflight-hardened E2E task, so engineering changes and broad documentation updates do not become mixed in one task.

**Approved ordering principle:**

1. Make the E2E runner a documented, explicitly invokable, preflight-checked command (repository/code task only; no daemon startup or transactions).
2. Review that diff.
3. In a separate approved test execution, use a clearly isolated regtest datadir, verify daemon flags, start only that regtest, run the E2E under Node `24.17.0`, save the PASS evidence, and stop only the daemon started for the test.
4. Reconcile `docs/CLIENT-INTEGRATION-PLAN-v0.1.md` and `docs/SETTLEMENT.md` against actual code/test evidence.
5. Design and test reorg-after-spend accounting before representing the bridge as secure.

**Security boundary:** the E2E is an integration demonstration of trusted local Core RPC verification plus L2 credit and replay. It does not lock the 0.1 BTC test payment in a protocol-enforced vault, does not prove inclusion trustlessly, and does not establish withdrawal safety, complete data availability, proof-enforced settlement, or recovery from a reorg after the credit has been spent.

### 2.7 Prototype does not mean production

Everything built during the current prototype phase is experimental unless this document explicitly marks it as production-specified.

A successful prototype may demonstrate that a mechanism is possible without demonstrating that the same mechanism is secure, economical, censorship resistant, recoverable, or suitable for public custody.

In particular, the following remain outside the production security claim unless and until their later acceptance gates are passed:

- production withdrawal enforcement;
- a trust-minimized production vault;
- full EVM-to-verifier equivalence;
- production fault-proof security;
- finalized bond economics;
- finalized batch economics;
- finalized challenge-window parameters;
- any L1 consensus extension;
- public custody of user funds.

### 2.8 Final-product convergence

The intended process is:

```text
research
   ↓
prototype
   ↓
measure
   ↓
test under failure/adversarial conditions
   ↓
retain / redesign / remove
   ↓
updated white paper
   ↓
production specification
```

The final product is therefore expected to emerge from the evidence collected during implementation rather than being declared complete in advance.

# 3. Design Philosophy

## 2.1 BTCS is the bottom

The economic hierarchy is:

**BTCS L1 → BTCS L2 → applications**

BTCS is not a token bridged into another ecosystem.

The L2 exists to give BTCS additional utility.

## 2.2 BTCS remains the store of value

The L2 does not require a second native monetary asset.

BTCS remains the scarce base asset.

Additional L2 tokens are application assets and do not replace BTCS.

## 2.3 BTCS is the native L2 economic asset

BTCS is used for:

- L2 gas;
- payments;
- settlement;
- protocol bonds;
- application economics.

No second gas coin is required.

## 2.4 Compatibility is mandatory

The L2 should look like a normal EVM chain to developers.

The compatibility target includes:

- EVM bytecode;
- Solidity;
- standard ABI;
- Ethereum JSON-RPC;
- EVM wallets;
- ERC-20;
- ERC-721;
- ERC-1155;
- common EVM development frameworks.

## 2.5 Reuse instead of reinvention

Existing technology should be reused where its license, architecture, and security model fit.

Writing new code is not itself a project objective.

Making BTCS work is.

## 2.6 No unnecessary layers

The minimum complete system is:

**BTCS L1 + BTCS L2.**

L3 remains available but optional.

An L3 is introduced only where it solves a real application or scaling problem better than L2.

## 2.7 Security before claims

The project will not call a subsystem trustless merely because it is decentralized operationally.

A trustless property must be demonstrated by protocol behavior.

---

# 4. Protocol Status Labels

Every major component carries one of four statuses.

### SPECIFIED

The protocol rule is defined sufficiently for independent implementation.

### PROTOTYPE TARGET

A development implementation may use this design while the production security properties are still being tested.

### BENCHMARK REQUIRED

The concept is accepted but its operating parameters cannot be frozen without measurements.

### OPEN RESEARCH

The engineering direction is selected, but security or feasibility is not yet proven.

These labels exist to prevent intended properties from being mistaken for completed engineering.

---

# 5. v0.4 Prototype Scope Boundary

Version 0.4 establishes a deliberately small first implementation milestone.

The first workspace milestone is limited to proving that BTCS can carry a deterministic, recoverable L2 data path.

### 5.1 Frozen first-milestone target

The first implementation milestone consists of:

1. **BTCS regtest environment** — reproducible multi-node BTCS testing.
2. **Deterministic transfer machine** — a minimal canonical L2 state transition before the full EVM proof problem is introduced.
3. **Canonical batch encoding** — versioned byte-level encoding for the first milestone.
4. **BTCS L1 data publication** — publishing and reading the batch data through BTCS.
5. **Clean-node recovery** — reconstructing the same L2 state using BTCS-published data and the pinned configuration.

The milestone acceptance condition is:

> **A clean verifier can reconstruct one deterministic L2 state from BTCS data without relying on the sequencer's private database.**

### 5.2 Explicit exclusions from the first milestone

The following are **not** first-milestone deliverables:

- production withdrawals;
- a production custody vault;
- a complete optimistic fraud-proof system;
- full EVM state-root proof equivalence;
- finalized bond/reward economics;
- a public mainnet bridge;
- an L1 consensus fork solely to accelerate development.

Those mechanisms have dedicated later phases or research workstreams.

### 5.3 Prototype operating rule

Until a subsystem passes its later acceptance gate, it must be treated as:

```text
development-only
experimental
replaceable
non-production
```

Prototype custody must never be represented as trustless production custody.

# 6. Implementation Readiness, Interfaces, and Workspace Ownership

The prototype should not begin as seven independent coding efforts with incompatible assumptions.

Version 0.4 therefore freezes the **interfaces needed by the first milestone**, while leaving unresolved production mechanisms open.

### 6.1 Kickoff status matrix

| Subsystem                  | Workspace                     | Current status       | First acceptance test                             | Blocking dependency                            |
| :------------------------- | :---------------------------- | :------------------- | :------------------------------------------------ | :--------------------------------------------- |
| BTCS L1 / settlement       | L1 and Settlement             | **PROTOTYPE TARGET** | reproducible regtest + block/RPC inspection       | exact BTCS Core behavior                       |
| L2 execution               | Core L2 Execution             | **PROTOTYPE TARGET** | deterministic replay of the same inputs           | pinned execution configuration                 |
| Data / derivation          | Derivation and DA             | **PROTOTYPE TARGET** | encode → publish → reconstruct                    | canonical batch format + BTCS publication test |
| Bridge/accounting          | Bridge and Accounting         | **PROTOTYPE TARGET** | deposit accounting invariant in development vault | canonical IDs + trust-boundary document        |
| Vectors/tests              | Verification and Test Vectors | **PROTOTYPE TARGET** | Go/Python corpus agreement                        | frozen first-milestone serialization           |
| Proof research             | Proof Research                | **OPEN RESEARCH**    | deterministic transfer trace/dispute prototype    | transfer-machine semantics                     |
| RPC / developer experience | Developer Experience          | **PROTOTYPE TARGET** | stable L2 head/finality reporting                 | head semantics + chain ID                      |

### 6.2 Silver Labs L2 Development Interface — Implementation Record

An initial development-only interface has now been connected to the BTCS Core source tree.

The implementation adds the read-only RPC endpoint:

```text
silverlabsl2_getinfo
```

The interface is registered through the existing BTCS RPC registration architecture and included through the Core build system.

Current implementation properties:

- development-only;
- experimental;
- read-only;
- no BTCS consensus changes;
- no network or chain writes;
- targets the BTCS Core 31.1.3 development baseline.

Repository branch:

```text
silver-labs-l2
```

Implementation commit:

```text
e685628d97
```

The implementation has been pushed to the Silver Labs development repository on the `silver-labs-l2` branch.

### Current verification status

**PROTOTYPE IMPLEMENTED — BUILD VERIFICATION PENDING**

The source integration and repository push are complete. The milestone is not yet considered verified because the modified BTCS Core still needs to pass the project build/CI process and the RPC must be executed in a controlled local or regtest environment with the expected output.

This interface is a development connection point, not the rollup itself. It does not by itself provide EVM execution, L2 settlement, data availability, bridge security, fault proofs, or production custody.

### 6.2 Shared interface contracts

The following interfaces must be versioned before multiple workspaces depend on them:

- L2 block header;
- L2 transaction encoding;
- batch and chunk encoding;
- commitment encoding;
- deposit ID;
- forced-inclusion message;
- withdrawal ID;
- protocol configuration/genesis artifact;
- RPC finality/head fields.

Every interface must define:

- byte-level encoding;
- field ordering;
- versioning;
- length limits;
- hashing domain;
- duplicate behavior;
- malformed-input rejection;
- unknown-version behavior.

### 6.3 Shared artifacts

The repository should maintain one shared source of truth for:

**Protocol constants registry** — rollup IDs, versions, limits, confirmation targets, provisional parameters, and feature flags.

**Interface-control document** — cross-workspace schemas and compatibility rules.

**Golden vector corpus** — valid, invalid, boundary, malformed, and adversarial examples.

**BTCS regtest harness** — reproducible multi-node setup, mining, mempool inspection, reorg controls, and transaction inspection.

**Threat-to-test matrix** — every stated threat mapped to an automated test and expected result.

**Prototype trust-boundary document** — explicit statement of what is trusted in development and what is not yet protocol-enforced.

### 6.4 Workspace dependency map

| Workspace                         | Depends on                                                                       |
| :-------------------------------- | :------------------------------------------------------------------------------- |
| **L1 and Settlement**             | exact BTCS Core, RPC, chain behavior, publication constraints                    |
| **Core L2 Execution**             | pinned Geth/EVM configuration and protocol config                                |
| **Derivation and DA**             | batch/chunk/commitment formats and BTCS publication behavior                     |
| **Bridge and Accounting**         | canonical deposit/withdrawal IDs, accounting invariant, prototype trust boundary |
| **Verification and Test Vectors** | deterministic transfer semantics and frozen serialization                        |
| **Proof Research**                | transfer trace, dispute semantics, timeout rules, L1 transaction capabilities    |
| **Developer Experience**          | L2 head/finality semantics, chain ID, transaction/receipt rules                  |

### 6.5 Required kickoff gate

Meaningful first-milestone implementation begins when the project has:

```text
reproducible BTCS regtest
        +
pinned execution stack
        +
versioned genesis/configuration artifact
        +
canonical first-milestone formats
        +
shared golden test vectors
```

This gate is deliberately smaller than the production-security gate.

# 7. BTCS L1

The existing Bitcoin Silver Core is the foundation.

The protected BTCS identity for the project is:

```text
BTCS
PoW
SHA-256
UTXO
300-second target
21.47M maximum supply
210,000-block halving interval
```

These characteristics are not changed merely to make L2 development easier.

The initial rollup design therefore lives above L1.

### Status

**SPECIFIED:** preserve existing BTCS L1 identity.

**OPEN RESEARCH:** whether any future consensus extension is ultimately required for fully enforceable native rollup settlement.

---

# 8. Current BTCS Script Boundary

The actual BTCS source must be treated as the authority for available Script capabilities.

The current BTCS source does not provide the proposed covenant/introspection operations that some Bitcoin research systems rely on.

Therefore the protocol must not silently assume support for operations that BTCS does not implement.

The settlement layer must first operate within the current BTCS capability boundary.

### Consequence

We do not begin by modifying consensus.

We first prove how much of the required protocol can be implemented using:

- existing BTCS transaction validation;
- Script;
- Taproot where supported;
- signatures;
- timelocks;
- UTXO state;
- transaction commitments;
- off-chain computation;
- interactive dispute transactions.

### Status

**SPECIFIED:** do not assume unavailable opcodes.

**PROTOTYPE TARGET:** current BTCS consensus.

**OPEN RESEARCH:** whether a narrowly scoped consensus extension is eventually required.

---

# 9. System Architecture

```text
                         BTCS L1
                 Bitcoin Silver Core
              PoW / SHA-256 / UTXO
                         │
                         │
              settlement + data + bridge
                         │
                         ▼
                ┌─────────────────┐
                │    BTCS L2      │
                │                 │
                │  Rollup Node    │
                │      Go         │
                └───────┬─────────┘
                        │
          ┌─────────────┼─────────────┐
          │             │             │
          ▼             ▼             ▼
      Sequencer       EVM          State DB
                      Geth
          │             │             │
          └─────────────┼─────────────┘
                        │
                 L2 blocks/state
                        │
                 batch + compress
                        │
                        ▼
                 BTCS settlement
                        │
             proof / challenge system
                        │
                        ▼
                      BTCS
```

The L2 is therefore an execution environment anchored to BTCS, not an unrelated sidechain with a BTCS bridge.

**Implementation note for v0.9:** the diagram above is a conceptual target architecture, not a literal diagram of the current working tree. The currently tested local harness uses TypeScript/Node.js and EthereumJS VM; see Section 2.6 for the implementation/runtime distinction.

---

# 10. Economic Role of BTCS

BTCS has four primary roles.

## 7.1 Store of value

BTCS remains the scarce base monetary asset.

## 7.2 Gas

Users pay L2 execution fees in BTCS.

## 7.3 Settlement

L2 commitments and published rollup data settle against BTCS.

## 7.4 Canonical bridge asset

BTCS moving into L2 is represented by a protocol-defined L2 balance backed by BTCS secured on L1.

There is no independent issuer of synthetic BTCS.

The canonical accounting invariant is:

> **Total redeemable L2 BTCS must never exceed valid BTCS secured by the canonical settlement system plus valid protocol accounting.**

This invariant must be checked after:

- deposits;
- withdrawals;
- reorgs;
- challenges;
- finalization;
- upgrades.

---

# 11. EVM Execution

The L2 uses an existing EVM rather than implementing a new virtual machine.

The production-candidate architecture retains the **go-ethereum EVM library** as a candidate execution foundation. However, the current runnable local prototype uses the TypeScript/Node.js harness with EthereumJS VM and the pinned local profile `btcs-l2-local-v0.11-osaka` (local chain ID `31337`). Geth has not been integrated into that harness.

These are separate facts: Geth remains a production-candidate direction; EthereumJS is the engine used by the current tested prototype. The final engine decision requires compatibility, reproducible state-root, and verifier/proof-boundary evidence. Neither choice is a settlement layer. The L2 engine does not replace BTCS L1.

Conceptually:

```text
L2 transaction
      ↓
validation
      ↓
Geth EVM
      ↓
state transition
      ↓
receipt/log generation
      ↓
new state root
```

### Canonical execution configuration

The protocol MUST pin:

- exact Geth source revision;
- EVM revision;
- fork rules;
- precompiles;
- transaction encoding;
- gas rules;
- state database behavior;
- trie/state-root behavior;
- chain ID;
- block-field semantics;
- build configuration where consensus-relevant.

The L2 MUST NOT depend on a moving Geth branch.

### Status

**SPECIFIED:** EVM compatibility target.

**PROTOTYPE TARGET:** Geth-based execution.

**BENCHMARK REQUIRED:** execution and replay limits.

---

# 12. Deterministic State Transition

The canonical L2 function is:

```text
State(n+1) =
    Execute(
        State(n),
        L2Block(n+1)
    )
```

Given the same valid:

- parent state;
- L2 block;
- protocol version;
- execution configuration;

every honest implementation must produce the same:

- transactions;
- receipts;
- logs;
- state root.

The following are explicitly bound by protocol rules:

```text
block number
timestamp
base fee
coinbase
chain ID
block hash semantics
L1 origin
transaction ordering
gas accounting
```

No security-critical field may vary because of an arbitrary sequencer choice.

---

# 13. L2 Block

Minimum conceptual header:

```text
version
parent_hash
block_number
timestamp
L1_origin
transaction_root
receipt_root
state_root
batch_sequence
protocol_version
```

The block format is versioned.

Unknown versions must be rejected.

Malformed encodings must be rejected deterministically.

---

# 14. L2 Head Model

The node maintains three views:

```text
Unsafe Head
    newest sequencer state

Safe Head
    L1-backed, reconstructible state

Finalized Head
    state whose challenge period is complete
```

These states must be visible through the node's RPC/interface so wallets and applications can distinguish execution speed from settlement finality.

---

# 15. Sequencer

The first development implementation uses one sequencer.

The sequencer:

1. receives transactions;
2. validates them;
3. orders them;
4. executes them;
5. creates L2 blocks;
6. updates L2 state;
7. produces state roots;
8. submits blocks to the batcher.

The sequencer is a **performance and ordering component**, not the final source of ownership.

A malicious sequencer is therefore not assumed to be safe.

### Production requirement

The system must eventually support:

- forced inclusion;
- independent derivation;
- sequencer replacement/failover;
- censorship resistance.

---

# 16. Forced Inclusion

A user must have a route around sequencer censorship.

A valid user transaction can be published as an L1 message.

The L2 derivation rules include that message.

Initial target:

**24 BTCS blocks maximum forced-inclusion delay.**

At the target five-minute block interval, this is approximately two hours.

The protocol must define:

- message format;
- valid transaction conditions;
- queue ordering;
- nonce handling;
- fee handling;
- expiry;
- reorg behavior;
- duplicate prevention;
- dependency handling.

A sequencer cannot produce a valid final state that indefinitely omits a valid forced transaction.

### Status

**PROTOTYPE TARGET:** 24-block deadline.

**BENCHMARK REQUIRED:** actual liveness and queue economics.

---

# 17. Data Availability

A state root by itself is not data availability.

A valid rollup requires enough information for an independent node to:

1. find the batch;
2. locate all chunks;
3. authenticate them;
4. verify ordering;
5. decode the exact version;
6. reconstruct L2 transactions;
7. replay the state transition.

A single missing or ambiguous chunk must not create a permanent recovery failure.

### Canonical batch data

```text
BTCS-L2 batch
│
├── version
├── rollup_id
├── L2 start block
├── L2 end block
├── parent commitment
├── new state root
├── data root
├── withdrawal root
├── forced-inclusion root
├── batch hash
└── compressed batch data
```

### Status

**SPECIFIED:** data must be reconstructible.

**BENCHMARK REQUIRED:** actual BTCS capacity, relay behavior, fees, compression, and recovery time.

---

# 18. L1 Data Publication

**Implementation status in v0.9:** the current prototype can encode the batch-hash anchor payload/OP_RETURN script, prepare an anchor after its existing replay-verification gate, and verify a reported inclusion through a trusted BTCS Core RPC. That is not the same as publishing the full batch data. Integrated transaction signing/broadcast, live/regtest end-to-end publication, and full chunk retrieval/reconstruction remain outstanding. The anchor-preparation path is currently genesis-starting and has not yet been wired to checkpoint-backed non-genesis replay.

The target architecture publishes batch data in BTCS transactions. Batch data may be chunked:

```text
Batch
 ├── chunk 0
 ├── chunk 1
 ├── chunk 2
 └── ...
```

Every chunk is authenticated against the batch.

The publication system must reject:

- duplicate chunk indices;
- missing chunks;
- invalid hashes;
- invalid versions;
- out-of-range chunk counts;
- decompression/resource abuse;
- malformed serialized values.

The canonical batch cannot progress to finality until all required chunks are confirmed and locatable.

### Policy independence

The design must be tested against actual BTCS:

- standardness;
- mempool policy;
- relay policy;
- block inclusion behavior;
- transaction limits;
- witness/script constraints;
- fee spikes.

A transaction being consensus-valid is not enough if the rollup depends on miners accepting its data format.

---

# 19. Commitment Format

Canonical commitment:

```text
BTCSL2
version
rollup_id
l2_start
l2_end
parent_state_root
new_state_root
data_root
withdrawal_root
forced_inclusion_root
batch_hash
protocol_version
```

The commitment is self-identifying and versioned.

Parser disagreement is treated as a protocol failure.

Critical serialization must have:

- canonical encodings;
- independent test vectors;
- malformed-input vectors;
- length limits;
- duplicate handling rules;
- version rejection rules.

---

# 20. Commitment Chain

Every commitment refers to its parent.

```text
Root 0
  ↓
Batch 1
  ↓
Root 1
  ↓
Batch 2
  ↓
Root 2
```

A proposer cannot jump from an unrelated root into the canonical chain.

The derivation logic checks:

```text
parent root
+
batch data
+
canonical execution
=
new root
```

---

# 21. Independent Derivation

This is a primary security milestone.

Two verifier nodes must independently derive the same chain.

However, two copies of the same implementation are not sufficient evidence by themselves.

The project therefore uses:

```text
Go canonical implementation
Python reference implementation
Proof/verifier implementation
```

for critical encodings and state-transition test vectors.

The goal is to avoid correlated bugs.

### Acceptance requirement

For every shared test corpus:

- all valid inputs must produce the same result;
- all invalid inputs must produce the same rejection;
- state roots must match;
- receipts must match;
- decoded commitments must match.

---

# 22. Fresh-Node Recovery Test

This is a hard gate.

Procedure:

```text
1. Run L2.
2. Produce batches.
3. Publish the batches to BTCS.
4. Shut down L2.
5. Delete local L2 state.
6. Start a clean verifier.
7. Give it BTCS chain data + pinned protocol configuration.
8. Reconstruct the L2.
9. Compare final state roots.
```

The verifier must reconstruct the same canonical state.

The test is repeated with:

- shuffled chunks;
- duplicate chunks;
- missing chunks;
- malformed chunks;
- maximum-size chunks;
- adversarial compression;
- reorged batches.

The result must be either:

**one canonical state**

or:

**deterministic rejection.**

There must not be multiple interpretations.

---

# 23. Canonical Bridge Vault

Deposited BTCS is represented by canonical UTXOs on L1.

For production, the vault is not an ordinary private-key wallet controlled by Silver Labs.

The target is a protocol-defined transaction graph containing:- deposit state;

- withdrawal paths;
- timeout paths;
- dispute paths;
- recovery paths;
- bond handling.

The exact graph is a separate security-critical specification.

### Status

**PROTOTYPE TARGET:** controlled development vault.

**OPEN RESEARCH:** fully enforceable production vault graph under current BTCS Script.

---

# 24. Deposit Protocol

```text
User
  │
  │ BTCS transaction
  ▼
Canonical deposit/vault
  │
  │ required confirmations
  ▼
L2 derivation
  │
  ▼
L2 BTCS credit
```

Each deposit ID binds:

- BTCS transaction;
- exact output;
- destination;
- rollup ID;
- L1 origin;
- protocol version.

This prevents replay across:

- reorgs;
- test networks;
- rollup versions;
- alternative branches.

Initial target:

**12 BTCS confirmations.**

This is a development parameter, not a claim of absolute finality.

---

# 25. Deposit Reorganization Handling

A deposit cannot be treated as permanent merely because it appeared once.

If an L1 reorg removes the deposit:

1. the L2 detects the changed L1 history;
2. the deposit is removed from the canonical derived state;
3. dependent transactions are re-derived;
4. the L2 state returns to the canonical BTCS history.

The bridge accounting invariant is checked after the reorg.

---

# 26. Withdrawal Protocol

A normal withdrawal is:

```text
L2 user
  │
  │ withdrawal
  ▼
L2 state
  │
  │ finalized withdrawal root
  ▼
withdrawal proof
  │
  ▼
BTCS settlement graph
  │
  ▼
L1 BTCS
```

The withdrawal proof must demonstrate:

- finalized state;
- membership in that state;
- correct account;
- correct amount;
- correct destination;
- unused withdrawal ID;
- valid withdrawal nonce.

---

# 27. Withdrawal ID

Each withdrawal ID includes the security context:

```text
rollup_id
L2 chain context
protocol version
finalized commitment
account
withdrawal nonce
amount
destination
```

This prevents equivalent claims from being replayed across:

- versions;
- branches;
- test networks;
- alternative commitment histories.

---

# 28. Withdrawal Accounting Invariant

After every:

- deposit;
- withdrawal;
- reorg;
- challenge;
- finalization;
- upgrade;

the system checks:

```text
redeemable L2 BTCS
    <=
secured BTCS vault value
+
valid protocol accounting
```

If the invariant fails, the protocol enters a defined invalid state and blocks further security-sensitive progression.

A valid state root alone is not enough.

---

# 29. Partial Withdrawal Failure

The canonical state of a consumed withdrawal must come from the blockchain/protocol itself rather than an indexer's private database.

Example:

```text
withdrawal transaction confirms
       ↓
indexer crashes
       ↓
indexer restarts
       ↓
reads canonical L1 history
       ↓
withdrawal already consumed
       ↓
repeat claim rejected
```

This behavior is mandatory for the production design.

---

# 30. Withdrawal Fee and Dust Rules

The protocol must define:

- gross withdrawal amount;
- settlement fee;
- minimum spendable output;
- dust rejection;
- who pays settlement fees;
- behavior when L1 fees rise.

A withdrawal that cannot safely produce a valid L1 output must be rejected before final authorization.

---

# 31. Forced-Inclusion Transaction Format

The forced transaction is an authenticated L1 message.

It must include:

```text
rollup_id
protocol_version
sender
nonce
L2 transaction payload
fee parameters
L1 inclusion reference
```

The derivation function determines whether the message is valid.

Invalid messages are ignored deterministically.

Valid messages enter the canonical queue.

A forced message cannot be invalidated merely because the sequencer dislikes it.

---

# 32. Sequencer Queue Protection

Forced inclusion creates its own attack surface.

The protocol therefore defines limits on:

- queue size;
- message size;
- gas;
- lifetime;
- sender nonce conflicts;
- dependency conflicts.

A sequencer cannot be forced into an infinite amount of expensive work by spam.

A user cannot force a transaction that is valid only at one moment and later becomes invalid without deterministic queue semantics.

---

# 33. Proposer

A proposer publishes:

```text
parent_state_root
batch commitment
new_state_root
```

The proposer must post a bond.

The proposal enters a challenge period.

The proposer is not automatically trusted because it operates the official sequencer.

---

# 34. Proposer Bond

The bond must be tied to value at risk.

A proposer should not be able to finalize a fraudulent state whose potential impact greatly exceeds the economic cost of cheating.

The protocol therefore uses:

```text
bond requirement
+
value-at-risk constraints
+
slashing
```

The precise bond formula is:

**BENCHMARK REQUIRED.**

It must be derived from:

- maximum value finalized per claim;
- challenge costs;
- fee conditions;
- expected attack profitability;
- griefing resistance.

---

# 35. Challenger

The system requires an independent challenger.

The challenger:

1. monitors BTCS L1;
2. downloads batch data;
3. reconstructs L2 state;
4. compares the proposal;
5. identifies invalid claims;
6. enters the dispute;
7. completes the proof game.

The sequencer is not the challenger.

At least one independent actor must be capable of monitoring the network during the challenge period.

---

# 36. Challenger Incentive

An honest challenger must be economically able to respond.

The production protocol therefore requires:

- challenger reward;
- challenge bond or anti-griefing deposit where needed;
- reimbursement for valid dispute costs;
- fee-bumping support;
- bounded challenge workload;
- clear timeout rewards.

The exact values are:

**BENCHMARK REQUIRED.**

A theoretical challenge mechanism without sustainable incentives is not a practical security model.

---

# 37. Challenge Window

Initial production target:

**288 BTCS blocks ≈ 24 hours at target timing.**

The challenge window begins only after the relevant data and commitment are confirmed under the protocol's safe-head rules.

The final value depends on:

- BTCS block timing;
- network latency;
- proof generation time;
- reconstruction time;
- fee conditions;
- reorganization risk.

Therefore the final challenge window is:

**BENCHMARK REQUIRED.**

---

# 38. Challenge Game

The intended dispute process is:

```text
Proposer
   │
   │ state claim
   ▼
BTCS
   │
   │ challenge window
   ▼
Challenger
   │
   │ dispute
   ▼
Execution trace
   │
   │ recursive bisection
   ▼
single disputed step
   │
   ▼
verifier machine
   │
   ▼
valid / invalid
```

The critical goal is to reduce a potentially enormous EVM computation into a bounded final dispute.

---

# 39. Proof-System Boundary

This is the most important unresolved engineering interface.

The proof system must define how:

```text
Geth EVM execution
        ↓
canonical state transition
        ↓
verifiable machine program
```

maps to a deterministic proof environment.

The verifier must receive exactly:

- the canonical parent state;
- batch data;
- transaction encoding;
- protocol version;
- EVM rules;
- block-field semantics;
- state-root rules.

It must produce exactly the same state transition result as the canonical L2.

### Status

**OPEN RESEARCH**

until the complete EVM-to-verifier equivalence is demonstrated.

---

# 40. Simplified Proof Prototype

The first proof experiment does **not** attempt to prove the complete Geth EVM.

It begins with a deterministic transfer machine:

```text
balances
nonces
deposits
withdrawals
```

The proof system must successfully:

1. produce a valid trace;
2. create a deliberately invalid trace;
3. identify a disagreement;
4. bisect the disagreement;
5. resolve the final execution step;
6. enforce the correct outcome.

Only after that works do we expand the machine toward the actual EVM transition.

This avoids falsely claiming that a transfer proof demonstrates an EVM fault-proof system.

---

# 41. EVM-to-Proof Expansion

The expansion sequence is:

```text
Transfer machine
      ↓
account/state machine
      ↓
transaction execution
      ↓
gas accounting
      ↓
storage
      ↓
logs/receipts
      ↓
EVM opcodes
      ↓
precompiles
      ↓
complete state transition
```

Each stage gets independent test vectors.

No stage is considered solved merely because the previous stage works.

---

# 42. State-Root Equivalence

The strongest compatibility test is:

```text
Canonical Geth execution
          ↓
       State Root A

Verifier execution
          ↓
       State Root B
```

Acceptance requires:

```text
State Root A == State Root B
```

for every valid test vector.

Test vectors include:

- ordinary transfers;
- contracts;
- storage;
- gas exhaustion;
- reverts;
- nested calls;
- logs;
- edge cases;
- malformed transactions.

---

# 43. Proof Timeout Rules

Every dispute move must have a defined L1-based deadline.

A move includes:

- challenge transaction;
- response;
- proof segment;
- verification step.

Timeout rules must specify:

- who wins;
- who loses;
- bond destination;
- what happens if fees rise;
- how a participant fee-bumps;
- how an unconfirmed move is treated;
- what happens after an L1 reorg.

A participant disappearing cannot create an ambiguous outcome.

---

# 44. Bond Model

The economic layer contains:

### Proposer bond

Protects the protocol against fraudulent claims.

### Challenger bond

Prevents arbitrary malicious griefing where necessary.

### Slashing

The losing party loses the defined portion of its bond.

### Reward

The successful challenger receives sufficient compensation to make honest monitoring economically viable.

### Fee reimbursement

Valid dispute transactions need a mechanism to remain executable under fee spikes.

Exact parameters are:

**BENCHMARK REQUIRED.**

---

# 45. Data Publication Economics

For each batch:

```text
L1 data cost =
published size
× effective BTCS fee rate
+
transaction overhead
```

Then:

```text
L1 cost per L2 transaction =
L1 batch cost / L2 transaction count
```

The prototype benchmarks:

```text
1,000 transactions
10,000 transactions
100,000 transactions
```

under multiple:

- compression ratios;
- BTCS fee rates;
- transaction sizes.

---

# 46. Capacity Is Not Availability

Nominal unused block space does not prove the rollup is viable.

The project must measure:

- usable bytes;
- relay policy;
- standardness;
- miner inclusion;
- fee spikes;
- transaction and witness limits;
- compression under adversarial data;
- historical replay size;
- recovery bandwidth.

The relevant metric is:

> **Reliable cost per recoverable L2 transaction under realistic conditions.**

Not:

> “There appears to be empty block space.”

---

# 47. Batch Size

Larger batches reduce average L1 publication overhead.

But larger batches increase:

- publication delay;
- reconstruction time;
- proof workload;
- reorg exposure;
- worst-case recovery data.

Therefore the protocol will use a measured batch-size limit.

The limit is:

**BENCHMARK REQUIRED.**

The benchmark must measure both normal and worst-case transaction entropy.

---

# 48. Recovery Requirement

A new node must be able to recover from L1 data without access to:

- Silver Labs servers;
- the sequencer's database;
- a private archive;
- another blockchain.

The recovery path is:

```text
BTCS chain
    ↓
locate canonical batches
    ↓
decode data
    ↓
derive L2 blocks
    ↓
execute deterministic state transition
    ↓
rebuild state
```

This is a core rollup property.

---

# 49. Reorganization Handling

BTCS has probabilistic PoW finality.

The L2 must therefore track L1 origins.

If an L1 reorganization removes data:

```text
L1 reorg
   ↓
invalidate affected derived inputs
   ↓
recompute safe head
   ↓
rederive L2
   ↓
recalculate commitments
```

Tests must cover reorgs affecting:

- deposits;
- forced transactions;
- batch chunks;
- commitments;
- disputes;
- withdrawals.

Acceptance:

> Two independent implementations converge to the same canonical state after the reorganization.

---

# 50. Bridge Threat Model

| Threat               | Attacker capability                         | Mitigation                             | Remaining assumption   | Failure outcome |
| -------------------- | ------------------------------------------- | -------------------------------------- | ---------------------- | --------------- |
| Deposit replay       | Replay a valid deposit                      | Context-bound deposit ID               | Canonical L1 history   | Reject          |
| Deposit reorg credit | Spend after a deposit that later disappears | Confirmation threshold + re-derivation | PoW security           | Roll back       |
| Fake withdrawal      | Invent an L2 claim                          | Finalized-state proof                  | Verifier correctness   | Reject          |
| Withdrawal replay    | Reuse a paid withdrawal                     | Canonical withdrawal ID                | L1 history             | Reject          |
| Accounting mismatch  | Create more L2 BTCS than vault can pay      | Global invariant                       | Correct vault state    | Freeze          |
| Indexer crash        | Repeat an already paid withdrawal           | Derive consumption from L1             | Canonical chain        | Reject          |
| Dust                 | Create unspendable L1 output                | Minimum withdrawal rules               | Fee model              | Reject          |
| Vault key theft      | Compromise development key                  | Development-only isolation             | Production graph later | Prototype only  |

---

# 51. Data Threat Model

| Threat                | Mitigation                                |
| --------------------- | ----------------------------------------- |
| Missing chunk         | Availability rule blocks finality         |
| Duplicate chunk       | Deterministic reject                      |
| Out-of-order chunk    | Canonical index                           |
| Wrong chunk hash      | Batch validation fails                    |
| Compression abuse     | Bounded decompression                     |
| Version confusion     | Protocol-version binding                  |
| Nonstandard relay     | Policy benchmark                          |
| Selective publication | Commitment cannot finalize until complete |
| Recovery denial       | Clean-node reconstruction test            |

---

# 52. Proof Threat Model

| Threat                        | Mitigation                           |
| ----------------------------- | ------------------------------------ |
| False state root              | Challenge/fault-proof                |
| Dishonest proposer            | Bond + challenge                     |
| Challenger disappears         | Timeout rules                        |
| Proposer disappears           | Timeout/replacement                  |
| Fee spike                     | Fee-bump mechanism                   |
| Proof/input mismatch          | Canonical serialization              |
| EVM/verifier mismatch         | State-root equivalence vectors       |
| Correlated implementation bug | Independent reference implementation |
| Infinite dispute              | Bounded trace/challenge protocol     |
| Bond too small                | Value-at-risk constraints            |

---

# 53. Sequencer Threat Model

| Threat                 | Mitigation               |
| ---------------------- | ------------------------ |
| Censorship             | Forced inclusion         |
| Reordering             | Deterministic derivation |
| Fake deposit           | L1-derived deposit rules |
| Fake withdrawal        | Finalized state proof    |
| Delayed batching       | Safe-head rules          |
| Crash                  | Independent verifier     |
| Database corruption    | L1 recovery              |
| Malicious block fields | Canonical L2 field rules |

---

# 54. EVM Threat Model

The L2 must defend against valid-but-expensive workloads.

Protocol limits therefore apply to:

- maximum gas per L2 block;
- maximum batch gas;
- transaction size;
- decompression cost;
- state growth;
- replay time;
- proof-trace length;
- proof memory;
- proof generation time.

A transaction may be valid EVM code and still be rejected at the rollup layer if it violates a resource limit.

---

# 55. RPC and User-Facing Finality

Wallets must distinguish:

```text
unsafe
safe
finalized
```

An application should not treat an unsafe sequencer response as equivalent to finalized L1 settlement.

RPC methods and explorer interfaces must expose the same terminology.

This prevents applications from accidentally treating reversible state as final ownership.

---

# 56. Upgrade Security

Every L2 commitment contains:

```text
protocol_version
```

Unknown versions are rejected.

An upgrade must provide a documented path for existing finalized state and withdrawals.

An emergency mechanism may stop:

- new deposits;
- new commitments;
- new protocol activity.

It must not gain the ability to:

- confiscate finalized balances;
- rewrite finalized ownership;
- arbitrarily cancel valid withdrawals.

---

# 57. Upgrade Authority

The production upgrade mechanism is:

```text
proposal
 ↓
public specification
 ↓
implementation
 ↓
testnet
 ↓
compatibility tests
 ↓
adversarial tests
 ↓
scheduled activation
```

The exact governance authority remains to be finalized.

The production design must not rely on an unrestricted private key held by one person or company.

---

# 58. Prototype vs Production Bridge

### Prototype

May use:

- controlled development vault;
- developer signer;
- simplified withdrawal flow;
- simulated challenges.

### Production

Must use:

- protocol-defined vault;
- canonical accounting;
- enforceable withdrawal rules;
- dispute handling;
- unilateral recovery;
- no permanent Silver Labs custody dependency.

The prototype must expose which operations are still trusted.

---

# 59. Build vs Borrow

| Component              | Decision                                      |
| ---------------------- | --------------------------------------------- |
| BTCS L1                | **Keep existing BTCS Core**                   |
| EVM                    | **Borrow/adapt Geth**                         |
| L2 execution node      | **Build BTCS-specific Go layer**              |
| Sequencer architecture | **Adapt mature rollup patterns**              |
| Batcher                | **Build BTCS-specific**                       |
| Derivation             | **Build BTCS-specific**                       |
| Data format            | **Build BTCS-specific**                       |
| BTCS commitments       | **Build BTCS-specific**                       |
| Deposits               | **Build BTCS-specific**                       |
| Forced inclusion       | **Build BTCS-specific**                       |
| Withdrawal accounting  | **Build BTCS-specific**                       |
| Vault graph            | **Build/validate BTCS-specific**              |
| Fraud proof            | **Adapt BitVMX-style architecture**           |
| Full EVM verifier      | **Open research until equivalence is proven** |
| L3                     | **Optional**                                  |
| New L1                 | **No**                                        |
| Second native coin     | **No**                                        |

---

# 60. Repository Architecture

```text
btcs-l2/
│
├── node/
├── execution/
│   ├── evm/
│   └── state/
│
├── sequencer/
├── derivation/
├── batcher/
│
├── settlement/
│   ├── btcs/
│   ├── commitments/
│   ├── vault/
│   └── disputes/
│
├── bridge/
│   ├── deposits/
│   ├── withdrawals/
│   └── accounting/
│
├── verifier/
├── proof/
│
├── rpc/
│
├── tests/
│   ├── compatibility/
│   ├── consensus/
│   ├── reorg/
│   ├── bridge/
│   ├── availability/
│   ├── proof/
│   ├── economics/
│   ├── adversarial/
│   └── differential/
│
├── vectors/
├── docs/
└── scripts/
```

---

# 61. Development Software

## Required

```text
Git
VS Code
Go
Python
CMake
Visual Studio + C++
```

## Later

```text
Node.js / TypeScript
Solidity tooling
Foundry / Hardhat compatibility tools
```

## Not required initially

```text
Rust
custom EVM
new L1
new PoW coinexternal blockchain
```

Rust becomes relevant later for proof-system work where justified.

---

# 62. Development Machine Strategy

### Smaller Acer

Use for:

- VS Code;
- Git;
- Go;
- Python;
- L2 development;
- tests;
- documentation.

### Larger 2 TB / 32 GB PC

Use for:

- BTCS Core;
- Visual Studio C++;
- CMake;
- BTCS regtest;
- multiple L1 nodes;
- long-running test networks;
- heavier proof/replay workloads.

---

### v0.4 implementation note

**All work through the prototype phases is development and evidence gathering unless explicitly promoted by a later white paper revision.**

The phase numbers below describe an engineering progression, not a promise that every mechanism will become part of the final product.

A phase may end with a mechanism being:

```text
accepted
modified
replaced
rejected
or returned to research
```

The white paper is updated after those findings so the documented architecture follows the product that testing proves viable.

### v0.4 implementation note

**All work through the prototype phases is development and evidence gathering unless explicitly promoted by a later white paper revision.**

The phase numbers below describe an engineering progression, not a promise that every mechanism will become part of the final product.

A phase may end with a mechanism being:

```text
accepted
modified
replaced
rejected
or returned to research
```

The white paper is updated after those findings so the documented architecture follows the product that testing proves viable.

# 63. Phase 0 — Toolchain

Install:

```text
Git
Go
Python
VS Code
Visual Studio C++
CMake
```

Pin versions in the repository.

Record operating-system and compiler versions where they affect reproducibility.

---

# 64. Phase 1 — BTCS Private L1

Build BTCS Core privately.

Run:

```text
BTCS regtest
```

Verify:

- blocks;
- transactions;
- wallets;
- RPC;
- chain parameters;
- reorganization behavior.

No mainnet changes.

---

# 65. Phase 2 — Deterministic L2

Implement:

```text
L2 transaction
      ↓
state
      ↓
state root
```

Start with deterministic transfers.

Two independent nodes must agree.

---

# 66. Phase 3 — EVM

Integrate Geth EVM components.

Deploy:

- simple Solidity contract;
- ERC-20;
- ERC-721.

Verify state-root changes.

---

# 67. Phase 4 — RPC Compatibility

Implement the required JSON-RPC surface.

Initial compatibility targets:

```text
eth_call
eth_sendRawTransaction
eth_getTransactionByHash
eth_getBlockByNumber
eth_getBalance
eth_getLogs
eth_chainId
eth_estimateGas
net_*
web3_*
```

Connect an EVM wallet.

---

# 68. Phase 5 — BTCS Settlement Adapter

**v0.9 status update:** initial local components now exist for anchor payload/OP_RETURN encoding, replay-gated anchor preparation, trusted-RPC confirmation verification, loopback-only read access to BTCS Core RPC, and publication lifecycle transitions. The original task list below remains the end-to-end target; the live/regtest transaction creation, signing, broadcasting, confirmation watcher, full batch-data publication, and reorganization workflow are not yet complete. See Section 2.6 for the current implementation record.

Implement:

```text
BTCS RPC client
BTCS block reader
confirmation tracker
reorg detector
commitment encoder
batch publisher
```

Prove:

```text
L2 batch
    ↓
BTCS transaction
    ↓
BTCS regtest
```

---

# 69. Phase 6 — Data Availability

Publish real batch data to BTCS.

Then perform clean-node recovery.

This is a hard gate.

If recovery fails, the publication design must be changed before additional security claims are made.

---

# 70. Phase 7 — Bridge Prototype

Implement:

```text
BTCS deposit
    ↓
L2 credit

L2 withdrawal
    ↓
development vault
```

Clearly mark development-only trust assumptions.

---

# 71. Phase 8 — Forced Inclusion

Publish an L1 forced transaction.

Verify:

```text
sequencer online
sequencer censors
       ↓
forced transaction
       ↓
canonical L2 derivation
       ↓
transaction eventually included
```

Repeat with:

- sequencer offline;
- L1 reorg;
- duplicate message;
- invalid message;
- nonce conflict;
- fee spike.

---

# 72. Phase 9 — Independent Recovery

Run:

```text
BTCS Node A
BTCS Node B
BTCS Node C

L2 Sequencer
L2 Verifier A
L2 Verifier B
```

Disconnect the sequencer.

Delete verifier state.

Rebuild from BTCS data.

The resulting state roots must match.

---

# 73. Phase 10 — Simplified Fault Proof

Implement the deterministic transfer-machine dispute.

Produce:

```text
valid claim
invalid claim
challenge
trace bisection
final disputed step
verification
slashing/reward
```

Test every timeout path.

---

# 74. Phase 11 — EVM Proof Integration

Only after the simplified proof works:

```text
transfer machine
       ↓
state machine
       ↓
transaction execution
       ↓
Geth execution
       ↓
full EVM transition
```

The EVM proof boundary remains a gate until the complete state-root equivalence test passes.

---

# 75. Phase 12 — Production Vault

Replace the controlled vault with the protocol-defined settlement graph.

Requirements:

- no ordinary Silver Labs custody key;
- canonical withdrawal authorization;
- timeout path;
- challenge path;
- recovery path;
- replay protection;
- fee handling;
- reorg safety.

This phase cannot be declared complete by code existence alone.

It requires transaction-level test vectors.

---

# 76. Phase 13 — Adversarial Network

Run independent nodes and deliberately create:

```text
sequencer censorship
invalid blocks
invalid state roots
fake deposits
fake withdrawals
withdrawal replay
deposit replay
reorgs
missing chunks
duplicate chunks
malformed encodings
proof disagreement
late dispute
offline challenger
offline proposer
fee spike
RPC failure
database corruption
```

The expected outcome for every test must be defined before the test is run.

---

# 77. Threat-Test Hard Gates

## Fresh recovery

The node must recover using only canonical BTCS data.

## Independent implementation

Go, Python, and proof/verifier logic must agree on a shared corpus.

## Reorgs

All tested L1 boundaries must converge correctly.

## Bridge invariant

Redeemable L2 BTCS must never exceed secured value.

## Forced inclusion

A valid forced transaction must enter canonical derivation.

## Disputes

An intentionally false claim must be defeat-able.

## Timeout

A disappearing participant must never produce an ambiguous final result.

## Economics

Worst-case batch costs must remain measurable and bounded.

---

# 78. Cost Benchmark Program

For each batch size:

```text
1,000
10,000
100,000
```

record:

```text
uncompressed bytes
compressed bytes
number of BTCS transactions
total vbytes
effective BTCS fee rate
total BTCS settlement cost
L2 tx count
BTCS cost / L2 transaction
replay time
recovery time
proof generation time
proof verification time
```

Repeat under:

- normal fee conditions;
- elevated fees;
- worst-case transaction entropy;
- compression failure scenarios.

---

# 79. Recovery Benchmark

Measure:

```text
L2 history size
BTCS data size
download time
decode time
replay time
state rebuild time
hardware requirements
```

A rollup that is theoretically recoverable but practically impossible to replay is not an acceptable production design.

---

# 80. Proof Benchmark

Measure:

```text
trace length
trace storage
proof generation time
proof size
verification time
BTCS transaction count
challenge cost
worst-case dispute duration
```

The proof system is not considered practical until these numbers are known.

---

# 81. Protocol Kill Criteria

The project stops or redesigns a component if:

- two honest implementations can produce different canonical state;
- fresh-node recovery is impossible from BTCS data;
- bridge accounting can over-redeem;
- forced inclusion can be permanently defeated;
- proof disputes can produce ambiguous outcomes;
- withdrawal safety depends permanently on Silver Labs;
- fees make data publication uneconomic;
- the EVM transition cannot be reproduced by the verifier;
- a required property cannot be enforced under BTCS's available settlement capabilities.

These are protocol stop signs.

They are not bugs to hide.

---

# 82. Emergency Behavior

Emergency controls may stop:

- new deposits;
- new proposals;
- new commitments.

Emergency controls must not provide arbitrary control over finalized user balances.

Previously finalized withdrawals must retain a defined recovery path.

An emergency stop is therefore a **liveness control**, not a custody mechanism.

---

# 83. L3

L3 is optional.

The interface remains:

```text
BTCS L1
    ↓
BTCS L2
    ↓
applications
```

A future L3 can become:

```text
BTCS L1
    ↓
BTCS L2
    ↓
application-specific L3
```

Only use it where it provides a measurable advantage in:

- throughput;
- privacy;
- application-specific execution;
- isolation;
- cost;
- scaling.

---

# 84. Long-Term Ecosystem

```text
                         BTCS
                           │
                    ┌──────┴──────┐
                    │             │
                  L1 Nodes      L2 Nodes
                    │             │
                    └──────┬──────┘
                           │
                    BTCS L2 / EVM
                           │
       ┌───────────────────┼───────────────────┐
       │                   │                   │
      DeFi               NFTs                Games
       │                   │                   │
    Payments            Markets              dApps
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
                  Wallet / Explorer
                           │
                  SilvEx / SilverPay
                           │
                    BTCS ecosystem
```

The purpose is not merely more transactions per second.

The purpose is:

> **Use BTCS as the base monetary asset across saving, spending, contracts, commerce, applications, and settlement.**

---

# 85. Core Economic Thesis

The intended economic path is:

```text
BTCS store of value
       ↓
BTCS used on L2
       ↓
BTCS pays gas
       ↓
BTCS used in applications
       ↓
BTCS denominates markets
       ↓
BTCS settles back to L1
```

Applications expand BTCS utility rather than displacing BTCS.

---

# 86. Final Protocol Position

The BTCS L2 production candidate is:

> **A BTCS-native optimistic rollup with Geth-based EVM execution, BTCS as native gas and settlement asset, BTCS-published data availability, canonical UTXO-backed bridge accounting, forced inclusion, bonded commitments, interactive dispute resolution, and a BitVMX-style verifiable execution environment.**

The system does not require:

- Ethereum as settlement;
- Solana as settlement;
- Syscoin as settlement;
- a second native coin;
- a separate L1;
- an L3;
- a custom EVM.

The project reuses proven technology while keeping BTCS-specific ownership and settlement logic under Silver Labs development control until it can be independently verified and hardened.

---

# 87. Definition of Done

A secure BTCS L2 is not “done” when EVM contracts execute.

It is done only when the complete path works:

```text
BTCS L1
    ↓
BTCS deposit
    ↓
L2 credit
    ↓
EVM transaction
    ↓
BTCS gas
    ↓
L2 state transition
    ↓
state root
    ↓
batch
    ↓
BTCS data publication
    ↓
independent reconstruction
    ↓
state commitment
    ↓
false claim
    ↓
independent challenge
    ↓
dispute resolution
    ↓
valid state finality
    ↓
withdrawal proof
    ↓
BTCS release
    ↓
sequencer shutdown
    ↓
user recovery
```

The decisive properties are:

1. **One canonical state can be reconstructed from BTCS data.**
2. **L2 BTCS cannot over-redeem the secured L1 value.**
3. **Users have a censorship escape path.**
4. **An invalid state claim can be defeated without trusting the proposer.**

Only after those properties are demonstrated should a public testnet be treated as a serious security network.

---

# 88. Final Engineering Principle

The project is intentionally compositional:

```text
BTCS
+
Geth EVM
+
rollup architecture
+
Bitcoin verification research
+
BTCS-specific settlement
=
BTCS programmable ecosystem
```

We borrow the solved pieces.

We build the pieces that have to understand BTCS.

We measure what cannot be assumed.

We do not call something trustless until the protocol enforces it.

And we do not change BTCS L1 consensus unless testing proves that doing so is necessary.

The project succeeds when Bitcoin Silver remains the store of value at the bottom while the entire programmable ecosystem above it can execute quickly, remain reconstructible, resist censorship, survive operator failure, and return user-owned value to BTCS without requiring another blockchain to exist.
