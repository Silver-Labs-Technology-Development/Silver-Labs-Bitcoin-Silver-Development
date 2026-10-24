# BTCS L2 whitepaper v1.2 — requirements → implementation matrix

Status: first-pass mapping, 2026-10-21. Authority:
`docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md`. Status values: IMPLEMENTED,
PARTIAL, PLANNED, MISSING, DOC-ONLY. Evidence refers to code/tests/docs in this
repository. This matrix maps the prototype-relevant sections; it is not a claim
that any production subsystem is complete.

## First-milestone acceptance (§5)

| Area | Requirement (§5.1) | Status | Evidence |
|---|---|---|---|
| Regtest environment | Reproducible multi-node BTCS testing | PARTIAL | Local single/dual regtest nodes used by E2Es; no multi-node private-net harness yet |
| Deterministic transfer machine | Minimal canonical L2 state transition | IMPLEMENTED | `PersistentBlockProcessor`, deterministic state/roots, replay tests |
| Canonical batch encoding | Versioned byte-level batch encoding | IMPLEMENTED | `settlementEnvelope`, `settlementBatch`, `btcsL1BatchData` (BTCD v-marker), codec tests |
| L1 data publication | Publish and read batch data via BTCS | IMPLEMENTED | `e2e:batch-data` PASS (128 fragments, byte-exact reconstruction) |
| Clean-node recovery | Reconstruct L2 state from BTCS data without the sequencer DB | PARTIAL | Batch reconstruction + independent execution replay PASS; no full clean-node EVM state rebuild from L1 alone |

Acceptance condition "a clean verifier can reconstruct one deterministic L2 state
from BTCS data without the sequencer's private database": **PARTIAL** — batch
bytes reconstruct and re-execute independently, but the end-to-end clean-node
state rebuild is not yet demonstrated.

## Core protocol sections

| § | Area | Status | Evidence / gap |
|---|---|---|---|
| 10 | Economic role (BTCS store of value/gas/settlement/bridge asset) | PARTIAL | Native asset used for gas in harness; bridge accounting prototype only |
| 11 | EVM execution | IMPLEMENTED | EVM harness, token/deploy/call tests, dev sequencer |
| 12 | Deterministic state transition | IMPLEMENTED | Deterministic roots, nonce ordering, replay tests |
| 13 | L2 block | IMPLEMENTED | `BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md`, block hashing tests |
| 14 | L2 head model | PARTIAL | Canonical tip + read views; finality reporting minimal |
| 15 | Sequencer | PARTIAL | Development sequencer only (`btcs_dev_mine`); no production sequencer |
| 16 | Forced inclusion | MISSING | Not implemented (SG-02/03) |
| 17 | Data availability | PARTIAL | `btcsL1BatchDataAvailability` scanner; trusted loopback RPC, no DA proofs |
| 18 | L1 data publication | IMPLEMENTED | `btcsL1BatchData`, `e2e:batch-data` incl. reorg mode |
| 19 | Commitment format | IMPLEMENTED | `settlementEnvelope`/`settlementBatch`, verification scripts |
| 20 | Commitment chain | IMPLEMENTED | Parent commitment linkage in envelopes; verification tests |
| 21 | Independent derivation | IMPLEMENTED | `verify:batch`, `verify:batch:execution` PASS |
| 22 | Fresh-node recovery test | PARTIAL | Batch reconstruction + execution replay; full fresh-node EVM rebuild outstanding |
| 23 | Canonical bridge vault | MISSING / OUT-OF-SCOPE | Prototype, not production escrow (SG-12) |
| 24 | Deposit protocol | PARTIAL | `e2e:deposit` PASS on real regtest; trust-local-RPC boundary |
| 25 | Deposit reorganization handling | PARTIAL | `depositReorgAccounting`, `depositReorgRecovery`, live batch-data reorg; per-deposit attribution partial (SG-04) |
| 26–30 | Withdrawal protocol / ID / invariant / failure / fee | MISSING | No withdrawal/exit implementation (SG-02) |
| 33–44 | Proposer, bonds, challenger, challenge game, proof system | MISSING / RESEARCH | No proposer/bond/challenge or proof implementation (SG-03) |
| 45–47 | Data publication economics, capacity vs availability, batch size | PARTIAL / PLANNED | Batch size bounded (16 KiB / 468 fragments); economics not modeled |
| 48 | Recovery requirement | PARTIAL | Checkpoint recovery + deposit reorg recovery; always-on automation missing (SG-05) |
| 49 | Reorganization handling | PARTIAL | Scanner reorg handling + live reorg E2E; deeper-than-retained deep reorg is fail-closed (SG-11) |
| 50–54 | Threat models (bridge/data/proof/sequencer/EVM) | DOC-ONLY | Whitepaper + `SECURITY-GAP-REGISTER.md`; not enforced in code |
| 55 | RPC and user-facing finality | PARTIAL | Local JSON-RPC (`BTCS-L2-RPC-v0.12-DRAFT.md`); finality reporting minimal |
| 56–57 | Upgrade security / authority | MISSING | No upgrade path/authority model implemented |
| 60 | Repository architecture | IMPLEMENTED | `execution/evm` layout documented in README |

## Notes

- "IMPLEMENTED" means the prototype path exists and is covered by tests and/or a
  real-Core regtest E2E; it does not imply production readiness.
- Production bridge, withdrawals, fraud/validity proofs, multi-host coordination,
  and trustless inclusion remain open; see `SECURITY-GAP-REGISTER.md` and
  `PRIVATE-TESTNET-RELEASE-READINESS.md`.
