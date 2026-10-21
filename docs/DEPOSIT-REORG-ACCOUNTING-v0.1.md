# BTCS L2 — Deposit Reorg Accounting (v0.1)

Status: **PROTOTYPE — accounting module IMPLEMENTED and tested; full recovery PARTIAL**.
Task: `BTCS-L2-SECURITY-001` (see `docs/WORK-QUEUE.md`).
Source: `execution/evm/src/depositReorgAccounting.ts`,
tests: `execution/evm/tests/depositReorgAccounting.test.ts`.

This document specifies the bridge accounting invariant and the reorg
classification for a BTCS L1 deposit whose L2 credit may already have been
committed or spent. It is a protocol-safety deliverable, not a cosmetic
cleanup: the whitepaper v1.2 "Engineering priority" section names
`BTCS-L2-SECURITY-001` a **protocol safety blocker**, and §2.7 ("Security before
claims") plus §25/§28/§50 require a documented invariant and tested handling for
each reorg timing.

## 1. Scope and non-goals

In scope:

- A deterministic accounting invariant over confirmed L1 deposit records and
  canonical L2 deposit credits.
- A deterministic remediation plan for each timing of an L1 reorg relative to
  verification, L2 credit, and L2 spend.
- A sound, partial local signal for whether a credit has been spent.

Out of scope (not implemented here, do not assume):

- Actually re-deriving the canonical L2 history without the removed credit.
- Attributing arbitrary EVM spends to a specific credit (needs transaction-level
  tracing).
- Withdrawals, escrow, forced inclusion, data availability, or any proof system.
- A trustless L1 inclusion proof. Verification still uses a trusted local Core
  RPC (`src/btcsL1Deposit.ts`).

## 2. Definitions

- **Secured**: the sum of `amountSats` of L1 deposit records whose store state is
  `confirmed`. One satoshi is represented on L2 as `10^10` wei (see
  `SATOSHI_TO_WEI` in `src/depositPrelude.ts`).
- **Credited (redeemable)**: the sum of `amountWei` of canonical L2 deposit
  credits, i.e. `EvmDepositOperation`s committed by canonical blocks and
  exposed through `CanonicalReadView.getCanonicalDepositOperations`.
- **Backed credit**: a credit whose `depositId` has a `confirmed` L1 record with
  the same `sourceBlockHash` and an exactly matching satoshi amount.
- **Unbacked credit**: a canonical L2 credit with no matching confirmed L1
  inclusion (invalidated, missing, or a changed inclusion hash).

## 3. Invariant (whitepaper §7.4, §28)

```text
creditedWei <= securedWei
```

The prototype uses the conservative reading of §28 "secured BTCS vault value +
valid protocol accounting" with **no** additional protocol accounting yet, so
`securedWei` is exactly the confirmed L1 deposit backing. The invariant is
checked by `calculateDepositAccounting`. Violations are expected protocol
states and are **reported**, not thrown:

| Violation kind    | Condition                                                    |
| ----------------- | ------------------------------------------------------------ |
| `unbacked-credit` | credit has no confirmed L1 record with the same inclusion     |
| `amount-mismatch` | confirmed record exists but its satoshi backing differs       |
| `duplicate-credit`| the same `depositId` is credited more than once               |
| `over-credit`     | total credited exceeds total secured                          |

When `invariantHolds` is false the report sets `progressBlocked: true`. Callers
must halt new security-sensitive bridge progression until reconciled.

## 4. Required reorg cases (whitepaper §2.5, §25, §50)

`classifyDepositReorg` maps each case to a plan:

| Case | L1 state | L2 credit | spent | timing | action |
| --- | --- | --- | --- | --- | --- |
| reorg-before-credit | invalidated/absent | none | – | `reorg-before-credit` | `invalidate-l1-only` |
| after-credit-before-spend | invalidated/absent | present | no | `after-credit-before-spend` | `revert-l2-credit` |
| after-spend | invalidated/absent | present | yes | `after-spend` | `freeze-bridge` |
| re-inclusion (same inclusion) | confirmed, same hash | present | – | `re-inclusion` | `no-op` |
| re-inclusion (changed inclusion) | confirmed, new hash | present | no | `re-inclusion` | `revert-l2-credit` |
| re-inclusion awaiting credit | confirmed | none | – | `re-inclusion` | `credit-l2-once` |
| duplicate deposit | – | duplicated | – | – | rejected (`duplicate-credit`) |
| over-credit | – | exceeds backing | – | – | `freeze-bridge` via `progressBlocked` |

`revert-l2-credit` carries `rederiveFromBlock`, the canonical L2 height that
committed the now-unbacked credit. `freeze-bridge` maps to the whitepaper's
"defined invalid state" that blocks further security-sensitive progression
(§28). Duplicate credit is additionally rejected by the block processor at
commit time (`collectCommittedDepositIds` in `src/blockProcessor.ts`); the
accounting layer re-detects it over a supplied credit set.

## 5. Conservative spend evidence

`assessCreditSpend(view, credit)` returns `'spent'` **only** when the recipient
balance at the canonical tip is strictly below the credited amount, which proves
at least part of the credit left the account. It otherwise returns `'unknown'`
and **never** `'unspent'`, because a sufficient fungible balance cannot prove the
credit was not spent. Example: a recipient funded with exactly the credit
returns `'unknown'`; after transferring half the credit, it returns `'spent'`.

**Open decision.** The after-credit-before-spend vs after-spend distinction is
genuinely a re-derivation problem, not a balance problem. This prototype accepts
`creditSpent` as an explicit caller input and defaults to the conservative
`freeze-bridge` whenever the credit is unbacked and cannot be proven unspent.
Deciding when an unbacked-but-unprovable credit may be optimistically reverted
requires the L2 re-derivation design and is **not** decided here.

## 6. What this proves / does not prove

Proves (by tests, no BTCS Core required):

- The invariant is computed correctly over real `BtcsL1DepositStore` records and
  real canonical L2 credits from a `PersistentBlockProcessor` chain.
- A credited deposit keeps the invariant; invalidating its L1 inclusion trips
  `unbacked-credit` and blocks progression.
- A reorged-out, fully or partly spent credit is detectable (`spent`) and maps
  to `freeze-bridge`.

Does **not** prove:

- That L2 state can be re-derived to remove an unbacked credit.
- That `spent` detection is complete (it is intentionally one-sided).
- Any production bridge, vault, withdrawal, forced-inclusion, or proof security.

## 7. Follow-up

1. Implement canonical L2 re-derivation and wire `revert-l2-credit` to it.
2. Implement transaction-trace spend attribution to replace the explicit
   `creditSpent` input and the one-sided balance signal.
3. Persist the bridge accounting state alongside the deposit store and gate block
   production on `progressBlocked`.
4. Add a multi-implementation convergence test (whitepaper §49 acceptance).
