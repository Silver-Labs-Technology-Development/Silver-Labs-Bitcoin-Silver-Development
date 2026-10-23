# BTCS L2

## Bitcoin Silver Ecosystem Rollup

### Technical Whitepaper v1.6 — Whole-Ecosystem North Star and BTCS-Native EVM Architecture

**Project:** Bitcoin Silver (BTCS)  
**Development:** Silver Labs Technology & Development  
**Status:** Evolving technical specification and prototype engineering record  
**Technical baseline:** v1.2 architecture; v1.3 engineering checkpoint; v1.4 security/release gate; v1.5 BTCS-gas, BSNA, wallet, and multichain decision update; v1.6 whole-ecosystem north-star  
**Primary objective:** Extend Bitcoin Silver with programmable, EVM-compatible Layer 2 execution while preserving BTCS as the intended monetary, gas, and settlement asset and preserving BTCS L1 consensus/network compatibility.

> **Versioning note:** v1.2–v1.5 are preserved as historical checkpoints. v1.6 adds the whole-ecosystem north-star: mining and the BTCS L1 foundation, the BTCS L2, developer/token infrastructure, exchange and swaps, wallets and payments, explorers/nodes, commerce, and ecosystem operations. The north-star defines the intended integrated destination; it is not a claim that all components exist or are production-ready. Roadmaps, milestones, implementation order, and release tracks may change without changing this destination. Sections 89–96 remain authoritative for the v1.5 technical decisions on BTCS gas, BSNA, wallets, and multichain boundaries, except where this revision records the later SilverPay product decision. Earlier technical and security sections remain for traceability and govern unresolved rollup-security requirements. Reported engineering results are not independently rerun by this document revision.
>
> **SilverPay product decision (2026-10-22):** SilverPay is the single Silver Labs wallet-and-payments product. The separate Silver Wallet product is retired from the roadmap and is not a dependency. SilverPay Wallet is Phase 1 and the initial delivery priority; SilverPay Payments is Phase 2 and remains planned. SilverForge and Silver Scan remain separate integrated products. See Section 100 and `docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

## Current Architecture Decision Snapshot — 2026-10-22 (v1.5)

### Architecture decisions

1. **BTCS L1 remains the SHA-256 Proof-of-Work / UTXO base layer.** Do not change L1 consensus or network parameters as part of the current BSNA work.
2. **BTCS L2 is our EVM-compatible execution environment.** Reuse a proven EVM implementation; do not build a new VM or an independent Layer 1 for the first release. The current local EVM harness has been reported as running with the EthereumJS VM profile and development chain ID `31337`; that value is for local development, not a production network identifier.
3. **BTCS is the intended native L2 gas asset as well as the monetary and settlement asset.** EVM execution does not inherently require ETH. The L2 defines the account balance, fee accounting, base-unit mapping, gas-price semantics, and wallet network metadata. Confirm the exact implementation and unit conversion in code and tests before describing the entire L1-to-L2 gas funding path as complete.
4. **BSNA is the asset-standard family, not a second native gas coin and not a separate blockchain.** `BSNA-F1` is the proposed working name for the first fungible-asset profile; its name and specification remain provisional until versioned and ratified. The profile should preserve ERC-20-compatible interfaces on BTCS L2 and define additional BSNA requirements for identity, supply policy, permissions, metadata, verification, and conformance.
5. **MetaMask compatibility is an EVM-network integration.** MetaMask should connect to BTCS L2 through its RPC endpoint, actual chain ID, and declared native currency configuration once the required JSON-RPC and transaction/signing paths are implemented and tested. The token remains deployed on BTCS L2; ERC-20 compatibility does not mean it is deployed on Ethereum.
6. **One SilverForge experience may route to multiple chain adapters.** Ethereum and BNB Smart Chain deployments occur on those networks and use their respective gas assets. Native Solana SPL Token / Token-2022 creation uses Solana programs, transactions, and SOL fees. The current EVM does not execute native Solana programs merely because a Forge selector exists.
7. **No unapproved L1 consensus changes, no new independent VM, and no second L2 gas token.** Preserve the existing trust-model and release gates below. Keep withdrawal, challenge, proof submission, and bond-slashing execution disabled until the relevant protocol/security gates are satisfied.

### Whole-ecosystem north-star — authoritative destination (v1.6)

The goal is not merely an EVM beside Bitcoin Silver. The goal is an integrated ecosystem in which the existing BTCS Proof-of-Work Layer 1 and its miners form the monetary and network foundation; the BTCS L2 adds programmable execution; and connected Silver Labs products make BTCS usable for mining, development, assets, exchange, custody choices, payments, commerce, and applications. This section defines the stable destination. The engineering roadmap may reorder or split the work as evidence, resources, security reviews, and dependencies change.

The intended system includes the following connected parts:

1. **BTCS Layer 1 and monetary foundation:** existing Bitcoin Silver UTXO/Proof-of-Work network, consensus-compatible node software, block production, peer-to-peer network, transaction validation, chain history, and BTCS as the ecosystem's base monetary asset. No L1 consensus or network-parameter changes are implied by this vision.
2. **Mining and network participation:** individual mining, mining pools, pool operations and payout accounting, miner onboarding/documentation, node operation, network monitoring, and public mining/network statistics. Mining remains the foundation of the L1 security model; any pool, payout, or mining-service implementation must respect the existing protocol and security model.
3. **BTCS L2 execution and settlement:** EVM-compatible smart-contract execution, BTCS-denominated native gas as the intended design, deterministic state transitions, sequencer operation, data availability, L1 publication/commitments, deposit attribution, recovery, and secure exits/withdrawals. Production security properties must be proven, not inferred from local EVM success.
4. **BSNA asset ecosystem:** a versioned family of fungible and non-fungible asset profiles, token contracts, NFTs, metadata and logo handling, supply/permission policies, verification, and conformance tests. ERC-20/ERC-721-compatible interfaces may be used on BTCS L2 where appropriate. BSNA is an ecosystem asset-standard/brand family, not a second native gas coin or an independent blockchain; each profile requires its own specification.
5. **SilverForge developer product:** a usable UI and developer workflow to create, configure, deploy, inspect, and verify tokens and NFTs; upload logos and metadata; select the intended network and standard; review fees and permissions; connect supported wallets; and report real transaction outcomes. One Forge experience can route to separate chain adapters, but it must never pretend those chains share the same execution environment.
6. **SilverPay Wallet and account access:** the owned SilverPay wallet experience, including clearly separated BTCS L1 UTXO accounts and BTCS L2 EVM accounts, native/token/NFT balances, real sends and receipts, transaction history, and SilverForge/Silver Scan integration. MetaMask-compatible EVM connectivity is a target for BTCS L2. Solana support requires its own wallet/signing integration. Key custody, signing, backup, and recovery must be clearly disclosed and security-reviewed. The retired separate Silver Wallet application is not a required dependency.
7. **SilvEx exchange and swap infrastructure:** the intended exchange ecosystem, including centralized exchange capabilities where properly licensed and secured, non-custodial swap functionality, liquidity and market integrations, trading interfaces, market data, and APIs. Custodial trading, listing, fiat access, cross-chain swaps, and live markets are distinct deliverables with legal, operational, liquidity, and security dependencies; they are not created automatically by the L2.
8. **SilverPay Payments (Phase 2):** consumer and merchant payment experiences delivered through the SilverPay product after the wallet and its underlying transaction/settlement capabilities are demonstrated; payment requests, merchant integration, transaction status, receipts, and future terminal/API services. Supported assets, custody model, settlement path, and network fees must be explicit for every payment flow. Payments are planned, not part of the initial SilverPay Wallet release.
9. **Silver Scan and network analytics:** block and transaction exploration for BTCS L1 and BTCS L2, address and asset views, contract/token metadata, settlement status, network statistics, and operational dashboards. Data must identify which chain and trust level it represents.
10. **Silver Node and infrastructure services:** node deployment and maintenance tooling, supported network configurations, RPC/indexer infrastructure, monitoring, alerts, backups, release automation, and operational documentation. Multi-coin or external-chain services must remain clearly separated from the BTCS consensus implementation they do not control.
11. **Silver Labs developer platform:** APIs, SDKs, RPC documentation, examples, test environments, reference contracts, indexer access, developer onboarding, test tooling, and integration guides so independent developers can build applications and services on the ecosystem.
12. **Applications, games, NFTs, and community projects:** third-party and first-party applications that use BTCS L1/L2 and BSNA assets, subject to the capabilities and security of the underlying infrastructure. The ecosystem should support independent builders rather than require every application to be owned by one operator.
13. **Bitcoin Silver Store and real-world commerce:** the online retail and brand/merchandise channel as an ecosystem business and potential adoption surface. Product sales and payments must not be represented as technically on-chain unless the actual transaction flow is implemented and verifiable.
14. **Cross-chain integrations:** separate adapters for Ethereum, BNB Smart Chain, and Solana where prioritized. Ethereum and BNB EVM deployments use each network's own native gas asset; native Solana SPL/Token-2022 operations use Solana programs and SOL. Cross-chain messaging, wrapped assets, and bridges require independent designs, risk disclosures, audits, and supply/accounting rules.
15. **Governance, security, and ecosystem operations:** transparent protocol and product change records, open-source contribution paths, incident response, security disclosure, release signing, access controls, service-level monitoring, documentation, and community feedback. Governance mechanisms must be explicitly designed; they should not be implied by token ownership alone.

**Integration principle:** these are connected products, not one giant application or one shared trust boundary. Each component must publish its dependencies, APIs, supported networks, custody assumptions, operational owner, security gates, and verified completion evidence. A shared brand or UI does not make two systems technically integrated.

**Completion principle:** the north-star is achieved only when the individual products are usable and their cross-component journeys work end to end—for example, a developer can connect to the correct network, deploy a BSNA asset in SilverForge, inspect it in Silver Scan, use it through SilverPay Wallet, and transfer it through a genuinely implemented supported path. SilverPay Payments is a later milestone and is not demonstrated by a wallet transfer alone. Exchange listings, mining pool payouts, merchant settlement, external-chain deployment, and L1/L2 deposits or withdrawals each require their own acceptance tests. A roadmap task marked complete is not sufficient without evidence.

### Current status and evidence boundary

The v1.4 source records the latest available OpenCode checkpoint as of 2026-10-21: the local EVM/settlement prototype and test suite were reported passing, with remaining high-priority security gaps around L1 RPC trust, exits/proofs, deposit attribution, and recovery. The project owner subsequently confirmed that the EVM/gas development path has been exercised locally; however, this document editor has not rerun the repository or audited the exact latest fee code. OpenCode must verify the current implementation rather than infer completion from architecture notes.

As of the 2026-10-22 conversation, work was also reported as underway across BNB Chain, Solana, the Qt GUI wallet, website, and Online Forge. Treat these as development work in progress, not verified end-to-end features. Opening the Bitcoin Silver GUI against an isolated `regtest` test wallet only validates that GUI/test setup; it is not evidence that the L2 RPC, MetaMask connection, BSNA minting, or external-chain minting works.

### Immediate engineering acceptance gates

- Inspect current branch/worktree and the latest implementation before editing; do not overwrite or duplicate existing bot work.
- Audit native fee accounting and unit conversion: EVM account-balance subunits, BTCS L1 atomic units, deposits/credits, gas charging, receipts, balance queries, and any withdrawal/settlement representation must be consistent and precisely specified.
- Prove a local MetaMask-compatible custom-network flow using the actual L2 RPC and chain ID: chain connection, native BTCS balance, signed transaction, BTCS-denominated fee deduction, BSNA contract deploy, token transfer, receipt, and persisted state after restart. Use only regtest/private test data.
- Write `BSNA-F1` specification and a reference contract only after the implementation audit determines what token/asset code already exists. Add conformance and permissions tests.
- Keep native Solana SPL creation as a distinct Solana adapter unless an explicitly scoped Solana execution runtime is separately designed and justified. Do not claim that adapter is part of the EVM.
- Continue the v1.4 security release gates. EVM/gas functionality does not resolve L1-to-L2 bridge trust, reorg-after-spend accounting, forced inclusion, proof verification, or unilateral withdrawals.

## Historical Architecture and Release-Gate Snapshot — 2026-10-21 (v1.4)

### Interim recommendation — pending stakeholder sign-off

**Interim operating model:** treat the existing system as a **trusted/federated prototype**, with its trust assumptions documented and its use restricted accordingly. Do not describe the current build as trustless or as a production rollup.

**Longer-term target:** investigate an **optimistic rollup with fraud proofs** if BTCS L1's script/verification capabilities can support a sound, enforceable dispute mechanism without unacceptable consensus or compatibility changes. The feasibility and exact construction must be demonstrated, not assumed. **Validity proofs are a longer-term research track**, subject to specialist cryptographic review and feasible verification on BTCS L1. The recommendation remains a decision proposal until stakeholders explicitly sign off on the exit/proof strategy.

This is a staged direction, not authorization to implement withdrawal, challenge, proof-submission, or bond-slashing code.

### What can proceed safely now

1. Improve clean-node recovery/reconstruction tests using published L1 artifacts, with reproducible setup and evidence capture.
2. Document the interim trust model, the intended exit procedure at a conceptual/operational level, and the requirements a future censorship-resistant/forced-inclusion path would need to satisfy. Documentation is not a claim that such an exit path exists.
3. Harden deposit attribution where inputs and accounting rules are explicit. Where attribution cannot be resolved without inventing protocol semantics, expose the limitation and leave it blocked for a protocol decision.
4. Continue data-availability, canonical-chain, reorganization, restart, and recovery hardening.
5. Add fail-closed mocked-RPC tests for trust boundaries and test clean-node recovery from L1-published artifacts.

### Decisions required before protocol implementation

The following require explicit stakeholder/protocol decisions before implementation: exit timing and finality windows; bond amounts, lock-up and refund rules; who is permitted to challenge and how challengers are rewarded; the L1-verifiable dispute mechanism; whether and how forced inclusion is supported; peg/vault/escrow accounting and custody assumptions; and the relationship between L1 confirmations, L2 finality and withdrawal eligibility.

### Specialist review required

Fraud-proof construction and verification, validity-proof circuits and verifiers, dispute-game correctness, bridge/vault threat modelling, and economic security/bond assumptions require specialist review. Passing conventional unit or E2E tests alone is not a substitute.

### Features that must remain disabled

Until the design is approved, implemented, tested adversarially, and reviewed, keep **withdrawal execution, challenge/response execution, proof submission, and bond slashing disabled**. Do not create an apparent exit path that relies on an operator promise or undocumented manual intervention. No code change may imply that these controls are enforceable on BTCS L1 until that has been demonstrated.

### Latest reported repository and validation checkpoint

OpenCode reports:

- Branch: `experimental/deposit-prelude-v1`; HEAD: `d9ae157`.
- Worktree: no staged changes; 8 modified files and 8 untracked files. Existing work was preserved; no commits or pushes were made.
- Typecheck: clean.
- Batch-data availability tests: 11/11 passing.
- Full test suite: 254/254 passing, zero failures.
- `git diff --check`: clean.
- Reorg/deposit evidence logs are reported under `/tmp/opencode/` on the development host.

These are reported results from the development environment, not independently reproduced by the document editor.

### Security-gap status reported in the current checkpoint

| Gap(s) | Reported status | Engineering interpretation |
| :--- | :--- | :--- |
| SG-01 | Open — high | L1/Core RPC trust boundary needs explicit constraints, tests and fail-closed behavior; RPC-reported inclusion is not an independent inclusion proof. |
| SG-02, SG-03 | Open — high | Exit/withdrawal guarantees and proof enforcement remain unresolved; keep withdrawal/proof paths disabled. |
| SG-04 | Partially open — medium/high | Deposit attribution/accounting must not guess ambiguous values; harden what is explicit and document the rest. |
| SG-05, SG-06, SG-11 | Partially open, by-design, or medium/high per register | Recovery/operator intervention and multi-host operational assumptions need exact scope, controls and testing. Preserve the register's entry-by-entry detail. |
| SG-07 | Reported mitigated | Typed handling differentiates malformed/conflicting protocol data from incomplete/unrelated data; keep adversarial regression tests. |
| SG-09 | Reported mitigated/monitored | Mitigation depends partly on locked, controlled execution paths; re-evaluate if those boundaries change. |
| SG-10, SG-12 | Low priority / out of current scope per report | Do not silently equate out-of-scope with permanently resolved; retain rationale and revisit triggers in the gap register. |

### Dependency-ordered release plan

| Gate | Priority and work | Acceptance evidence | Status / dependency |
| :--- | :--- | :--- | :--- |
| **Q1 — Architecture decision** | Obtain stakeholder sign-off for interim trust model and intended exit/proof strategy. | Signed decision record explaining trust assumptions, exits, challenge rights, bonds, L1 dispute support and forced-inclusion choice. | **Blocking protocol implementation**; recommendation exists, sign-off still required. |
| **Q2 — Security hardening** | Test SG-01 trust-boundary fail-closed behavior; close or explicitly bound SG-04 attribution gaps; document SG-06 multi-host/locking assumptions; add clean-node recovery integration test from L1 artifacts. | Reproducible test logs, threat-boundary notes, adversarial cases, updated security register. | Can proceed safely in parallel with Q1 where work does not decide protocol semantics. |
| **Q3 — Private testnet readiness** | Update the ops/runbook design, improve crash/restart/reorg/adversarial coverage, define monitoring and recovery procedures. | Repeatable setup and teardown instructions, clean-node and failure drills, explicit non-production trust warnings. | Depends on Q2 baseline; no public-fund usage. |
| **Q4 — Independent review and release candidate** | Arrange independent security review, formal acceptance criteria, reproducible release artifacts, and a release-blocker review. | Review findings tracked to closure/accepted risk; RC checks and rollback/recovery evidence. | Depends on architecture decisions and Q2/Q3 evidence. No production release until high-risk findings are resolved or explicitly governed. |

**Immediate top-five execution order:** (1) stakeholder decision on exits/proofs; (2) clean-node recovery integration test from L1 artifacts; (3) SG-01 trust-boundary documentation and fail-closed mocked-RPC tests; (4) SG-04 attribution hardening or a clearly bounded unresolved specification; (5) expand adversarial testing and prepare an independent review package.

**Confidence statement:** confidence is high that the reported prototype scenarios and automated tests passed in the stated development environment, subject to independent reproduction. Confidence in production trustlessness is low by design because exits, proof enforcement, and key trust boundaries are not yet solved.

---

## Historical Engineering Snapshot — v1.3 (2026-10-21)

The following records the prior v1.3 checkpoint for traceability. Where this historical status or its proposed architecture conflicts with the v1.5 decision snapshot above, **v1.5 controls**.

### Recorded Engineering Snapshot — 2026-10-21 (v1.3)

**Position:** The local EVM prototype now has reported end-to-end evidence for deposit processing/crediting, settlement-batch data publication and reconstruction, anchor publication/confirmation, and recovery across BTCS L1 regtest reorganizations. The latest OpenCode run reports **254/254 tests passing**, typecheck clean, `git diff --check` clean, and no commits or pushes. These are prototype and isolated-regtest results, not evidence of production readiness or a trustless bridge.

| Workstream | Current status | Evidence and boundary |
| :--- | :--- | :--- |
| Local EVM execution, canonical blocks, persistence and replay | **Prototype implemented and tested** | Existing automated suite covers signed EVM transactions, contracts, receipts/logs, state roots, persistence/reopen, replay, tamper rejection and failure boundaries. Full suite reported 254/254 passing; exact production-engine suitability remains unproven. |
| Checkpoints and continuation replay | **Prototype implemented and tested** | Checkpoints are checked against replay-derived canonical history. This is not yet a trust-authentic checkpoint bootstrap from BTCS-published data. |
| Settlement envelopes and batch verification | **Prototype implemented and tested** | Ordered batches, parent/commitment links, deterministic hashes, execution replay and tamper rejection are covered locally. |
| BTCS L1 deposit processing and L2 credit | **Regtest E2E reported PASS** | OpenCode reports a confirmed regtest deposit was decoded, verified and credited in L2 state. This relies on the configured BTCS Core RPC trust boundary; it is not a trustless bridge. |
| Batch-data publication and reconstruction | **Regtest E2E reported PASS** | Reported result: 128 fragments / 4,472 bytes reconstructed byte-for-byte, with the commitment observed at BTCS L1 regtest height 402. This demonstrates the tested harness path, not universal availability guarantees. |
| Anchor publication and confirmation | **Regtest E2E reported PASS** | A separate anchor reorganization run reportedly invalidated the original inclusion, recovered on the replacement branch, and confirmed the replacement inclusion. Logs are reported under `/tmp/opencode/anchor-reorg-e2e-run-*.log` on the development host. |
| Deposit/settlement reorganization recovery | **Targeted regtest E2E reported PASS; protocol limitations remain** | OpenCode reports the destructive batch-data reorg cycle orphaned 129 records and re-included all 129 on a replacement branch, with byte-exact reconstruction. Recovery behavior remains bounded by the implemented trust model and test harness. |
| Batch-data availability scanner | **Hardened; adversarial tests pass** | Scanner now distinguishes incomplete data from malformed/conflicting data using typed protocol errors. Reported availability tests: 11/11 pass, including six added adversarial tests. |
| Security-gap register | **Reviewed; several gaps remain open** | SG-07 reported mitigated; SG-09 reported mitigated/monitored for locked controlled paths. SG-01 through other unresolved entries still require evidence-driven review and mitigation. Do not infer all security gaps are closed. |
| Withdrawals and exits | **Not implemented as a production protocol** | The project has a decision brief; exit rules, trust assumptions and safe release of L1 value remain architecture decisions. |
| Fraud/validity proofs and trustless settlement | **Not delivered** | No production-enforced fraud-proof or validity-proof system has been established by these tests. A trusted/federated prototype, optimistic design and validity-proof design must be evaluated explicitly. |
| Production rollup security and public release | **Not ready** | Independent security review, trust-minimized exits, robust data availability, censorship escape paths, and production recovery/accounting guarantees remain unresolved. |

### Latest reported validation evidence

OpenCode reported the following on 2026-10-21:

```text
Full test suite: 254 passed, 0 failed
Batch-data availability tests: 11/11 passed
Typecheck: clean
Git diff --check: clean
Commits/pushes: none
Real transactions: none
BTCS L1 consensus changes: none
Datadir destruction: none
```

Additional reported E2E details:

- **Deposit E2E:** test deposit `add1502…:0`, observed at L1 height 202 with two confirmations, credited as `1e17 wei`; reported L2 state root begins `0x680666` and ends `a9f9b`.
- **Batch data:** 128 fragments and 4,472 bytes reconstructed byte-for-byte; commitment reported at L1 regtest height 402.
- **Anchor reorg:** original inclusion invalidated, replacement branch re-included and confirmed. Logs reported at `/tmp/opencode/anchor-reorg-e2e-run-*.log`.
- **Batch-data reorg:** original publication block invalidated; 129 records became orphaned, then all 129 were re-included on the replacement branch and reconstructed byte-for-byte.
- **Scanner hardening:** malformed fragments, conflicting batch hashes, duplicate fragments and multiple-fragment conditions now raise typed `ProtocolError`; unrelated OP_RETURN records or missing valid fragments are treated as incomplete rather than verified availability.

These values and results are transcribed from the OpenCode summary, not independently rerun or independently inspected here. The logs and result documents on the development host remain the primary artifacts to verify. Do not treat a green suite as proof that the complete L2 is trustless or production-secure.

### Current stage map

| Stage | Current position | Next exit requirement |
| :--- | :--- | :--- |
| **1 — EVM execution** | Local prototype broadly tested; reported full suite passes | Confirm pinned-runtime acceptance, add differential testing and select a production execution-engine strategy. |
| **2 — Storage, replay and recovery** | Persistence, canonical replay and checkpoint continuation tested | Demonstrate clean-node bootstrap/reconstruction from BTCS-published data; broaden crash, corruption and recovery drills. |
| **3 — Settlement envelopes and batches** | Local validation and execution replay tested; batch-data publication/reconstruction E2E reported PASS | Continue independent validation and adversarial coverage; define durable canonical availability guarantees. |
| **4 — BTCS L1 settlement and deposits** | Deposit, publication and reorganization E2E scenarios reported PASS on isolated regtest | Make runs repeatable from a clean environment; audit evidence, trust boundaries and failure modes. |
| **5 — Rollup security** | Critical protocol choices remain open | Decide withdrawals/exits, data-availability model, forced inclusion/censorship escape, and fraud-proof or validity-proof enforcement. |
| **6 — Production readiness** | **Not reached** | Independent security review, adversarial testnet, operational recovery drills, monitoring, governance and explicit release acceptance criteria. |

### Current engineering priorities

1. **Verify and preserve this checkpoint:** inspect the exact worktree, logs, test output, and all uncommitted changes; retain v1.2 as an immutable historical version.
2. **Reconcile the full security-gap register:** distinguish code-enforced mitigations from operational controls; verify SG-01 through every listed gap against implementation and tests.
3. **Resolve protocol architecture:** compare optimistic rollup/fraud-proof, validity-proof, and explicitly trusted/federated initial designs. Document trust, exit, censorship, data availability, L1 compatibility and migration implications.
4. **Define and implement safe exits only after a decision:** do not add speculative withdrawal or proof code before the protocol model is approved and reviewed.
5. **Build repeatable private-testnet acceptance:** clean-node reconstruction, reorg/restart/crash drills, monitoring, backup/restore, reproducible build instructions and release-blocking criteria.

---

### What the deposit prototype does — and does not mean

The current model uses a BTCS transaction containing a `BTCSL2D` OP_RETURN intent that identifies the EVM recipient, alongside a payment to the configured deposit destination. A configured BTCS Core RPC is trusted to report transaction and active-chain details. After the required confirmations, a durable deposit record can be converted into a canonical L2 deposit operation; the operation is committed into L2 block state and protected against duplicate credit in the prototype.

This is **not a trustless bridge**. The current implementation does not itself provide a BTCS SPV/light-client proof, an enforceable production vault, a withdrawal/exit protocol, or safe resolution of a reorg after the L2 credit has been spent. The fixed test recipient and regtest amount are fixtures, not production defaults to expose to users.

### Current stage map

| Stage | v1.2 position | Next exit requirement |
| :--- | :--- | :--- |
| **1 — EVM execution** | Local prototype broadly tested; pinned-runtime acceptance still outstanding | Run typecheck, full suite, client demo and verifier under Node `24.17.0`; later differential testing and production-engine decision. |
| **2 — Storage, replay and recovery** | Persistence, canonical replay, checkpoint continuation tested | Define trusted bootstrap from L1-published data; broaden crash/corruption/reorg recovery. |
| **3 — Settlement envelopes and batches** | Local validation and independent replay tested | Confirm integrated deposit operation through regtest settlement; maintain adversarial coverage. |
| **4 — BTCS L1 settlement and deposits** | Components and an E2E script exist, but end-to-end result is not demonstrated; no npm command/README procedure, and Core RPC was unreachable at last check | First make the runner reproducible and fail-fast before side effects; review its preconditions and documentation; then, as a separate approved execution step, run it against an isolated regtest and record evidence. |
| **5 — Rollup security** | Research/prototype gaps remain | Resolve reorg-after-spend accounting; design enforceable withdrawals, forced inclusion, data availability, and challenge/proof enforcement. |
| **6 — Production readiness** | Not reached | Independent security review, adversarial testnet, operational recovery drills, monitoring and governance. |

### Engineering priority — next work, in bounded tasks

**Next task: `BTCS-L2-STAGE4-001` — Make the deposit E2E reproducible and fail-fast.** This is a repository/code-and-documentation task only. Add an explicit `e2e:deposit` npm script, add preflight checks for the configured CLI, daemon/RPC reachability, `chain=regtest`, and readable RPC cookie before any mining or transaction creation, and document prerequisites/commands/side effects in `execution/evm/README.md`. Update `docs/WORK-QUEUE.md` with the task and acceptance checks. Do not start/stop Core, mine, broadcast, delete or reset any data directory, or commit/push as part of this bounded task. Keep the E2E invocation's existing environment-variable overrides and ensure failures explain what must be corrected.

**Next execution task, only after code review/approval: `BTCS-L2-STAGE4-002` — Run the isolated regtest E2E and preserve PASS evidence.** Before starting anything, verify the exact `bitcoinsilverd` flags via its help output, choose a dedicated datadir whose prior contents are not ambiguous (prefer a new isolated path over reusing an uninspected existing directory), start only that regtest daemon, confirm `getblockchaininfo` reports `chain=regtest`, run `npm run e2e:deposit` under Node `24.17.0`, capture the JSON result and Core height changes, and stop only the node started for this task. The E2E is expected to mine 101 plus two blocks and broadcast a 0.1 BTC **regtest-only** transaction. Do not run it against a normal BTCS data directory or a shared/valuable wallet.

**Parallel acceptance item:** Node `24.17.0` is already installed at `~/.nvm/versions/node/v24.17.0/bin/node`. Prefix commands with `export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"` and run `npm run typecheck`, `npm test`, `npm run demo:client`, and `npm run verify:batch:execution` for the client-demo acceptance review. Keep `BTCS-L2-CLIENT-002` at `READY_FOR_REVIEW` until a human reviews the deliverable; do not silently mark it complete.

**Following security task:** `BTCS-L2-SECURITY-001` — specify and test accounting when an L1 deposit is reorganized out after its L2 credit has been spent. Include reorg-before-credit, after-credit-before-spend, after-spend, re-inclusion, duplicate deposit and over-credit cases. This is a protocol safety blocker, not a cosmetic cleanup.

Only after these gates should the project broaden toward clean-node reconstruction from BTCS-published data, enforceable withdrawals, forced inclusion, and proof/dispute enforcement.
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

The long-term architecture proposal previously considered was:

> **A BTCS-native optimistic rollup using deterministic EVM execution, BTCS-published L2 data, canonical UTXO settlement, forced inclusion, bonded state commitments, interactive dispute resolution, and a BitVMX-style verification environment.**

**Current status under v1.4:** this is a conditional target, not an approved production protocol. The interim system is treated as a trusted/federated prototype. Optimistic fraud-proof design is contingent on proving that BTCS L1 can enforce the required dispute mechanism; validity proofs remain a longer-term research track. Exit, challenge, bond, peg/escrow and forced-inclusion rules require stakeholder decision and specialist review. Withdrawal, challenge/response, proof-submission and bond-slashing execution must remain disabled until these gates are met.

This document intentionally separates:

**Specified** — protocol rule sufficiently defined for implementation.

**Prototype Target** — implementation direction used for private testing.

**Benchmark Required** — cannot be finalized until measured.

**Open Research** — security-critical mechanism requiring cryptographic validation.

A prototype that successfully executes EVM transactions and publishes state roots is **not** considered a secure rollup.

---

# 2. Document Status, Evolution, and Versioning

This white paper is an **evolving engineering record**. The current engineering status is the v1.3 snapshot at the beginning of this document; older milestone sections preserve historical context and may contain superseded status statements.

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
| **v1.3** | Updated engineering status from the 2026-10-21 OpenCode report: 254/254 tests, deposit/batch-data/anchor reorg E2E results, availability-scanner hardening, reviewed security gaps, and withdrawal/proof decision brief | **Prototype E2E milestone reported complete; protocol security and production release remain unresolved** |

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

# 86. Historical Long-Term Protocol Proposal — Conditional, Not Approved

Earlier revisions proposed the following as a potential production direction:

> **A BTCS-native optimistic rollup with Geth-based EVM execution, BTCS as native gas and settlement asset, BTCS-published data availability, canonical UTXO-backed bridge accounting, forced inclusion, bonded commitments, interactive dispute resolution, and a BitVMX-style verifiable execution environment.**

Under the v1.4 architecture gate, this proposal is **not** the currently approved production protocol. The interim implementation is to be treated as a trusted/federated prototype with explicit, bounded trust assumptions. An optimistic-rollup target depends on demonstrating sufficient BTCS L1 script/verification flexibility for a sound and enforceable fraud-proof/dispute mechanism while preserving L1 consensus and network compatibility. Validity proofs are a longer-term research track, not a committed implementation.

Before either design can become a protocol commitment, stakeholders must decide exit timing/finality, bonds, challenge rights, the L1 dispute mechanism, forced inclusion, and peg/vault/escrow semantics. Specialist review is required for proof construction, verification, dispute-game security and bridge threats. Withdrawal execution, challenge/response execution, proof submission and bond slashing must remain disabled until the design is approved, implemented, tested and reviewed.

The project still intends to avoid an unnecessary second native token or settlement dependency on an external blockchain. That economic goal does not relax the requirement that bridge and exit security be enforceable and independently verifiable.

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

---

# 89. Architecture Decision Record — BTCS L2 and BSNA (v1.5)

**Decision status:** Working architecture direction approved by the project owner for continued prototype development. The BSNA-F1 name and standard remain provisional until the specification is reviewed and versioned. This decision does not authorize BTCS L1 consensus changes or production deployment.

## 89.1 System boundaries

```text
Bitcoin Silver L1
  SHA-256 Proof of Work / UTXO / BTCS monetary base
             │
             │ deposit, data publication, settlement (security model still gated)
             ▼
BTCS L2
  EVM-compatible execution / BTCS-denominated native gas (intended)
             │
             ├── BSNA-F1 fungible assets
             ├── future BSNA asset profiles (e.g. non-fungible assets)
             ├── dApps, DeFi, games, commerce, developer tools
             └── MetaMask-compatible EVM access / SilverForge / wallet / explorer

SilverForge external adapters (separate chain deployments)
  ├── Ethereum EVM → ERC-20-style contract → ETH gas on Ethereum
  ├── BNB Smart Chain EVM → BEP-20-compatible contract → BNB gas on BNB Chain
  └── Solana → SPL Token / Token-2022 program and mint → SOL fees on Solana
```

The distinction between native L2 execution and an external-chain deployment is normative. A contract deployed on BTCS L2 is part of BTCS L2 state. A deployment made by SilverForge on Ethereum, BNB Chain, or Solana is recorded on that external network and obeys its execution and fee rules. A common UI does not combine the underlying ledgers.

## 89.2 BTCS as L2 gas

The native execution environment can be EVM-compatible without requiring ETH as its fee currency. The EVM defines execution semantics; the L2 chain configuration and state transition determine the native balance asset and charge for gas. Therefore the intended model is: **users need BTCS-denominated L2 balance to execute transactions on BTCS L2**, including contract deployment, token transfers, and other state-changing operations.

The implementation must specify and test all of the following:

- the exact L2 native currency identifier/symbol and actual chain ID;
- the mapping between BTCS L1 atomic units and L2 EVM account subunits (do not assume a conversion ratio without verifying the implementation);
- gas-price, gas-limit, fee calculation, fee debit, and fee receipt semantics;
- whether the current sequencer, execution engine, RPC, receipts, balance query methods, and wallet metadata agree on the same denomination;
- how a user obtains a spendable BTCS balance on L2 and how deposit confirmation, duplicate-credit prevention, reorganization handling, and eventual settlement interact with that balance;
- whether the native balance/fee behaviour survives process restart, state replay, and clean-node reconstruction.

A local test showing that gas can be charged in the L2's BTCS-denominated unit is meaningful, but it is distinct from proving a trustless production bridge or withdrawal path. Never describe a fee path as end-to-end secure until those separate properties are demonstrated.

## 89.3 EVM and MetaMask compatibility

BTCS L2 should expose a standard EVM JSON-RPC interface and an actual configured chain ID so an EVM wallet such as MetaMask can add it as a custom network. The custom-network configuration must use the real endpoint, chain ID, native currency label, and appropriate explorer information (if available). The local prototype's chain ID `31337` is a development profile only and must not be copied blindly as the eventual public-network ID.

Compatibility acceptance must use a disposable/regtest account and test network connection, account selection, native BTCS-denominated balance display, transaction signing, native transfer (if supported), contract deployment, token transfer, receipt/gas reporting, and persistence/replay. Do not use or import a real-value wallet for local development verification.

ERC-20 is a contract interface, not a promise that the asset is on Ethereum and not a requirement that gas be paid in ETH. An ERC-20-compatible token contract deployed on BTCS L2 is an L2 token and uses the L2's fee currency. To reach a deployed token on Ethereum, the wallet must select Ethereum and transactions use Ethereum's fee system.

# 90. BSNA — Bitcoin Silver Native Assets

BSNA is the proposed asset-standard family for the Bitcoin Silver ecosystem. It is not a separate blockchain, not a replacement for the BTCS native coin, and not an additional gas token. BTCS remains the intended base monetary/gas/settlement asset; BSNA describes additional assets deployed within supported execution environments.

## 90.1 Proposed first profile: BSNA-F1

`BSNA-F1` is a provisional name for the first fungible-asset standard profile. It may be renamed before the first formal release. It is intended for BTCS L2 and should preserve ERC-20-compatible contract calls/events to benefit from common EVM wallets and tools while adding explicit BSNA-specific conformance requirements.

At minimum the specification must define:

1. **Identity:** standard/profile version, chain ID, contract address, name, symbol, decimals, and a unique network-qualified asset identifier.
2. **Supply policy:** fixed supply or capped mintable supply; initial issuance; mint/burn semantics; maximum supply if applicable.
3. **Authority and permissions:** who may mint, burn, pause, or change administrative settings; whether authority can be revoked; safe defaults and transparent disclosure.
4. **Metadata:** logo URI or content reference, description, links, persistence, update authority, content/type limits, and integrity checks as appropriate.
5. **Compatibility:** required ERC-20 functions/events and explicit handling of optional/non-standard behaviour.
6. **Verification:** reference source, compiler/settings, bytecode/source verification expectations, conformance tests, security review status, and a clear distinction between registered and merely self-labelled assets.
7. **Versioning:** backward-compatibility rules, deprecation policy, upgrade policy (prefer non-upgradeable first implementation unless a concrete requirement justifies otherwise), and an amendment process.

A token does not become a conforming BSNA-F1 asset merely because its name/symbol contains BSNA. Conformance must be testable. A registry or asset index may help the Forge, wallet, and explorer discover verified assets, but must not be confused with the consensus validity of the underlying contract.

## 90.2 First implementation boundary

The first implementation target is a tested BSNA-F1 reference contract deployed in the BTCS L2 development environment. It is not necessary to invent a new VM, change L1 consensus, or launch native asset parsing at Layer 1.

The reference contract must support ordinary transfer/balance/approval semantics and a declared supply policy. The initial recommended supply models are: (a) fixed initial supply with no mint authority after deployment, or (b) capped supply with explicitly controlled mint permissions and an enforced maximum. The creator must not be able to silently exceed a declared cap. Administrative powers must be visible to users.

BSNA-F1 should be followed by independent conformance tests and a real end-to-end SilverForge workflow: configure → validate → upload logo/metadata → review permissions → sign → deploy → verify contract/address → transfer → inspect receipt and token balance → restart/replay persistence test.

## 90.3 BSNA family expansion

Future profiles may cover non-fungible assets or other asset behaviours. Such profiles must be separately specified. A future Solana-compatible BSNA profile would use Solana's native token programs and its own transaction/account model; it is not automatically supported by the BTCS L2 EVM.

# 91. Multichain Model — One Forge, Separate Chain Adapters

The product goal is a coherent SilverForge experience with a network selector and common project metadata, but different under-the-hood chain adapters. This improves developer experience without pretending the networks share one state machine.

| Target selected in Forge | Resulting asset location | Execution/asset model | Native transaction fee asset |
|---|---|---|---|
| BTCS L2 | BTCS L2 | BSNA-F1 EVM contract; ERC-20-compatible interface | BTCS, once the actual native fee path is implemented and verified |
| Ethereum | Ethereum | EVM contract, commonly ERC-20-compatible | ETH |
| BNB Smart Chain | BNB Smart Chain | EVM contract, BEP-20-compatible interface | BNB |
| Solana | Solana | SPL Token or Token-2022 mint/program instructions | SOL |

The Forge should reuse common form fields and metadata where appropriate, but it must display the actual target chain, fee asset, wallet type, contract/mint result, and confirmation state before a user signs. It must never label an EVM contract on BTCS L2 as an SPL token merely because the UI supports both creation flows.

## 91.1 What compatibility means

- **EVM compatibility:** lets familiar EVM bytecode, ABI, JSON-RPC, and wallets be used where supported. It does not imply deployment onto Ethereum or BNB Chain.
- **BEP-20-compatible interface on BTCS L2:** may be implemented as an EVM contract with the required common interface, but the deployment remains on BTCS L2. A real BNB Chain deployment is separate and pays BNB fees.
- **Solana integration:** native SPL/Token-2022 mint creation needs Solana-aware software, a Solana-compatible signing wallet, Solana RPC and SOL for network fees. It is an external network integration unless and until a separate Solana VM/runtime is deliberately designed for BTCS L2. A Solana VM is not part of the current scope.
- **Cross-chain movement:** a token deployed separately on two chains is not automatically one asset and does not automatically share a supply. Matching names/symbols are not proof of backing. Bridging/wrapping and cross-chain messaging are separate protocols with separate threat models and audits.

# 92. SilverForge, SilverPay, Website, and Developer Experience

The product direction now combines SilverForge, SilverPay Wallet, Silver Scan, the website, and browser-based Online Forge into complementary entry points. A consistent visual experience is desirable, but the controls must reflect actual capability and connection state.

SilverPay replaces the separate Silver Wallet product. It is Silver Labs' own wallet-and-payments product; it must not require or depend on the existing BTCS Silver Wallet application. Phase 1 is the integrated SilverPay Wallet. Phase 2 adds payments after transaction, settlement, accounting, and security capabilities are verified. SilverForge asset creation and Silver Scan transaction inspection remain separate integrated products.

Forge requirements for the first usable BSNA flow include logo upload, metadata persistence, supply and authority settings, network and fee-asset display, a clear transaction review step, wallet signing, deploy/receipt handling, contract/address display, token verification, and failure-state reporting. UI placeholders and mock deployments must be labelled as such and must not report successful deployment.

SilverPay Wallet requirements include clearly separated BTCS L1 UTXO and BTCS L2 EVM accounts; native BTCS, supported token, and NFT balances; real send/receive flows; pending, confirmed, failed, fee, receipt, and error states; transaction history; SilverForge/Silver Scan links; safe local development signing; and explicit unavailable or unsupported actions. Seeds and private keys must never be exposed to the UI, logs, public APIs, or the explorer.

For EVM wallets, provide the real BTCS L2 RPC endpoint and chain ID. Do not expose secret keys to the website or Forge. Signing should occur in SilverPay, a supported external wallet, or a separately audited local signing implementation. For Solana, use the relevant Solana wallet adapter and transaction format; do not reuse EVM signing assumptions.

# 93. Current State and Evidence Discipline

This v1.5 document does not claim that every item in the long-term architecture is complete. The source v1.4 snapshot reports a local EVM/settlement prototype and 254/254 test results from OpenCode as of 2026-10-21; these are historical reported results, not independently reproduced by this revision. The project owner has stated that the BTCS-denominated EVM/gas path has been exercised locally. The precise latest state must be verified against the current source code, test output, branch and worktree when OpenCode resumes.

The Qt GUI was separately launched against Bitcoin Silver `regtest`, with no wallet imported from the user's real funds and no P2P connections after networking was disabled. That confirms a safe local GUI test context, not the existence of a working L2 connection from Qt.

BNB Chain, Solana, GUI wallet, website and Online Forge work were reported as started. Until code, build output and end-to-end tests are examined, describe those initiatives as in progress and do not claim that BNB, Solana, MetaMask, or BSNA minting is complete.

# 94. Acceptance Tests for the First BSNA-F1 Release

BSNA-F1 should not be marked implemented until the following are demonstrated in an isolated development environment:

1. The actual BTCS L2 RPC reports the expected local chain ID and stable chain/head semantics.
2. An EVM wallet connects to that network without requiring ETH; the test account has an L2 BTCS-denominated native balance.
3. A signed transaction is accepted and its gas fee is charged in the declared L2 native unit. The receipt, native balance change, and fee accounting agree.
4. The fee unit conversion between BTCS L1 atomic units and L2 EVM subunits is documented and tested at precision boundaries.
5. A BSNA-F1 contract deploys successfully on BTCS L2; its bytecode/address and parameters can be retrieved and independently checked.
6. Transfer, approval, delegated transfer, balances, supply and declared mint/burn permissions pass the conformance suite. Unauthorized minting and supply-cap violations fail.
7. Logo and metadata persist across restart and are tied to the correct network-qualified token identifier.
8. The wallet and Forge show the right network, token address, fees and transaction status; errors fail closed and do not fake success.
9. The token state survives the prototype's defined persistence/replay checks.
10. The test report clearly separates local EVM success from L1 deposit security, withdrawal/exit guarantees, production bridge trust, and external-chain deployment.

# 95. Updated Engineering Work Queue

**Task A — Audit the existing implementation before coding.** Inspect source files, current branch/worktree, existing token prototypes, RPC methods, native fee accounting, L1 deposit/settlement modules, Studio/Forge and wallet integration. Record what exists with paths and tests. Do not rewrite implemented modules just to match this document.

**Task B — Confirm BTCS gas end-to-end within the current prototype.** Establish exact denominations and conversion, signed EVM transaction behavior, fee deductions, receipt/gas reporting, persistent balances and clean restart/replay. Separate this from uncompleted production deposit/withdrawal guarantees.

**Task C — Draft BSNA-F1 specification.** Decide naming/versioning, required token interface, identity, supply policies, mint permissions, metadata, upgrade posture, and conformance criteria. `BSNA-F1` remains provisional until reviewed.

**Task D — Build or complete the reference contract and tests.** Reuse a trusted standard implementation where licensing permits. Avoid unnecessary custom token logic. Add adversarial permission/supply tests.

**Task E — Complete the BTCS L2 + wallet + Forge path.** Implement a MetaMask-compatible custom network flow and end-to-end BSNA-F1 creation on BTCS L2. Run only isolated/regtest development workflows.

**Task F — Verify separate external-chain adapters.** Ethereum/BNB deployments use EVM tooling but are distinct deployments; Solana needs native SPL/Token-2022 instructions and wallet signing. Add one adapter at a time, with explicit network-specific tests.

**Task G — Continue security gates from v1.4.** Do not let successful token minting imply that the rollup bridge is trustless. Keep unresolved withdrawal, forced inclusion, dispute-proof, data availability, reorg-after-spend accounting and L1 RPC trust gaps tracked independently.

# 96. v1.5 Change Log

- Added the owner-approved architecture direction for BTCS as the intended native gas asset on the existing EVM-compatible BTCS L2.
- Clarified that EVM/ ERC-20 compatibility does not mean a contract is deployed on Ethereum or that ETH is required for BTCS L2 gas.
- Added `BSNA-F1` as a **provisional** name for the first fungible token standard profile, with the required specification and conformance work still to do.
- Defined a single-Forge / multiple-chain-adapter model while distinguishing BTCS L2 assets from Ethereum, BNB Chain and native Solana assets.
- Clarified MetaMask-compatible custom-network requirements and the development-only status of local chain ID `31337`.
- Preserved the v1.4 security decision gates and reiterated that ERC-20 compatibility, BTCS gas tests, or a working GUI do not prove a trustless bridge or production-ready rollup.



# 97. Whole-Ecosystem Product Map — Stable North Star

This section is the durable scope inventory for planning and review. It describes intended product areas and their relationships, not a promise that each service is already implemented.

| Product/system | Role in the whole ecosystem | Key dependencies / proof of completion |
|---|---|---|
| BTCS L1 | Monetary and Proof-of-Work base layer | Existing consensus compatibility, node/network tests, chain validation |
| Mining and pools | Supports block production and miner participation | Pool accounting, payout tests, operational monitoring, no protocol assumption changes |
| BTCS L2 | Smart-contract execution and L1-linked settlement | EVM compatibility, deterministic replay, DA/commitments, secure deposits/exits and recovery |
| BSNA assets and NFTs | Fungible/non-fungible assets and metadata | Versioned standards, contracts/programs, permission tests, conformance and verification |
| SilverForge | Token/NFT creation and developer UI | Logo upload, metadata, network/standard routing, wallet signing, deploy/receipt/error states |
| SilverPay Wallet (Phase 1) | Owned wallet and account access for BTCS L1/L2 | Separate L1/L2 accounts, native/token/NFT balances, real send/receive and history, safe local signing, SilverForge/Silver Scan integration, restart/recovery tests |
| SilverPay Payments (Phase 2, planned) | Consumer/merchant payment workflows | Verified wallet and settlement dependencies, supported asset/network, quote/fee display, settlement confirmation, receipts, reconciliation and merchant tests |
| SilvEx | Exchange, trading and swap services | Custody model, liquidity, security, compliance/licensing where applicable, market operations |
| Silver Scan | Explorer and analytics | Accurate indexing, chain separation, reorg handling, contract/asset metadata and status |
| Silver Node | Node/RPC/infrastructure deployment and operations | Repeatable setup, monitoring, backups, upgrades, documented supported configurations |
| APIs, SDKs and developer portal | Lets independent builders integrate | Versioned interfaces, examples, stable test environment, automated integration tests |
| Apps, games and community projects | Ecosystem use cases | Real integration with documented APIs and safe asset handling |
| Bitcoin Silver Store | Retail/brand and potential commerce adoption | Working store operations; payment claims match the actual checkout implementation |
| External-chain adapters | Deploy/interact with assets on other chains | Chain-specific signing, fees, transaction verification, independent bridge risk controls |
| Governance and operations | Maintains quality and transparent development | Change control, incident response, release evidence, contribution and review processes |

## 97.1 End-to-end integration journeys

The long-term ecosystem should be evaluated through complete user journeys, not only repository milestones:

- **Miner journey:** install and run supported node/mining software, connect to the intended network or pool, understand hashrate and payout accounting, and independently verify rewards.
- **Developer journey:** obtain documentation and a test environment, connect a compatible wallet, select a network and asset standard in SilverForge, upload logo/metadata, deploy and verify the asset, and inspect it in Silver Scan.
- **Holder journey:** receive and view BTCS or supported BSNA assets in SilverPay Wallet, inspect L1/L2 transaction status, and understand network fees and custody assumptions.
- **Payment journey (Phase 2):** create a payment request through SilverPay Payments, show the correct asset/network and fee, sign through the supported wallet, confirm settlement, and provide a verifiable receipt. This journey is planned and is not demonstrated by the Phase 1 wallet transfer flow.
- **Exchange/swap journey:** clearly disclose custody and counterparty assumptions, show the actual supported pair and route, execute only through a functioning integration, and reconcile the result against authoritative transaction records.
- **Operator journey:** deploy and update nodes/services reproducibly, monitor health, respond to incidents, back up state, and verify recovery without silently rewriting canonical history.
- **Cross-chain journey:** distinguish source and destination networks, show each network's fee asset, verify both sides, and clearly disclose whether the flow is a native deployment, a wrapped asset, or a bridge transfer.

These journeys are aspirational acceptance targets until each is supported by reproducible tests and a documented operational process.

# 98. Roadmap Is Mutable; North-Star Scope Is Stable

The roadmap is a delivery instrument, not the definition of the project. It can change order, split work into smaller tasks, add security gates, replace dependencies, defer external services, or reprioritize releases. Such changes do not remove the whole-ecosystem destination defined in this whitepaper unless the project owner explicitly approves a scope change and records it in a future version.

Every roadmap item should identify:

1. the north-star component it advances;
2. dependencies and integration contracts;
3. implementation status (`not started`, `in progress`, `implemented`, `verified`, or `released`);
4. reproducible evidence, including relevant tests/builds and environment;
5. security, operational, legal, or licensing gates;
6. the next dependency-ordered task and its acceptance criteria.

Use **implemented** only when code exists; **verified** only when defined tests and checks pass; and **released** only when the artifact is intentionally published with release notes, compatibility information, and required security/operational approvals. A UI mock, placeholder, local demo, successful unit test, or one repository's green test suite does not establish end-to-end ecosystem completion.

## 98.1 SilverPay roadmap replacement (2026-10-22)

The separate Silver Wallet roadmap entry is retired. It is replaced by:

| Milestone | Scope | Dependency / completion gate |
|---|---|---|
| **SilverPay Wallet — Phase 1 (initial priority)** | Separate BTCS L1 UTXO and L2 EVM accounts; native/token/NFT balances; real sends/receives; history with pending/confirmed/failed/fee/receipt/error states; SilverForge and Silver Scan integration; safe local development signing; explicit unsupported/unavailable states; secret isolation | The required local journey passes against real services: create/deploy → see in SilverPay Wallet → see in Silver Scan → send A→B → receive → verify → restart → verify again. The NFT and separate L1/L2 identity journeys also pass. |
| **SilverPay Payments — Phase 2 (planned)** | Payment requests, QR-based payments, merchant checkout, invoices, transaction status, reconciliation, and settlement integration | Phase 1 is usable and the transaction, settlement, asset-accounting, and security requirements are demonstrated. A submitted transaction alone does not prove a completed payment. |

SilverPay must not depend on the existing BTCS Silver Wallet application. Compatible internal components may be reused after review. SilverForge and Silver Scan remain separate products. Withdrawals, payouts, and production financial features remain disabled until their own security gates are approved.

# 99. v1.6 Change Log

- Reframed the document as the whole-ecosystem north-star while preserving the detailed BTCS L2 technical specification and prior engineering snapshots.
- Added mining, mining pools, node operations, SilvEx exchange/swaps, SilverPay, Silver Scan, Silver Node, SilverForge, BSNA assets/NFTs, APIs/SDKs, applications, Bitcoin Silver Store, external-chain adapters, and ecosystem governance/security as explicit intended product areas.
- Defined end-to-end integration journeys and evidence standards for completion.
- Clarified that the roadmap may change without silently changing the whole-system goal; material scope changes require an explicit decision and versioned record.
- Kept product ambitions separate from implementation claims: each component and integration must be verified independently.
- **2026-10-22 SilverPay decision:** unified the separate Silver Wallet and SilverPay entries into one product: SilverPay Wallet (Phase 1, initial priority) and SilverPay Payments (Phase 2, planned). Removed the external Silver Wallet application as a required dependency. Added Section 98.1 and Section 100.

# 100. SilverPay Product Decision Record

**Decision:** SilverPay is the unified Silver Labs wallet-and-payments product. The separate Silver Wallet product is retired from the roadmap.

**Phase 1 — SilverPay Wallet (initial priority):**

- Clearly separate BTCS L1 UTXO accounts and BTCS L2 EVM accounts.
- Display native BTCS balances, supported token balances, and NFTs.
- Send and receive supported assets through real transaction workflows.
- Show transaction history, pending and confirmed status, fees, receipts, and errors.
- Connect with SilverForge asset creation and Silver Scan transaction inspection.
- Support safe local development accounts and signing flows.
- Protect seeds, private keys, and other secret material from the UI, logs, and public APIs.
- Make unsupported actions and unavailable services explicit.

**Phase 2 — SilverPay Payments (later milestone):**

- Payment requests, QR-based payments, merchant checkout, invoices, transaction status, reconciliation, and settlement integration may be added later.
- Phase 2 begins only after the underlying transaction, settlement, asset-accounting, and security requirements have been demonstrated.
- A payment is not complete merely because a transaction was submitted.

**Constraints:** No mandatory dependency on the existing BTCS Silver Wallet application. SilverForge and Silver Scan remain separate integrated products. Existing BTCS L1/L2 security restrictions remain in force; unsafe withdrawals and production financial features are not enabled to make the wallet appear complete. The detailed decision is in `docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

# 101. SilverForge Static Frontend Boundary — 2026-10-23

The standalone SilverForge Studio frontend is a browser-only engineering
prototype intended for static hosting. Its current external-chain adapters
target Ethereum and BNB Smart Chain EVM deployments and Solana classic SPL
tokens. These deployments use the selected external chain's wallet, RPC,
programs/contracts, fee asset, and explorer; they are not BTCS L2 deployments
and do not imply cross-network transfer or settlement.

**BTCS L2 remains under development and is disabled in the static frontend.**
No BTCS L2 wallet, fee, token-standard, RPC, or deployment integration is
implemented by that standalone frontend. The existing backend-dependent Studio
and asset-engine code in this repository is separate work and remains intact.
BSNA-F1 conformance and integration remain subject to the requirements in
Sections 90 and 94; a generic external-chain token is not thereby a BSNA asset.

The frontend requires wallet-authorized signing and does not collect seed
phrases or private keys. Solana metadata requires URLs hosted by the user on
public HTTPS storage; GitHub Pages, if later approved, serves static frontend
files only and is not a metadata service, RPC provider, or private backend.
Local tests and builds do not demonstrate live-chain operation or production
security. Pages publishing remains gated on explicit owner approval. No
v1.8.3 whitepaper was present in the inspected local checkout; this dated
boundary is recorded in the available v1.6 document without changing its
version label.
