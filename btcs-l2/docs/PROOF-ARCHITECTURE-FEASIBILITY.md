# Proof Architecture Feasibility Analysis

Date: 2026-10-22 | Branch: experimental/deposit-prelude-v1

## Candidates Evaluated

| Approach | L1 Enforceable Now? | What it Proves | Who Challenges | Censorship Resistant? | Disappearing Party | BTCS Script Support | Effort | Verdict |
|---|---|---|---|---|---|---|---|---|
| **A) Full-node verification + deterministic replay** | Yes (local) | L2 state is consistent with replay rules | Anyone running verifier | N/A (local) | N/A | N/A | Medium | **Feasible now** - implemented partially |
| **B) Optimistic rollup + fraud proofs** | Uncertain | Invalid state transition detected | Verifiers | Risk if L1 censors challenges | Challenger can disappear | Needs dispute mechanism on L1 | High | **Needs L1 capability assessment** |
| **C) BitVM/BitVMX** | Experimental | Computation correctness via challenge game | Verifiers | Complex, needs pre-signed txs | Requires watchers online | Needs specific opcodes/covenants | Very High | **Research only, likely needs L1 upgrades** |
| **D) Validity proofs (ZK)** | No (verifier too large) | State transition valid | None needed if verified | N/A | N/A | Bitcoin Script too limited for large verifiers | Very High | **Long-term only** |
| **E) Trusted/federated** | Yes | Operator attestation | None enforced | Centralized | Single point of failure | N/A | Low | **Current interim model** |

## BTCS L1 Script Capabilities (from source inspection)
- Taproot/P2TR supported (tests confirm)
- Standard opcodes present
- No OP_CAT, OP_CHECKTEMPLATEVERIFY, OP_CHECKSIGFROMSTACK observed
- Script limits: MAX_SCRIPT_ELEMENT_SIZE=520, MAX_OPS_PER_SCRIPT=201
- OP_RETURN available for data publication (used)

## Recommendations
1. **Immediate:** Strengthen A (independent replay) - DONE partially, continue
2. **Short-term:** Focus on B feasibility if L1 can support simple disputes
3. **Long-term:** C/D likely need consensus changes or external mechanisms

## Exit Path Analysis
Current BTCS L1 cannot easily enforce covenant-based exits without additional script capabilities. BitVM-style approaches are complex and experimental. Recommended: document blocker clearly if true, implement strongest feasible alternative.
