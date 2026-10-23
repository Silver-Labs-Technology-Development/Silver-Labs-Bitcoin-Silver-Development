# BTCS L2 Alpha — Known Limitations

**Version:** Alpha (commit `148d14f` + uncommitted work)  
**Date:** 2026-10-22

This document catalogs every known limitation, missing feature, and area where the alpha prototype does not meet the full BTCS L2 specification. Items are grouped by subsystem.

---

## Core EVM Execution

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-EVM-001 | Chain ID 31337 collides with Hardhat/Anvil | Local dev only; cannot distinguish from other dev chains without `BTCSL2/` client banner | Asset engine validates `BTCSL2/` banner |
| LIM-EVM-002 | Unmined transaction pool lost on restart | In-flight txns not persisted | Documented; dev sequencer only |
| LIM-EVM-003 | No `eth_gasPrice`, `eth_maxPriorityFeePerGas`, `eth_feeHistory` | Wallet UX incomplete | Asset service provides fee quotes |
| LIM-EVM-004 | No `pending`/`safe`/`finalized` block tags | Finality UX not implemented | Single canonical tip only |
| LIM-EVM-005 | Coinbase forced to zero address | Priority fees accumulate at 0x0 | Prototype accounting; not a treasury |
| LIM-EVM-006 | No production sequencer, no leader election | Single-operator only | Documented trusted model |
| LIM-EVM-007 | Block gas limit 30M, tx gas cap 16.7M (Osaka) | Large contract deployments may fail | Known EVM limits |

---

## Asset Engine & Token Standards

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-AE-001 | BSNA-FTS1 is local-chain tested only | No live testnet/mainnet deployment or explorer verification | Contract, engine, and HTTP conformance tests run on BTCS L2 local; BNB testnet credentials remain unconfigured |
| LIM-AE-002 | BSNA-20 / BSNA-721 are ERC-20/721 wrappers, not BSNA-FTS1 | Current contracts scale supply by `10**decimals` | Documented; separate from FTS1 |
| LIM-AE-003 | NFT (ERC-721) creation not via asset engine | Studio NFT deployment is disabled rather than sending calldata without bytecode | BTCS-L2-GUI-014; add an audited reference contract |
| LIM-AE-004 | Shared `EvmFungibleAsset` remains fixed-supply | Legacy ERC-20 path has no mint/burn/pause; BSNA-FTS1 adds those rules | Deploy BSNA-FTS1 when policy controls are needed |
| LIM-AE-005 | No ERC-1155 / semi-fungible support | Future work | Not in scope |
| LIM-AE-006 | Cross-chain asset identity not supported | `refuseCrossChainLink()` throws | By design — no bridge |
| LIM-AE-007 | Explorer verification not submitted | `verification: 'not-submitted'` | Requires API keys |
| LIM-AE-008 | Logo storage local-only (`registry-local:`) | Not portable across machines | IPFS provider available but not configured |

---

## SilverForge Studio GUI

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-GUI-001 | NFT tab is disabled | NFT deployments are unavailable | BTCS-L2-GUI-014; no placeholder bytecode is sent |
| LIM-GUI-002 | Mint tab supports BSNA-FTS1 authorized-mint only | Legacy ERC-20 and fixed-supply tokens cannot mint | Expected contract behavior; fixed-supply mint is refused |
| LIM-GUI-003 | No MetaMask wallet connection | Cannot use browser wallet for signing | Service-side signing only (dev key) |
| LIM-GUI-004 | No contract verification UI | Cannot verify source on explorer | BTCS-L2-GUI-012 |
| LIM-GUI-005 | Receipt modal is shown for asset-engine deployment | Mint shows transaction hash and total supply instead of the full modal | Partial |
| LIM-GUI-006 | No transaction history per token | Only global Transactions page | Could be added |
| LIM-GUI-007 | No Studio control for `setMetadata` | Metadata update exists on-chain but is not exposed in the GUI | Use contract tooling; add an admin panel later |
| LIM-GUI-008 | No gas token balance display for signer | Dev key balance not shown | Could query `eth_getBalance` |
| LIM-GUI-009 | SilverPay Wallet Phase 1 is read-only | A real Studio page and loopback service show separate L1 UTXOs/balance and L2 account/network reads, but signing, send/receive, recovery, pending/confirmed history, token/NFT balances, account switching, and payments are not implemented; the separate Silver Wallet product is retired | BTCS-L2-ECO-002; browser test still missing |
| LIM-GUI-015 | SilverPay read-only service is loopback-only and trusts its RPC sources | No service authentication/TLS; L1 wallet data trusts the configured Core RPC and L2 data trusts the configured L2 RPC; no L2 proof or canonical L1 verification | Bind to `127.0.0.1`; do not expose; no keys or write methods; see `services/silverpay-service/README.md` |
| LIM-GUI-010 | No Silver Scan explorer/indexer | L1/L2 blocks, txs, receipts, tokens, NFTs, settlement, and indexing health cannot be inspected end-to-end | BTCS-L2-ECO-006 |
| LIM-GUI-011 | Integrated restart/failure acceptance test missing | Only the asset-service HTTP flow is automated; no two-account SilverPay Wallet/Silver Scan/NFT restart proof exists | BTCS-L2-ECO-007 |
| LIM-GUI-012 | Large JS bundle (~197 kB gzipped) | Slow initial load on slow networks | Code splitting recommended |
| LIM-GUI-013 | No dark/light theme toggle | Single dark theme | Not critical |
| LIM-GUI-014 | SilverPay Payments is planned only | Payment requests, QR, checkout, invoices, reconciliation, and settlement are not implemented | Phase 2; must not block SilverPay Wallet |

---

## Asset Service & Metadata

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-AS-001 | Local storage only (`local-dev` provider) | URIs not portable, lost on disk wipe | IPFS provider implemented but not configured |
| LIM-AS-002 | `setMetadata` is not exposed through the asset service | Studio cannot update a mutable token's URI/hash | Contract supports it; add an admin endpoint with authorization |
| LIM-AS-003 | No image optimization / thumbnails | Large images served as-is | Could add sharp/libvips |
| LIM-AS-004 | No access control / auth on upload endpoints | Any allowed origin can upload | Configure `ASSET_ALLOWED_ORIGINS` |
| LIM-AS-005 | No rate limiting on API | Potential DoS | Behind local-only binding |
| LIM-AS-006 | Registry logos are served only by the local asset service | A `registry-local:` URI breaks if the service or registry is gone | Configure portable storage; copy the registry directory |

---

## L1 Integration & Settlement

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-L1-001 | Trusted Core RPC for deposit/anchor confirmation (SG-01) | Local best-chain selection now validates candidate headers (80-byte hash, PoW, parent linkage, height, nBits retarget, median-time-past) anchored at a trusted checkpoint, and selects the tip with greatest cumulative work. Confirmation and deposit use the selected chain when reporting `local-best-chain+local-inclusion-proof` or `local-best-chain-only`. Partial Merkle proof verification is retained when `gettxoutproof` is available. The Core RPC supplies header data but is not chain-selection authority. No independent peer consensus, no chain discovery, no finality proof; single-source candidate withholding remains possible. Fallback without local best-chain verification remains trusted-RPC only. A verified partial proof is not canonical membership. | Documented; regtest only; do not call it trustless SPV |
| LIM-L1-011 | Single-source candidate header withholding | With one potentially dishonest RPC source, competing branches may be withheld; independent peer consensus and complete chain discovery are not implemented. The local best-chain selector only sees headers supplied by the caller. | Documented; requires multi-source header feed or P2P sync to resolve |
| LIM-L1-002 | Deposit reorg recovery remains operator-invoked (SG-05) | The watcher now freezes a configured L2 store on permanent invalidation, but a human must run re-derivation/adoption | Durable recovery gate; automatic recovery not implemented |
| LIM-L1-003 | Source-specific fungible attribution partial (SG-04) | Address-level only, not per-deposit | Conservative freeze |
| LIM-L1-004 | Deep reorg handling fails closed (SG-11) | No recovery beyond retained history; watcher durably freezes configured L2 store | Operator recovery only |
| LIM-L1-005 | Publication continuity has prototype-only residuals | `BtcsL1PublicationStore` now requires and durably binds one continuity store; direct `observe`/`reobserve` replay the exact batch and commit continuity before confirmation. There is still no production orchestrator, and a failed publication write after the continuity commit can leave the cursor one batch ahead until retry. | SG-13; `btcsL1PublicationStore.ts`, `btcsL1PublicationWorkflow.ts`; 27 focused and full EVM 366 tests (365 pass, 1 skip live BNB) |
| LIM-L1-006 | Clean-node recovery from L1 only not demonstrated | Batch reconstruction works, full node rebuild not tested | Hard gate |
| LIM-L1-007 | Batch data publication requires funded wallet with mature UTXOs | `e2e:batch-data` needs ≥129 mature UTXOs | Documented in regtest findings |
| LIM-L1-008 | Coinbase maturity 200 blocks | Funding flows need 201 blocks | Regtest requirement |
| LIM-L1-009 | No fraud/validity proofs (SG-03) | Settlement is optimistic/trusted | Security gate |
| LIM-L1-010 | No forced inclusion (SG-02/SG-03) | Censorship resistance not implemented | Blocked on protocol decision |

---

## Security & Network Boundaries

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-SEC-001 | Withdrawals/payouts disabled and non-RPC | No exit path for users; service requires explicit test config, trusted balance/payout readers, and defaults `payoutsEnabled` to false | By design — security gate |
| LIM-SEC-002 | No fraud proofs or validity proofs | Cannot challenge invalid state | SG-03 open |
| LIM-SEC-003 | No forced inclusion | Operator can censor | SG-02/SG-03 |
| LIM-SEC-004 | Single-host coordination only (SG-06) | File lock on shared FS only | Not multi-host |
| LIM-SEC-005 | RPC binds `127.0.0.1` only | No remote access | Dev safety |
| LIM-SEC-006 | Dev private key (`0x11...`) in repo | Public test key only | Must not be used for value |
| LIM-SEC-007 | No authentication on RPC | Trusts local caller | Dev only |
| LIM-SEC-008 | No rate limiting on RPC | Potential resource exhaustion | Dev only |

---

## Testing & Distribution

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-TST-001 | Live BNB testnet not tested | No credentials in CI | Requires owner setup |
| LIM-TST-002 | Live regtest E2E not run in CI | Requires bitcoinsilverd binary | Manual only |
| LIM-TST-003 | No CI/CD pipeline | No automated verification | Local runs only |
| LIM-TST-004 | No reproducible build verification | Build not hermetic | Documented |
| LIM-TST-005 | No external developer test reports | Alpha not yet distributed | This release |

---

## Documentation & Standards

| ID | Limitation | Impact | Mitigation |
|----|------------|--------|------------|
| LIM-DOC-001 | Whitepaper v1.6 is the long-term design reference, not an implemented specification | The repo contains v1.2 and the unchanged v1.6 target; implementation does not meet v1.6 | Follow code and evidence, not aspirational claims |
| LIM-DOC-002 | BSNA-FTS1 is not a ratified standard | The implemented contract is a provisional reference, not a governance-approved standard | Name is decided; keep the proposal labeled PROPOSED |
| LIM-DOC-003 | BSNA-20/721 not ratified standards | Proposals only | Marked PROPOSED |
| LIM-DOC-004 | No formal external conformance suite for BSNA | Cannot claim independent compliance | Section 10 tests exist and pass locally; independent review is still required |
| LIM-DOC-005 | No OpenAPI/Swagger for asset service | Manual integration | Could generate from types |

---

## Classification

| Category | Count |
|----------|-------|
| **Blocking alpha workflows** | 0 (core ERC-20 deploy works) |
| **Degrading UX** | 10 |
| **Missing features (planned)** | 15 |
| **Security gates (by design)** | 8 |
| **Architecture gaps (spec vs impl)** | 11 |
| **Total** | 44 |

---

## How to Read This List

- **Blocking**: Prevents the primary alpha workflow (ERC-20 create → deploy → verify). Currently **zero**.
- **Degrading UX**: Works but awkward, incomplete, or missing polish.
- **Missing features**: Explicitly planned tasks with task IDs in `WORK-QUEUE.md`.
- **Security gates**: Intentionally disabled/absent per `SECURITY-GAP-REGISTER.md`. Not bugs.
- **Architecture gaps**: Where implementation diverges from whitepaper v1.5 spec.

---

## Updating This Document

When a limitation is resolved:
1. Move it to `docs/RESOLVED-LIMITATIONS.md` with commit reference
2. Update the relevant task in `WORK-QUEUE.md` to COMPLETE
3. Regenerate this list from the task register if automated

**Do not delete limitations** — they are evidence of honest scope assessment.