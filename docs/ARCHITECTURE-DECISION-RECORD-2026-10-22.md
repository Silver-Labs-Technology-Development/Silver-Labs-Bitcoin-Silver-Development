# Architecture Decision Record: BTCS L2 Trust Model and Proof Strategy

Date: 2026-10-22  
Status: **DECIDED (interim) - Requires owner approval for production path**  
Authors: Engineering team

## Context

BTCS L2 needs a trust model for withdrawals/exits and state transition enforcement. The question is: what can Bitcoin Silver L1 enforce today without consensus changes?

## Analysis

### Bitcoin Silver L1 Capabilities (Current)
- **Script:** Standard Bitcoin-like Script, limited opcodes (no OP_CAT, no OP_CHECKTEMPLATEVERIFY, no OP_CHECKSIGFROMSTACK visible in current codebase)
- **Tapscript/Taproot:** Supported (tests show P2TR)
- **OP_RETURN:** Available (used for batch data publication - 83 byte limit)
- **Timelocks:** CHECKLOCKTIMEVERIFY, CHECKSEQUENCEVERIFY likely available
- **Signatures:** ECDSA and Schnorr (Taproot)
- **Limits:** 520 byte element, 201 ops per script

### Proof Architecture Feasibility

| Approach | L1 Feasibility | Trust Assumptions | Implementation Effort | Status |
|---|---|---|---|---|
| **Trusted/Federated** | ✅ Possible now | Full trust in operator/sequencer/federation | Low | **Interim** |
| **Optimistic + Fraud Proofs** | ⚠️ Uncertain | 1-of-N honest verifier, L1 can verify dispute | High - needs L1 dispute mechanism | **Target (if L1 supports)** |
| **Validity Proofs (ZK)** | ❌ Difficult | Trust in prover setup/circuit correctness | Very High | **Long-term research** |
| **BitVM/BitVMX** | ⚠️ Experimental | Complex challenge games, requires off-chain interactions | Very High | **Research only** |

### Key Findings

1. **L1 cannot currently enforce arbitrary fraud proof verification** without additional script capabilities or a complex challenge system like BitVM
2. **OP_RETURN provides data availability** - we can publish batch data (implemented and tested)
3. **Commitments alone do NOT prove execution correctness** - must be explicit
4. **Force-inclusion mechanism** not implemented, unclear if feasible
5. **No built-in bridge covenant mechanism** visible in current codebase

## Decision

**Adopt a trusted/federated interim model with a clear path to optimistic rollup:**

- **Phase 1 (Current):** Trusted operator model, all data published to L1 for reconstruction, comprehensive monitoring
- **Phase 2 (Target):** Optimistic rollup if L1 can support dispute resolution; require external review
- **Phase 3 (Long-term):** Validity proofs if technology mature and L1 compatible

## Required Actions

1. **Do NOT** implement withdrawals/payouts until protocol decision approved
2. **Do NOT** implement fraud proof verification until L1 feasibility confirmed
3. **DO** implement exit procedure documentation and force-inclusion research
4. **DO** ensure all data is L1-published for independent reconstruction
5. **DO** maintain fail-closed behavior throughout

## Approval Required

- [ ] Project owner approval for trust model
- [ ] Security review of any exit mechanism before enabling
- [ ] Specialist review (Bitcoin Script, bridge security) before production
