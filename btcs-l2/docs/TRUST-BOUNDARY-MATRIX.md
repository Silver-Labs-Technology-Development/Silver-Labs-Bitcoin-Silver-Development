# BTCS L2 Trust-Boundary Matrix (Code-Linked)

Branch: experimental/deposit-prelude-v1 | HEAD: 148d14f + uncommitted work | Date: 2026-10-22

| Area | Source of Truth (current) | Independently Verified | Trusts | Attacker Capability | Component to Reduce | Falsification Test |
|---|---|---|---|---|---|---|
| L1 network identity | BTCS Core RPC | Basic chain name check in watcher (`chain !== 'regtest'` rejected) | RPC reports correct chain/genesis/network | Point to wrong network/node | Network ID validation, genesis hash check, expected params config | Wrong chain rejected (tested) |
| Canonical-chain selection | BTCS Core RPC (longest/active chain) | No independent most-work tip selection; local header-chain/PoW checks do not choose between competing tips | RPC's view of active chain | Feed competing/stale chain | Independent header sync, cumulative-work comparison, and checkpoint policy | Chain-link/PoW tests exist; most-work selection not implemented; SG-01 canonical gap |
| L1 headers/blocks | BTCS Core RPC | Local 80-byte serialization, header hash, and PoW verifier (`l1HeaderVerifier.ts`); confirmation/deposit verify the supplied header/proof | Header and active-chain view still supplied by RPC; no independent header sync | Malformed/corrupted headers, wrong previous hash | Retain independently synced headers and select most-work chain | Invalid header/PoW and previous-hash mismatch tests pass; RPC remains the header source |
| Tx inclusion in block | BTCS Core RPC (`in_active_chain`, blockhash) plus optional `gettxoutproof` | Partial Merkle proof verifier is integrated into confirmation/deposit when the RPC exposes `gettxoutproof`; reports distinguish trusted-RPC-only from local-proof. Not canonical membership. | RPC active-chain claim and proof availability; fallback is trusted-RPC only | Claim tx included when not | Require and verify `gettxoutproof`; independently select most-work chain | Wrong-block/txid/malformed/root/previous-hash tests pass; canonical selection and finality remain open (SG-01) |
| Deposit detection/amount | RPC + script parsing | Intent+payment binding, whole satoshis, duplicate output index | RPC returns correct tx/vout | Fabricate deposit | Deterministic parsing + replay protection | Duplicate/malformed rejected (tested) |
| Deposit replay prevention | Deposit store | Per-output ID (txid:outputIndex) | Store integrity | Replay same deposit | Already enforced | Tested |
| Batch data publication | Operator + L1 | Fragment encoding/decoding, checksums | Operator publishes correctly | Withhold/corrupt fragments | Independent reconstruction (exists) | Reconstruction tests pass |
| Batch reconstruction/availability | L1 artifacts | Cryptographic reconstruction from fragments | L1 has fragments | Withhold fragments | Already tested adversarially | Extended tests added |
| L2 ordering/history | Sequencer DB | None independent | Sequencer canonical history | Reorder/omit txs | Deterministic replay (WS3) | Needed |
| Deterministic EVM execution | Local VM | Block replay in processor | Genesis/state DB correct | Corrupt state | Replay verification | Needed |
| State root validity | Sequencer claims | Not verified independently | Sequencer computes roots | Wrong state root | Independent replay recompute roots | Needed |
| Sequencer censorship | Sequencer policy | None | Sequencer includes/excludes txs | Censor withdrawals/deposits | Forced inclusion mechanism (WS5) | Blocked by L1 capability |
| Withdrawal authorization | Trusted operator | Balance checks, duplicate prevention, state machine | Operator approves legitimately | Unauthorized approval | Multi-sig/federation/DAO - not implemented | Operator trust explicit |
| L1 exit/payout | Operator-controlled adapter (disabled) | Chain validation, amount/address checks | Operator sends correct payout | Wrong recipient/amount/double pay | Escrow enforcement on L1 (WS5) | Adapter guards exist |
| Reorgs/restarts/recovery | Mixed (RPC + stores) | Reorg detection in places | RPC tip accuracy | Deep reorgs | Fail-closed in places (SG-11) | Tested |
| Operator disappearance | Not handled trustlessly | None | Operator must act | Operator goes offline | Watchtowers/forced exit (WS5) | Blocked |
