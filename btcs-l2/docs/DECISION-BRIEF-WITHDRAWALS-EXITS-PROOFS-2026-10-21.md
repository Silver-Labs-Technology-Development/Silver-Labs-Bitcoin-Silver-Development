# Decision brief: withdrawals/exits and state-transition enforcement for BTCS L2

Date: 2026-10-21  
Status: draft — options, tradeoffs, and a recommendation for discussion (no code changes proposed here).

## Context
The prototype has deposits (real regtest), L2 execution/sequencing, settlement batches, L1 publication/reconstruction, and reorg handling. What it lacks:
- Any withdrawal/exit path (SG-02)
- A fraud/validity proof architecture or dispute resolution (SG-03)
- Trustless L1 inclusion verification (SG-01)
- Source-specific attribution among fungible credits (SG-04)
- Multi-host coordination (SG-06)

## Option A: Optimistic rollup with fraud proofs
- **Model:** Operator posts batches/commitments to L1; anyone can challenge within a window by submitting a fraud proof.
- **Pros:** Familiar, can be incremental; users can exit during the challenge window if challenged or after finalization if no challenges.
- **Cons:** Requires a proof system (dispute game), bond economics, a reliable way to submit proofs on L1, censorship resistance for challengers, and careful handling of data availability.
- **L1 dependency:** Needs a way to verify proofs on Bitcoin Silver L1 (script capabilities / future consensus changes) or an external verifier — significant uncertainty on BTCS.
- **Effort:** High. Likely the longest path to "defensible".

## Option B: Validity proofs (ZK) with on-L1 verification
- **Model:** Every batch (or checkpoint) is accompanied by a validity proof verified on L1.
- **Pros:** Strongest finality guarantees; faster withdrawal finality once proved.
- **Cons:** Prover infrastructure, circuit complexity for EVM, verification cost on L1 (BTCS script limits unknown), longer design cycle.
- **Effort:** Very high.

## Option C: "Optimistic + escape hatch" / permissioned exit with strong monitoring (interim)
- **Model:** Keep operator-trusted for now; require mandatory challenge/escape window, publish all data on L1 (done), enable anyone to reconstruct and detect invalid transitions; define a non-trustless but explicit exit process with high delays and public attestations.
- **Pros:** Uses existing DA/reconstruction work; can harden safety without committing to unimplementable proof tech on BTCS today.
- **Cons:** Not trustless; relies on social/monitoring assumptions; cannot claim "permissionless exit".
- **Effort:** Medium (design + docs + careful testing) but **must not** over-promise.

## Option D: Forced inclusion + user-initiated exit (hybrid)
- **Model:** Users can force transactions/withdrawals through L1 (escaping censorship), combined with strong DA and independent verification.
- **Pros:** Improves censorship resistance; partially addresses "operator stops cooperating".
- **Cons:** L1 throughput/cost constraints; complex to implement safely.
- **Effort:** Medium–High.

## Recommendation (for discussion)
1. **Do not implement fraud/ZK proofs yet.** BTCS L1 script/consensus constraints are not yet mapped to the verification requirements; this is research work (matches whitepaper "OPEN RESEARCH").
2. **Prioritize an explicit, documented exit model first.** Define: who can exit, under what conditions, required delays, how to reconstruct state from L1 data (we have this), and what happens if the sequencer censors. Make trust assumptions explicit.
3. **Harden what exists.** Finish anchor reorg evidence (done), harden availability edge cases (done for SG-07), improve deposit attribution where feasible, and add a "reconstruct from L1 only" integration test (clean-node recovery §22).
4. **Publish a "bridge security policy"** before any mainnet/testnet with real value: list known trusts, required confirmations, exit procedure, and incident response.

## Immediate next steps (safe, in-scope)
- Add a clean-node recovery test that reconstructs batch data + re-executes from L1-published artifacts with no sequencer DB.
- Document the forced-inclusion path requirements even if unimplemented.
- Map BTCS Core script capabilities against a minimal proof verifier (separate research doc, no consensus changes).

## Notes
This brief intentionally avoids implementation details that would "invent" an insecure mechanism. Any withdrawal/proof implementation must be preceded by a protocol decision and an independent security review.
