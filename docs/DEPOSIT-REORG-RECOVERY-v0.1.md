# BTCS L2 — Deposit Reorg Recovery (v0.1)

Status: **PROTOTYPE — canonical re-derivation, adoption, and conservative
address-level spend evidence IMPLEMENTED and tested; cross-process coordination
PARTIAL**.
Task: `BTCS-L2-SECURITY-002` (see `docs/WORK-QUEUE.md`).
Source: `execution/evm/src/depositReorgRecovery.ts`,
`execution/evm/src/depositRecoveryGate.ts`,
enforcement: `execution/evm/src/blockProcessor.ts`,
tests: `execution/evm/tests/depositReorgRecovery.test.ts`.

This document specifies the canonical L2 re-derivation prototype and the
fail-closed recovery gate that follow `BTCS-L2-SECURITY-001`
(`docs/DEPOSIT-REORG-ACCOUNTING-v0.1.md`). SECURITY-001 detects and classifies an
L1 deposit reorg; SECURITY-002 answers the next question — can canonical L2 state
be correctly re-derived, and what happens when it cannot.

## 1. Scope and non-goals

In scope:

- Deterministic re-derivation of canonical L2 from a verified canonical view when
  one or more credited deposits cease to be canonical.
- A persisted, fail-closed gate that stops new canonical block production while a
  reorg is unresolved.
- Typed, tested failure modes for the cases where re-derivation cannot be proven.

Out of scope (not implemented here, do not assume):

- Proving that a fungible outflow was funded by one specific credit.
- Coordinating recovery across independent OS processes sharing one store.
- Any L1 write, broadcast, signature, or protocol/consensus change.
- A trustless L1 inclusion proof (verification still uses a trusted local Core
  RPC).

## 2. Why re-derivation is a new capability

The canonical L2 chain in this prototype is **not** derived from L1 data: it is
produced from caller-supplied L2 transactions
(`PersistentBlockProcessor.buildNextBlock`). A deposited credit is applied at
block start and committed into both the block `extraData` (deposit-prelude
commitment) and the state root. Therefore removing a stale credit changes the
committing block's header and every descendant header/state root; a stored block
cannot simply be re-executed with fewer deposits.

The prototype does **not** add a fork/truncate primitive to the store. Instead it
reproduces the chain in a fresh store using only existing, verified primitives:
`acceptBlock` to replay the untouched prefix, `buildNextBlock` to rebuild the
suffix. Both are subject to the same header, state-root, and execution validation
as the original chain, so the result is independently checkable.

## 3. Algorithm

`rederiveCanonicalL2AfterDepositInvalidation({ canonicalView, invalidatedDepositIds, outputDirectory })`:

1. Validate and de-duplicate the invalidated deposit IDs.
2. Use `collectCanonicalDepositCredits` (SECURITY-001) to find which requested
   IDs are actually credited on the canonical chain, and the earliest height that
   committed one. If none are credited, return `no-recovery-needed`.
3. Require a fresh `outputDirectory` (reject an existing path).
4. Open a new `PersistentBlockProcessor` there and replay canonical blocks
   `1 .. rederiveFromBlock-1` with `acceptBlock`.
5. For every height `rederiveFromBlock .. tip`, decode the stored block, drop the
   invalidated deposit operations, and rebuild with `buildNextBlock` using the
   original transactions and timestamp.
6. Re-replay the re-derived chain and assert no invalidated credit remains.

The report records the source tip, the re-derived tip, the first rebuilt height,
the dropped and ignored IDs, and per-block `previousHash`/`newHash` pairs.

### Determinism

Rebuilding uses the stored transactions in their original order and the stored
timestamps; base fee and all other header fields are recomputed by the normal
production path. Running re-derivation twice from the same view yields identical
tips and block hashes (covered by tests).

## 4. Cases and outcomes

| Situation | Outcome |
| --- | --- |
| Invalidated ID was never credited | `no-recovery-needed`; no store created |
| Credited, and no survivor depends on it | `re-derived`; credit and its balance removed |
| Credited, but a descendant spent/used it | `rebuild-failed` (fail closed) |
| Invalidated credit somehow survived | `residual-credit` (fail closed) |
| Output path already exists | `output-directory-not-usable` (fail closed) |

`rebuild-failed` / `residual-credit` / `output-directory-not-usable` are
`DepositReorgRecoveryError`s. On failure the partial output store is removed and
no replacement chain is fabricated.

## 5. Enforced, persisted gate

recoverDepositReorg({ processor, invalidatedDepositIds, outputDirectory })
is the operator entry point. It takes the source PersistentBlockProcessor rather
than a previously captured view. It runs under the same exclusive operation
queue as buildNextBlock and acceptBlock, captures the canonical view while
holding that queue, and, when a requested deposit is credited, writes the gate
before releasing it. An extension already in progress finishes first and is
included in the view; queued or later extensions wait and then observe the gate.
Re-derivation stays inside the queue, so it cannot race with an extension through
this processor instance. Independent processes sharing the directory are not
coordinated by this in-process lock and are outside the prototype's supported
operating model. On success the report is returned; on failure the source store
stays frozen.

The gate is enforced in both public canonical tip-advancing entry points of
`PersistentBlockProcessor`: `buildNextBlock` (including the RPC `btcs_dev_mine` →
`DevelopmentSequencer` path) and the `acceptBlock` block-import path. The private
`appendBlockUnlocked` primitive they share is reachable only through those gated
methods, so there is no ordinary way to extend a frozen store. While frozen,
either method throws `DepositRecoveryGateError`, and the freeze survives a
process reopen (the file is read on each call). An invalid or unreadable gate
marker also fails closed: the operation is refused rather than treated as open.

Enforcing the gate on `acceptBlock` does **not** block legitimate historical
replay or verification. Settlement batch verification, the E2E independent
replay, and this module's own re-derivation all import blocks into a separate,
freshly created store, which carries no gate marker and is therefore open. The
gate is a property of the source store being protected, not of the import
operation.

`recoverDepositReorg` adopts a successfully re-derived store automatically. It
copies the verified content-addressed records into the frozen source, then
atomically replaces `chain.json` as the canonical-tip commit point. Only after
that commit does it clear the recovery gate. A failure before the metadata
commit leaves the old tip frozen and the candidate directory available for a
retry; a failure after the rename reconciles the in-memory tip with disk while
leaving the gate engaged. The lower-level
`rederiveCanonicalL2AfterDepositInvalidation` remains a build-and-verify helper
and does not adopt its output.

## 6. What this proves / does not prove

Proves (by tests, no BTCS Core required):

- A reorged-out, unspent credit is removed from canonical L2, with recipient
  balance and committed-credit effects verified on a real chain store.
- Independent post-credit transactions survive re-derivation with their effects.
- Re-derivation is deterministic across repeated runs.
- A credit that a descendant depended on fails closed and cannot resume
  production (gate is persisted and enforced across reopen).
- Re-including the deposit on the re-derived chain credits it exactly once.
- Successful operator recovery installs the re-derived canonical tip in the
  running processor and removes the gate only after the metadata commit.
- An injected pre-commit failure leaves the old chain frozen and permits a safe
  retry using the retained candidate store.

Does **not** prove:

- Source-specific attribution among fungible native-asset credits. SECURITY-005
  traces address outflows, fees, and selfdestructs; an outflow is treated as
  potentially spent even when unrelated funds could have covered it.
- Cross-process safety for multiple writers sharing one chain directory.
- Any production bridge, vault, withdrawal, or proof security.

## 7. Follow-up

1. Coordinate the recovery gate and canonical writes across independent OS
   processes before sharing a chain directory.
2. Extend the gate to the settlement/production paths beyond block extension if a
   running settlement service is added.
3. Add a multi-implementation convergence test (whitepaper §49 acceptance).
