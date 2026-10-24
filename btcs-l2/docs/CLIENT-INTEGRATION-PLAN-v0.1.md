# BTCS L2 Client Integration Plan v0.1

**Task:** BTCS-L2-CLIENT-001\
**Status:** Draft for review\
**Scope:** Client-facing capabilities, user journeys, gap analysis, integration
roadmap, onboarding/communication, and one recommended next task.\
**Constraint:** Documentation and planning only. No source, test, contract,
settlement, or BTCS Core change is proposed or made here.

This plan is an *evidence-based inventory* of the repository at branch
`experimental/deposit-prelude-v1` (HEAD `5ad81d7`, tracked files clean). New,
untracked files at the time of writing are this plan, `docs/WORK-QUEUE.md`, and
`execution/evm/scripts/regtest-deposit-settlement-e2e.ts`. Every capability
claim below cites a repository file and line.

---

## 0. How this plan was produced

Evidence was collected by reading the checked-in specifications, TypeScript
sources, scripts, fixtures, and tests.

**Verification note: the verification suites were not run as part of this
documentation task.** `BTCS-L2-CLIENT-001` produced and reviewed documentation
only. It did not execute `npm run typecheck`, `npm test`, or the legacy
`python3 -m unittest tests.test_v09_protocol` suite, and it made no source-code
change that could affect test outcomes.

`package.json` requires Node `>=24.17.0 <25`
(`execution/evm/package.json:6-8`); this pin is a documented onboarding
requirement (see §5), not a claim that any suite was executed during this task.

The settlement and deposit end-to-end scripts additionally require a running
BTCS Core regtest node and CLI at
`~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli`
(`execution/evm/scripts/regtest-deposit-settlement-e2e.ts:38-46`). That CLI
exists in this environment, but this plan does not run those scripts.

---

## 1. Client-facing capabilities that exist today

### 1.1 Execution engine (EVM) — IMPLEMENTED, local only

- A persistent EVM block processor with a fixed local profile
  `btcs-l2-local-v0.12-deposit-prelude`, store schema `2`, protocol version
  `0.12-draft.1`, EVM chain ID `31337`, EthereumJS `10.1.3`, Osaka hardfork
  (`execution/evm/src/blockProcessor.ts:42-50`, `execution/evm/src/config.ts:4-6`).
- Blocks are built with EthereumJS `buildBlock`, verified by a fresh `runBlock`
  replay, and stored as content-addressed RLP block records with receipt and
  execution sidecars; `chain.json` is the atomic canonical-tip pointer
  (`execution/evm/README.md:29-74`,
  `docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md:145-226`).
- Only signed EIP-1559 **type-2** transactions are admitted
  (`docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md:91-95`,
  `docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:8-17`).
- Genesis allocates `10,000` units (18 decimals) to one public test key
  (`0x11` repeated); this is test data, never real assets
  (`execution/evm/src/config.ts:6-10`, `execution/evm/README.md:133-134`).
- Durable state checkpoints and checkpoint-verified replay exist
  (`execution/evm/src/stateCheckpoint.ts`,
  `execution/evm/src/stateCheckpointRecovery.ts`,
  `execution/evm/src/stateCheckpointVerifier.ts`).

### 1.2 Local JSON-RPC — PARTIAL (read-only + opt-in dev submission)

Specified in `docs/BTCS-L2-RPC-v0.12-DRAFT.md`; implemented in
`execution/evm/src/rpc.ts` with the CLI in `execution/evm/src/rpcServer.ts`.

Implemented methods (`execution/evm/src/rpc.ts:672-772`):
`web3_clientVersion`, `eth_chainId`, `eth_blockNumber`,
`eth_getBlockByNumber`, `eth_getBlockByHash`, `eth_getTransactionReceipt`,
`eth_getCode`, `eth_getStorageAt`, `eth_getBalance`,
`eth_getTransactionCount`, `eth_getLogs`, and — only with
`--dev-sequencer` — `eth_sendRawTransaction` and `btcs_dev_mine`.

Hard client-facing properties:
- Listener binds **only** to IPv4 `127.0.0.1`; no host override, no CORS, POST
  `/` only (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:45-66`,
  `execution/evm/src/rpcServer.ts:5-44`).
- Reads re-verify canonical history from genesis per request; at most four
  concurrent requests; no cross-request cache
  (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:30-43`).
- Explicitly **not** implemented: `eth_call`, `eth_estimateGas`, transaction
  lookup by hash, filters/subscriptions, fee history, automatic mining, wallet
  methods, `net_*`, `personal_*`, admin methods
  (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:188-196`).

### 1.3 Development sequencer / transaction pool — PARTIAL (opt-in, in-memory)

- With `--dev-sequencer`, an in-memory pool admits signed type-2 transactions
  and only explicit `btcs_dev_mine` produces one block; nothing is automatic or
  broadcast (`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:1-17,78-116`).
- Deterministic selection: senders visited in lexicographic address order,
  round-robin, no fee priority; conservative gas-sum fitting
  (`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:78-95`).
- Pending transactions live only in process memory and are lost on restart; no
  eviction beyond rejection (`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:62-76`).
- The pool caps are documented (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:148-151`).

### 1.4 BTCS L1 deposits (into L2) — PARTIAL (prototype, operator-driven)

- A canonical L1 deposit **intent** is an OP_RETURN output carrying marker
  `BTCSL2D` + version + 20-byte EVM recipient
  (`execution/evm/src/btcsL1Deposit.ts:4-11,70-107`).
- Deposit **verification** is read-only against a *trusted* BTCS Core RPC and
  requires exactly one canonical intent plus exactly one positive-value payment
  to a configured deposit script, with a confirmation count
  (`execution/evm/src/btcsL1Deposit.ts:140-277`).
- Verified deposits are persisted durably with atomic writes and a
  confirmed/invalidated lifecycle (`execution/evm/src/btcsL1DepositStore.ts`),
  and the workflow is idempotent across concurrent callers
  (`execution/evm/src/btcsL1DepositWorkflow.ts:20-45`).
- A confirmed record becomes a canonical L2 deposit **operation** with exact
  satoshi→wei conversion (`execution/evm/src/depositPrelude.ts:5-73`).
- Deposit operations are committed into the block header `extraData` as a
  32-byte SHA-256 commitment and are **credited** to the recipient EVM balance
  on execution (`execution/evm/src/depositPrelude.ts:206-258`,
  `execution/evm/src/blockProcessor.ts:493-511`), with a per-block cap of 256
  (`execution/evm/src/depositPrelude.ts:7`).
- An end-to-end regtest demo exercises real L1 broadcast → verification →
  durable record → L2 credit → settlement replay
  (`execution/evm/scripts/regtest-deposit-settlement-e2e.ts:164-553`).

### 1.5 Settlement / anchoring — PARTIAL (prototype, trusted-RPC confirmation)

- An EVM settlement envelope (`btcs-l2-evm-settlement` `v2`) commits to block
  RLP, header roots, deposit operations, and a chained previous commitment
  (`execution/evm/src/settlementEnvelope.ts:16-149`).
- Batches (`btcs-l2-evm-settlement-batch` `v2`) chain envelopes by parent hash
  and commitment (`execution/evm/src/settlementBatch.ts:8-156`).
- Independent **execution replay** from genesis and checkpoint continuation are
  implemented and tested (`execution/evm/src/settlementBatchReplay.ts:41-214`).
- Anchor payload/script preparation (`BTCSL2` OP_RETURN magic) is implemented
  (`execution/evm/src/btcsL1Anchor.ts:3-88`,
  `execution/evm/src/btcsL1AnchorPreparation.ts:35-114`).
- A durable publication store tracks `prepared → submitted → observed →
  confirmed → invalidated` with reorg invalidation and re-observation
  (`execution/evm/src/btcsL1Publication.ts:12-241`,
  `execution/evm/src/btcsL1PublicationStore.ts`,
  `execution/evm/src/btcsL1PublicationWorkflow.ts`).
- L1 anchor confirmation uses the **trusted** BTCS Core RPC
  (`execution/evm/src/btcsL1Confirmation.ts:38-144`,
  `execution/evm/src/btcsL1CoreRpc.ts:16-129`).
- A regtest anchor E2E script exists, including an opt-in reorg recovery path
  (`execution/evm/scripts/regtest-anchor-e2e.ts`).
- Portable batch files can be exported/imported and verified
  (`execution/evm/src/settlementBatchFile.ts`,
  `execution/evm/scripts/verify-settlement-batch.ts`,
  `execution/evm/scripts/verify-settlement-batch-execution.ts`).

### 1.6 Smart-contract support — PARTIAL (execution works; tooling absent)

- Arbitrary EVM bytecode executes (Osaka). The only sample is `Counter`
  (`execution/evm/contracts/Counter.sol`), compiled by a pinned `solc 0.8.37` in memory
  (`execution/evm/src/compile.ts:28-59`) and exercised by a local demo
  (`execution/evm/src/counter.ts`, `execution/evm/src/demo.ts`).
- Receipts, logs, storage, code, and balances are readable via the RPC
  (`execution/evm/src/rpc.ts:700-751`).
- No `eth_call`/`eth_estimateGas`, no node (`eth_getTransactionByHash`), no ABI
  artifact publishing, and no Hardhat/Foundry integration.

### 1.7 Legacy transfer path (non-EVM) — IMPLEMENTED, separate, not connected

- A Python sequencer orders `BTCSL2TX|v0.7` text transfers
  (`sequencer/sequencer.py`, `sequencer/build_ordered_batch.py`).
- A v0.9 text settlement protocol and recovery verifiers are implemented and
  tested (`settlement/v09/v09_protocol.py`,
  `settlement/v09/verify_clean_recovery.py`, `tests/test_v09_protocol.py`).
- This path is **not** connected to the EVM engine, deposit prelude, or the EVM
  settlement v2 format; its accounts are `alice`/`bob`/`carol`, not EVM
  addresses (`docs/SETTLEMENT-v0.9-DRAFT.md:47-57`).

### 1.8 Wallet / account tooling — MISSING

> **Product decision update, 2026-10-22:** SilverPay is the unified Silver
> Labs wallet-and-payments product. SilverPay Wallet is Phase 1 and the initial
> priority; SilverPay Payments is a later milestone. The separate Silver Wallet
> product is retired from the roadmap, and the empty sibling
> `~/Silver-Labs/silver-wallet` repository is **not** a required dependency.
> See `docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md`.

- No EIP-1193/EIP-6963 provider, no injected provider, no key management, no
  browser wallet, no `eth_accounts`/`eth_sign`, no chain-add metadata, and no
  SilverPay wallet integration. The sibling repository
  `~/Silver-Labs/silver-wallet` is empty and is not referenced by this project.
- No user identity exists on L2 beyond a raw EVM address; the only funded key is
  the documented test key (`execution/evm/src/config.ts:6-8`).

---

## 2. User journeys

Each journey states the path that exists **today**, where it breaks, and the
target experience. Journeys are written for a wallet/application developer, not
for the protocol engineer.

**Concrete reproducible path.** `cd execution/evm && npm run demo:client`
([`execution/evm/scripts/demo-client.ts`](../execution/evm/scripts/demo-client.ts),
documented in [`execution/evm/README.md`](../execution/evm/README.md)) runs the
read, transfer, contract, and reverted-call parts of these journeys end to end
on one local chain and prints a single JSON summary. It does not cover deposits
(2.2) or withdrawals (2.5), which need an L1 node and remain unimplemented.

### 2.1 Wallet connection

**Today.** A wallet can be manually configured against
`http://127.0.0.1:8545` and can call the read methods for chain ID, balances,
nonces, code, storage, blocks, receipts, and logs
(`execution/evm/src/rpc.ts:672-751`). It can submit a pre-signed type-2
transaction only if the operator restarted the server with `--dev-sequencer`,
and even then nothing is included until `btcs_dev_mine` is called
(`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:96-116`).

**Where it breaks.**
- Wallets commonly call `eth_call`, `eth_estimateGas`,
  `eth_getTransactionByHash`, `eth_feeHistory`, `eth_getBlockByNumber(pending)`,
  `net_version`, and chain-add handshakes; the first five are absent and
  `pending` is explicitly rejected (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:112,188-196`).
- Chain ID `31337` collides with the common Hardhat/development default, so a
  wallet may silently reuse a different local chain.
- No remote access, CORS, or TLS means a browser dApp cannot reach the node
  except through a local proxy.
- No account faucet or funded wallet key that is safe to expose in a UI.

**Target experience.** Add a local chain descriptor, an EIP-1193-compatible
transport (or a documented local proxy), and the minimal missing read methods so
an unmodified EVM wallet can connect, display balances, estimate gas, and send a
transfer.

### 2.2 BTCS deposits (L1 → L2)

**Today (operator-driven, trusted).**
1. Build an L1 transaction with one OP_RETURN intent `BTCSL2D..` naming the L2
   recipient and one payment output to the configured deposit script
   (`execution/evm/src/btcsL1Deposit.ts:70-107`).
2. Confirm it with the required number of L1 confirmations.
3. Verify and durably record it using the trusted BTCS Core RPC
   (`execution/evm/src/btcsL1DepositWorkflow.ts:20-45`).
4. Convert the record to a deposit operation, include it in the next L2 block,
   and let execution credit the recipient
   (`execution/evm/src/blockProcessor.ts:493-511`,
   `execution/evm/scripts/regtest-deposit-settlement-e2e.ts:366-443`).

**Where it breaks.**
- Verification trusts the local Core RPC for the header and active chain. A
  local header/PoW and partial Merkle-proof verifier
  (`execution/evm/src/l1HeaderVerifier.ts`) is now integrated into deposit and
  confirmation when the RPC exposes `gettxoutproof`, but it does not select the
  most-work chain or establish finality
  (`execution/evm/src/btcsL1Deposit.ts`, `btcsL1Confirmation.ts`).
- No escrow: the L1 funds are not provably locked, so a reorg or double-spend
  policy is unresolved. The code explicitly warns that a registry entry alone is
  not a safe bridge (`execution/evm/src/btcsL1DepositWorkflow.ts:15-19`).
- There is no client API/UX; it requires running scripts and a local Core node.
- "Reorg after L2 spend" recovery is not implemented
  (`execution/evm/scripts/regtest-deposit-settlement-e2e.ts:547-552`).

**Target experience.** A deposit button that emits the canonical intent, a
background watcher that verifies inclusion with a documented trust model, and a
clear risk disclosure until escrow and proofs exist.

### 2.3 L2 transfers

**Today.** A caller signs an EIP-1559 type-2 transaction offline and posts it
with `eth_sendRawTransaction`; the pool validates chain ID, signature, nonce
contiguity, upfront cost, and the next-block base fee
(`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:25-49`). An operator calls
`btcs_dev_mine`; included transfers produce standard receipts, and balances and
nonces update
(`execution/evm/tests/rpc.test.ts`, `execution/evm/tests/transactionPool.test.ts`).

**Where it breaks.**
- No automatic block production, so a transfer stays pending indefinitely
  unless an operator mines (`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:96-102`).
- No client-side fee estimation (`eth_estimateGas`/`eth_feeHistory` absent); the
  next base fee is computed by the pool, not exposed to callers.
- Pending state is lost on restart; no `eth_getTransactionByHash` to poll.
- `pending` block tag is rejected (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:112`).

**Target experience.** A wallet sends a transfer, sees a pending state, and an
L2 block is produced (automatically by a sequencer or by a documented local
cadence), with fee estimation and transaction lookup available.

### 2.4 Smart-contract applications

**Today.** Contracts deploy and execute; `Counter` demonstrates deploy,
successful call, and a reverted call that keeps nonce/gas effects but rolls back
storage and logs (`execution/evm/src/counter.ts`, `execution/evm/tests/rpc.test.ts`).
State, code, receipts, and logs are queryable by height
(`execution/evm/src/rpc.ts:700-751`).

**Where it breaks.**
- No `eth_call` or `eth_estimateGas`, so front-ends cannot read contract results
  or discover revert reasons without submitting a transaction
  (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:188-196,219-224`).
- No `eth_getTransactionByHash`; no log subscriptions/filters (only bounded
  `eth_getLogs`).
- No developer toolchain: no Hardhat/Foundry network config, no deployment
  framework, no ABI/artifact serving, no contract verification.
- Only type-2 transactions; no EIP-1559 `priorityFee` guidance and no
  account-abstraction/type-4 support
  (`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:141-147`).

**Target experience.** Point Hardhat/Foundry at the local node, deploy with a
standard script, call read methods via `eth_call`, and estimate gas before
sending.

### 2.5 Withdrawals (L2 → L1)

**Today.** None. Withdrawals are explicitly deferred
(`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:141-147`,
`docs/BTCS-L2-RPC-v0.12-DRAFT.md:219-224`) and are listed as a non-goal of the
deposit E2E (`execution/evm/scripts/regtest-deposit-settlement-e2e.ts:551`).
The settlement model requires an independent data-availability and proof design
before exits are meaningful (`docs/SETTLEMENT.md:156-184`).

**Where it breaks.** There is no escrow, no exit queue, no burn/proof message,
no L1 release transaction, and no finalized-head notion on L2 (the RPC rejects
`finalized`/`safe`, `docs/BTCS-L2-RPC-v0.12-DRAFT.md:112`).

**Target experience.** An optimistic or validity exit with a documented
challenge window, backed by published L2 data and an L1-anchored state root.

---

## 3. Status matrix

| Capability | Status | Primary evidence |
|---|---|---|
| Local EVM execution + persistent chain | IMPLEMENTED | `src/blockProcessor.ts`, `README.md:29-74` |
| Deterministic roots/receipts/replay | IMPLEMENTED | `src/blockProcessor.ts`, protocol doc §4-6 |
| Local read-only JSON-RPC | IMPLEMENTED (local only) | `src/rpc.ts:672-751`, RPC doc §Methods |
| Opt-in dev sequencer + in-memory pool | IMPLEMENTED (prototype) | `src/transactionPool.ts`, pool doc |
| `eth_call` / `eth_estimateGas` | MISSING | RPC doc `:188-196` |
| Tx lookup by hash, filters/subscriptions, fee history | MISSING | RPC doc `:188-196` |
| Type-2 signed tx send + explicit mining | IMPLEMENTED (opt-in) | `src/rpc.ts:755-772` |
| Automatic block production | MISSING | pool doc `:96-102` |
| BTCS L1 deposit intent + verification | PARTIAL (trusted RPC) | `src/btcsL1Deposit.ts` |
| Durable deposit registry + reorg invalidation | IMPLEMENTED (prototype) | `src/btcsL1DepositStore.ts` |
| Deposit commitment in block `extraData` + balance credit | IMPLEMENTED (prototype) | `src/depositPrelude.ts`, `src/blockProcessor.ts:493-511` |
| Trustless deposit inclusion proof / escrow | MISSING | `src/btcsL1Deposit.ts:140-148` |
| EVM settlement envelope/batch v2 + independent replay | IMPLEMENTED (prototype) | `src/settlementEnvelope.ts`, `src/settlementBatchReplay.ts` |
| Checkpoint-based replay | IMPLEMENTED (prototype) | `src/settlementBatchReplay.ts:122-214` |
| L1 anchor prepare/sign/broadcast/observe/confirm lifecycle | PARTIAL (trusted RPC) | `src/btcsL1Publication*.ts`, `scripts/regtest-anchor-e2e.ts` |
| Portable batch file verify CLI | IMPLEMENTED | `src/settlementBatchFile.ts`, `scripts/verify-settlement-batch*.ts` |
| Smart contracts (arbitrary EVM) | PARTIAL (no tooling) | `contracts/Counter.sol`, `src/compile.ts` |
| Wallet / EIP-1193 / key management | MISSING | no provider/source files exist; SilverPay Wallet is the owned Phase 1 target |
| Public RPC, auth, rate limiting, remote access | MISSING | RPC doc `:45-66,219-224` |
| Withdrawals / exit / bridge | MISSING | pool doc `:141-147` |
| Data availability design | MISSING | `docs/SETTLEMENT.md:156-170` |
| Fraud/validity/ZK proofs | MISSING | `docs/SETTLEMENT.md:172-184` |
| Decentralized sequencing / P2P / consensus | MISSING | protocol doc §7, `SETTLEMENT.md:103-117` |
| Legacy text transfer + v0.9 settlement | IMPLEMENTED (separate path) | `sequencer/`, `settlement/v09/` |

Legend: **IMPLEMENTED** = working and tested in this repo; **PARTIAL** = works
with stated prototype limits; **MISSING** = not present; **PLANNED** = proposed
in §4 and not present in the repository today. Every `MISSING` client
capability above has a corresponding `PLANNED` item in §4; nothing in §4 is
committed or implemented.

---

## 4. Integration roadmap

Phases are ordered by client value. Each phase lists an exit criterion that can
be checked in this repository. No phase is committed work; this is a proposal.

### Phase 0 — Reproducible local sandbox (days)

Goal: any developer can start the L2 and read data with the pinned runtime.

- Document the Node pin (`>=24.17.0 <25`) and the `npm ci` step in the quickstart
  (`execution/evm/package.json:6-8`, `execution/evm/README.md:15-27`).
- Add a single `npm run rpc -- --datadir <fresh-dir>` walkthrough and a note that
  a fresh datadir initializes the fixed local genesis
  (`execution/evm/src/rpcServer.ts:40-53`).
- Publish the exact curl examples already in the README
  (`execution/evm/README.md:95-129`).
- Exit criterion: a new contributor with Node 24 runs `npm ci && npm run
  typecheck && npm test` and `npm run rpc` on a fresh directory, and gets a
  valid `eth_chainId` response.

### Phase 1 — SilverPay Wallet-grade read RPC (weeks)

Goal: an unmodified EVM wallet or a thin client can display and prepare actions.
This eventually feeds SilverPay Wallet Phase 1; it does not by itself prove the
wallet journey or enable payments.

Proposed additive methods (read-only, no protocol change):
- `eth_call` with a documented non-committing execution context and a
  block-reference policy (the RPC draft already flags this as the next design
  item, `docs/BTCS-L2-RPC-v0.12-DRAFT.md:219-224`).
- `eth_estimateGas`.
- `eth_getTransactionByHash` (to replace receipt-only polling).
- `eth_feeHistory` and a way to surface the next base fee computed by the
  processor.
- `net_version` and a minimal `eth_accounts`-style discovery response, or a
  documented wallet configuration package.
- A stable local chain descriptor (chain name, ID, RPC URL, currency, explorer
  placeholder) so wallets do not confuse `31337` with another dev chain.

Exit criterion: a public reference script connects, calls `eth_chainId`,
`eth_call`, and `eth_estimateGas`, and submits a signed transfer that is
confirmed after an explicit or automatic block, with tests covering each new
method.

### Phase 2 — Developer tooling (weeks)

Goal: contract developers need no bespoke wiring.

- Hardhat and/or Foundry network configuration pointing at the local node.
- A deploy/verify script template using the pinned `solc`
  (`execution/evm/src/compile.ts`).
- Serve ABIs from a documented path; remove the "local and ignored" ambiguity
  (`execution/evm/README.md:12`).
- A one-command start that boots the node and a funded local account
  (currently only the public test key is funded, `execution/evm/src/config.ts:6-8`).
- Exit criterion: `npx hardhat run scripts/deploy.ts --network btcsL2Local`
  deploys a contract and reads it back via `eth_call`.

### Phase 3 — First usable demonstration (the milestone)

Goal: a single artifact a wallet/app developer or community member can run to
see the whole loop.

- One command (proposed `npm run demo:client`) that, from a fresh datadir and
  **no BTCS Core node**, starts the node, deploys a contract, performs a
  transfer, calls a method, mines explicitly, reads receipts/logs, and
  independently verifies a settlement batch using the existing replay verifier
  (`execution/evm/src/settlementBatchReplay.ts:41-111`).
- A second, clearly separated **L1-anchored** variant that documents its
  BTCS Core regtest dependency (`scripts/regtest-anchor-e2e.ts`,
  `scripts/regtest-deposit-settlement-e2e.ts`).
- A short "what this proves / what it does not prove" block in the output,
  modeled on the existing limitation list
  (`execution/evm/scripts/regtest-deposit-settlement-e2e.ts:547-552`).
- Exit criterion: see §6.

### Phase 4 — Bridge hardening (research)

Goal: move deposits and withdrawals from "trusted prototype" toward a defensible
trust model.

- Define the L1 trust model: escrow or SPV-style inclusion, confirmation
  policy, and reorg-after-L2-spend recovery
  (`execution/evm/src/btcsL1Deposit.ts:140-148`).
- Design data availability for L2 transaction data
  (`docs/SETTLEMENT.md:156-170`).
- Design an exit path and challenge/finality rules; then a proof choice
  (`docs/SETTLEMENT.md:172-184`).
- Exit criterion: a published design doc reviewed before any source work.

### Cross-cutting: RPC transport and operations (later)

Remote access, TLS, authentication, rate limiting, durability of the pending
pool, and a work budget per request remain out of scope until a trust boundary
is defined (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:39-43,219-224`).

---

## 5. Developer onboarding and community communication

### 5.1 Onboarding checklist (proposed text for a root README)

1. Install Node `>=24.17.0 <25` (the repository does not bundle a runtime).
2. `cd execution/evm && npm ci`.
3. `npm run typecheck && npm test` — expect 176 passing tests.
4. `npm run rpc -- --datadir /tmp/btcs-l2-local --port 8545`.
5. Query it with the curl example in `execution/evm/README.md:95-101`.
6. Optional: run `npm run demo` for the in-process `Counter` prototype.
7. Optional, advanced: run the regtest scripts against a local BTCS Core node at
   `~/Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli`.
8. Note there is **no root LICENSE** and the sample contract is `UNLICENSED`;
   licensing is unresolved (`execution/evm/README.md:143-147`).

### 5.2 Honest description of limitations (use verbatim in community posts)

- This is a **local prototype**, not a network. There is no consensus,
  fork choice, peer-to-peer networking, or decentralized sequencing
  (`docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md:7-26,61-66`).
- The RPC binds only to `127.0.0.1`, has no auth, CORS, or rate limiting, and
  must not be exposed (`docs/BTCS-L2-RPC-v0.12-DRAFT.md:39-66`).
- Blocks are produced only by an explicit `btcs_dev_mine`; pending transactions
  are in memory and lost on restart
  (`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:62-76,96-102`).
- Only type-2 transactions are supported; the EVM chain ID `31337` is
  development-only (`docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md:91-95`).
- Deposit verification trusts the local BTCS Core RPC for the header and active
  chain; there is no canonical/trustless inclusion proof, escrow,
  fraud/validity proof, or data availability. A local header/PoW and partial
  Merkle-proof verifier is integrated when `gettxoutproof` is available, but it
  does not establish canonical-chain selection or finality
  (`execution/evm/src/btcsL1Deposit.ts`, `btcsL1Confirmation.ts`,
  `docs/SETTLEMENT.md:156-184`).
- **Withdrawals do not exist.** L2 assets cannot currently exit to L1
  (`docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md:141-147`).
- Anchoring publishes a commitment via OP_RETURN; publication alone is not
  validity or finality (`docs/SETTLEMENT.md:66-99`).
- Inherited Osaka/Mainnet parameters and the funded test key are provisional
  test data, not economic policy; never send real value
  (`docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md:261-298`,
  `execution/evm/README.md:133-134`).
- A settlement batch is only as trustworthy as its caller-supplied anchors;
  verification does not prove L1 publication or finality
  (`execution/evm/src/settlementBatchReplay.ts:36-45`).

### 5.3 Communication guidelines

- Describe the project as "a local BTCS L2 research prototype," never as a
  production rollup or an Ethereum-compatible network.
- Always pair a capability claim with its trust assumption (trusted Core RPC,
  single writer, no DA, no proofs).
- Prefer reproducible commands and exact hashes over screenshots.
- Keep the WORK-QUEUE status vocabulary (IMPLEMENTED / PARTIAL / PLANNED /
  MISSING) in outward-facing summaries.

---

## 6. Recommended next task (exactly one)

**Task ID:** BTCS-L2-CLIENT-002\
**Title:** Ship a one-command local client demonstration (`npm run demo:client`)\
**Rationale:** This is the highest-leverage client-facing artifact that needs no
new protocol semantics and no BTCS Core node. It converts the existing, tested
building blocks (`counter.ts`, the RPC, the dev sequencer, and the independent
settlement replay verifier) into something a wallet developer or community
member can actually run and evaluate, while surfacing the exact gaps (no
`eth_call`, no auto-mining, no withdrawal) in one honest output.

**Deliverable:** a documented script/command plus a smoke test, saved in the
repository. No change to protocol rules, settlement logic, or BTCS Core.

**Worded scope**

1. Add an npm script `demo:client` in `execution/evm/package.json` that:
   - creates a fresh temporary datadir and starts the local chain,
   - deploys `Counter`, increments it, and performs a signed type-2 transfer,
   - mines explicitly, then reads back code, storage, balances, receipts, and
     logs through the RPC,
   - builds a genesis-starting settlement batch and verifies it with
     `verifyEvmSettlementBatchExecution`,
   - prints a single machine-readable JSON summary and then exits nonzero on any
     failed assertion.
2. Add a smoke test under `execution/evm/tests/` that runs the script's core
   functions and asserts the summary shape.
3. Document the command in `execution/evm/README.md` and link it from
   `docs/CLIENT-INTEGRATION-PLAN-v0.1.md` §2 (journeys) as the concrete
   reproducible path.

**Measurable acceptance criteria**

- `cd execution/evm && npm run demo:client` exits `0` on a fresh datadir with
  only the pinned Node runtime present; it does **not** require BTCS Core.
- The JSON summary contains exactly one of each: `chainId` equal to `31337`, a
  `deployTx` hash and `contractAddress`, an `incrementTx` hash with
  `status: 1`, a `revertedTx` hash with `status: 0`, a `transferTx` hash, the
  final `blockNumber`, and a `settlement.batchHash`.
- `settlement.executionVerified === true` and the batch hash equals the value
  produced by `npm run verify:batch:execution` for the emitted batch file.
- The reverted transaction shows rolled-back storage/logs while its nonce and
  gas effects remain (matching `execution/evm/tests/rpc.test.ts` behavior).
- `npm run typecheck` passes and `npm test` passes with the pre-existing tests
  unchanged and the new smoke test present (>= 177 tests).
- The README quickstart and the plan's journey section both reference the
  command; the output includes the "what this proves / does not prove" block.
- `git diff --stat` shows changes only in `execution/evm/package.json`, the new
  script, the new smoke test, and documentation; no protocol, settlement, or
  BTCS Core file is modified.

**Explicit non-goals:** `eth_call`/`eth_estimateGas`, automatic mining,
withdrawals, remote RPC, or any L1 trust-model change. Those remain Phase 1 and
Phase 4.

---

## Appendix A — Key file map

| Area | Path |
|---|---|
| Block protocol spec | `docs/BTCS-L2-BLOCK-PROTOCOL-v0.11-DRAFT.md` |
| RPC spec | `docs/BTCS-L2-RPC-v0.12-DRAFT.md` |
| Transaction pool spec | `docs/BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md` |
| Settlement concept | `docs/SETTLEMENT.md` |
| v0.9 encoding draft | `docs/SETTLEMENT-v0.9-DRAFT.md` |
| EVM harness README | `execution/evm/README.md` |
| Block processor | `execution/evm/src/blockProcessor.ts` |
| RPC | `execution/evm/src/rpc.ts`, `execution/evm/src/rpcServer.ts` |
| Pool | `execution/evm/src/transactionPool.ts` |
| Deposit verification | `execution/evm/src/btcsL1Deposit.ts` |
| Deposit registry | `execution/evm/src/btcsL1DepositStore.ts` |
| Deposit prelude/credit | `execution/evm/src/depositPrelude.ts` |
| Settlement | `execution/evm/src/settlementEnvelope.ts`, `settlementBatch.ts`, `settlementBatchReplay.ts` |
| Anchor/publication | `execution/evm/src/btcsL1Anchor*.ts`, `btcsL1Publication*.ts` |
| E2E scripts | `execution/evm/scripts/*.ts` |
| Sample contract | `execution/evm/contracts/Counter.sol` |
| Legacy transfer path | `sequencer/`, `settlement/v09/`, `tests/test_v09_protocol.py` |

## Appendix B — Known blockers to client adoption

1. **Node runtime pin** (`>=24.17.0 <25`) is stricter than many environments;
   the default `node` here is `v18.19.1`. A bootstrap note or version manager
   file would help.
2. **No root README / no license.** Licensing and redistribution are unresolved
   (`execution/evm/README.md:143-147`); this blocks public distribution.
3. **No wallet or provider.** Nothing to point a real wallet at beyond raw RPC.
4. **Missing read methods** (`eth_call`, `eth_estimateGas`,
   `eth_getTransactionByHash`, fee history) block unmodified wallets and
   contract front-ends.
5. **No automatic block production**, so user transactions appear to hang.
6. **Trusted-Core-RPC deposits** and **no withdrawals** block any real-value or
   bridge use case.
7. **No data availability or proof design**, so settlement is a publication
   anchor, not a verifiable rollup.
