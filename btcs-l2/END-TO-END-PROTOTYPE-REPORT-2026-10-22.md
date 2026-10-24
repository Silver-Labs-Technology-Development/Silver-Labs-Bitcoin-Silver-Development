# BTCS L2 End-to-End Trusted Prototype Report (2026-10-22)

## Status
Branch: **experimental/deposit-prelude-v1**  
HEAD: **d9ae157**  
Node: v24.17.0  
All existing work preserved, no commits/pushes, no destructive git ops.

## Validation
- Typecheck: **clean**
- Full test suite: **293/293 passing, 0 failing**
- `git diff --check`: **clean**

## What Works End-to-End (Trusted Single-Operator Model)
**Integrated E2E script:** `execution/evm/scripts/integrated-e2e.ts` (run successfully)

Demonstrated lifecycle:
1. **L2 chain creation** - Isolated disposable chain via `PersistentBlockProcessor.open`
2. **L2 execution** - Built blocks on canonical chain
3. **Settlement batch creation** - Created batch from envelopes with commitments
4. **L1 data publication (simulated)** - Encoded batch as fragments using existing `encodeBtcsL1BatchData`
5. **Clean-node reconstruction** - Reconstructed batch from L1 artifacts only, verified byte-exact match
6. **Withdrawal request** - Submitted via `WithdrawalService`, validated, funds reserved
7. **Trusted operator authorization** - Explicitly authorized by operator with audit trail
8. **Payout preparation/broadcast** - Prepared and broadcast (adapter disabled by default)
9. **Payout confirmation** - Confirmed, marked completed, reserved funds released
10. **Restart/recovery** - Service restarted from same data dir, state recovered correctly
11. **Duplicate prevention** - Same request rejected

## Components Added
- `execution/evm/src/withdrawalService.ts` - Persistent withdrawal state machine (requested→validated→reserved→authorized→payout_prepared→payout_broadcast→payout_confirmed→completed), audit trail, restart recovery, reconciliation support
- `execution/evm/src/l1PayoutAdapter.ts` - Chain-guarded payout adapter, **disabled by default**, refuses wrong chain, validates amounts/addresses
- `execution/evm/src/cli.ts` - Basic CLI interface
- `execution/evm/tests/withdrawalLifecycle.test.ts` - Lifecycle tests (8 tests)
- `execution/evm/scripts/integrated-e2e.ts` - Integrated E2E demo

## Trust Model (Explicit)
**Depends on operator trust for:**
- Canonical L2 sequencing
- Withdrawal request validation and authorization
- Payout authorization decisions

**RPC trust boundary (documented):**
- L1 observations via trusted Core RPC (SG-01) - no SPV/trustless inclusion proof
- L1 data publication/anchoring provide evidence and recovery material, **not cryptographic enforcement** of correct L2 execution

**Production operations remain disabled:**
- L1 payout adapter disabled by default
- Requires explicit enabling + chain validation
- No fraud-proof/validity-proof enforcement
- Withdrawals are development/regtest feature

## Test Coverage
- 293 tests passing (added 29 new tests: trust boundaries, extended recovery, withdrawal lifecycle)
- All existing tests preserved
- Typecheck clean, diff clean

## Reproduction
```bash
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
cd /home/user/Silver-Labs/btcs-l2/execution/evm
npx tsx scripts/integrated-e2e.ts
```

## Notes
- L1 payout uses simulated broadcast (adapter disabled) - actual regtest L1 payout requires enabling adapter with proper RPC credentials and chain validation
- This is a trusted single-operator prototype, not trustless
- All safety boundaries maintained
