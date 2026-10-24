# BTCS L2 private-testnet and release-readiness checklist

Status: draft, 2026-10-21. Scope: readiness of the `execution/evm` prototype for
a controlled private testnet. `[x]` = done and evidenced; `[~]` = partial;
`[ ]` = not done. This is not a mainnet readiness claim.

## Build, test, determinism

- [x] Pinned Node v24.17.0 documented and used.
- [x] `npm run typecheck` clean.
- [x] Full EVM suite green (366 tests: 365 pass, 1 skipped live BNB, 0 fail, 187.3s on 2026-10-22).
- [x] Deterministic store ordering (no locale-dependent comparisons).
- [x] Deterministic transaction selection (address-sorted round-robin), covered by tests.
- [~] End-to-end scenario execution is script-driven; no single unified orchestrator.

## Core integration (local regtest evidence)

- [x] Real deposit-to-settlement E2E passes (`e2e:deposit`).
- [x] Batch-data publication + byte-exact reconstruction passes (`e2e:batch-data`).
- [x] Anchor publication + durable store recovery passes (`e2e:anchor`).
- [x] Destructive batch-data reorg scenario passes (`e2e:batch-data` reorg mode).
- [x] Anchor reorg mode live evidence (gate requires a node on port 29444 with the reorg datadir/store). Captured 2026-10-21.
- [x] Harness never starts/stops Core; cookies are never printed.

## Data availability and reorg

- [x] Bounded active-chain scanner with confirmation tracking.
- [x] Tip-height/tip-hash bracketing fails closed on chain changes during a scan.
- [x] Orphan/replacement re-inclusion revalidated and reconstructed.
- [ ] Per-deposit (non-fungible) source attribution on reorg recovery.

## Security

- [x] Deposit-recovery gate enforced on both canonical tip-advancing entry points.
- [x] Adoption defense-in-depth (refuses adoption while a frozen credit remains).
- [x] Cross-process serialization via OS file lock (single host).
- [~] Local partial L1 proof verification is integrated into confirmation/deposit when `gettxoutproof` is available; the header/active chain still trusts local Core RPC, and canonical most-work selection/P2P/finality are absent. Not trustless inclusion.
- [ ] Withdrawal/exit path with challenge semantics.
- [ ] Fraud/validity proof architecture.
- [ ] Multi-host coordination.

## Configuration and safety

- [x] Fail-fast preflight (regtest-only, loopback-only, readable cookie).
- [x] Destructive reorg modes gated by port/datadir/wallet/store.
- [ ] Operator runbook for deploying a multi-node private testnet.
- [ ] Key management / secret handling beyond local regtest cookies.

## Observability and operations

- [~] Structured errors and typed recovery failures; no metrics/tracing.
- [~] Publication state is durable and recoverable after reopen.
- [ ] Health/metrics endpoints for a hosted testnet.
- [ ] Backup/restore and upgrade/migration procedures.

## Documentation

- [x] Whitepaper v1.2, block-protocol, RPC, transaction-pool drafts.
- [x] Deposit reorg accounting and recovery docs.
- [x] Regtest E2E result docs for deposit, batch-data, anchor.
- [x] Integrated prototype runbook.
- [x] Security-gap register.
- [ ] Requirements→implementation matrix vs whitepaper v1.2.
- [ ] Private-testnet deployment/hardening guide.

## Verdict

Private testnet: **not ready** — Core-integration and DA/reorg paths are
evidence-backed, but canonical/trustless inclusion, withdrawals/exit, proof
architecture, multi-host coordination, operations hardening, and the integrated
wallet/explorer/NFT journey remain open (see `SECURITY-GAP-REGISTER.md` and
`docs/PUBLIC-RELEASE-STAGES.md`). The current release status is local prototype
**PARTIAL**, public developer test **NOT STARTED/BLOCKED**, production readiness
**NOT GRANTED**, and public production release **NOT AUTHORIZED**. Mainnet:
**out of scope**.
