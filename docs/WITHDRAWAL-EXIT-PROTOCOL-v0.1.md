# BTCS L2 Withdrawal and Exit Protocol v0.1

Status: **DESIGN + PARTIAL IMPLEMENTATION** (2026-10-22). This is a testable protocol design with a development-only implementation. **No production withdrawal payouts are enabled.** 

## 1. Purpose

Define a safe, verifiable withdrawal/exit lifecycle for BTCS L2 that:
- Prevents double-spending and replay
- Binds withdrawals to specific L2 state transitions
- Supports L1 data reconstruction for independent verification
- Handles reorganizations safely
- Explicitly documents trust assumptions
- Provides a clear path to trustless enforcement when L1 capabilities allow

## 2. Trust Model

**Current (interim trusted/federated model):**
- L1 inclusion verified via trusted Core RPC (SG-01) - NOT trustless
- Operator/sequencer controls withdrawal processing
- Data availability via L1 publication (we have fragment publishing)
- Users must trust operator to process legitimate exits or use forced inclusion if available

**Target (optimistic):**
- All batch data published to L1
- Any observer can reconstruct L2 state from L1
- Fraud proofs enable challenges (requires L1 dispute mechanism - see feasibility analysis)
- Users can exit by force-including transactions if operator censors

**Hard requirement:** A commitment alone does NOT prove execution correctness.

## 3. Withdrawal Lifecycle

### Phase 1: Initiation (L2)
1. User submits withdrawal request on L2 via `btcs_withdraw` transaction
2. Transaction must be valid under L2 rules (sufficient balance, valid recipient format)
3. Request is included in L2 block by sequencer
4. Unique withdrawal ID assigned: `sha256(withdrawalRequest) || nonce` format
5. Funds are escrowed/locked in L2 bridge contract/vault (accounting tracked)

### Phase 2: Settlement (L2 → L1)
1. L2 blocks containing withdrawals included in settlement batch
2. Batch published to L1 as fragments + commitment (existing mechanism)
3. Batch confirmed on L1 per confirmation policy
4. Withdrawal becomes "pending-finalization" after batch confirmed

### Phase 3: Finalization & Exit (L1)
1. After challenge window (if optimistic) or immediate (if validity proof), withdrawal becomes finalizable
2. Operator or anyone can submit L1 transaction to release funds
3. L1 verifies: withdrawal ID not consumed, proof valid, amount correct, recipient correct
4. Funds released to L1 address
5. Withdrawal marked consumed (prevents replay)

## 4. Security Invariants

- **No double-spend:** Each withdrawal ID consumed exactly once
- **Amount correctness:** Payout amount ≤ escrowed amount for that withdrawal
- **Recipient binding:** Payout goes to specified L1 address only
- **Balance conservation:** Total escrows = sum of pending + completed withdrawals
- **Replay protection:** Consumed withdrawals cannot be reprocessed
- **Reorg safety:** On L1/L2 reorg, withdrawals revert to correct state
- **Censorship resistance:** Force-inclusion path must exist (if L1 supports)
- **Data availability:** All withdrawal data reconstructible from L1

## 5. Implementation Status

- [x] Design specification
- [ ] L2 withdrawal transaction type
- [ ] Escrow/vault accounting
- [ ] Withdrawal ID generation and tracking
- [ ] L2 state integration
- [ ] Batch inclusion of withdrawals
- [ ] L1 payout mechanism (DISABLED - requires design approval)
- [ ] Challenge/dispute handling (DISABLED - depends on proof architecture)
- [ ] Force-inclusion (DISABLED - depends on L1 capabilities)
- [ ] Comprehensive tests

**All payout/dispute mechanisms are DISABLED by default.**
