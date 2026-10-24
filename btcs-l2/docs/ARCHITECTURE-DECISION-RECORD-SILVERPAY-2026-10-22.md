# Architecture Decision Record: SilverPay Is the Unified Wallet, Account, and Payments Product

Date: 2026-10-22  
Status: **DECIDED — product direction; implementation not complete**  
Supersedes: separate Silver Wallet roadmap entry and any requirement to integrate the existing `silver-wallet` application

## Context

Silver Labs needs one owned wallet-and-payments product for the BTCS ecosystem. Previous planning described a separate Silver Wallet and a separate SilverPay payments product. That split creates duplicate account, signing, asset-display, and transaction-history surfaces, and it implies a dependency on an external wallet application that is not present or required.

The BTCS L2 repository has a **read-only Phase 1 slice**, not a complete wallet UI: a loopback SilverPay service and a Studio page read separate L1 UTXOs/balance and L2 account/network state. It has no signing, send/receive, recovery, history, token/NFT balances, account switching, or payments. It also has RPC account reads, an asset engine, an asset service, a Studio token workflow, and a partially implemented MetaMask network helper. The sibling `/home/user/Silver-Labs/silver-wallet` directory contains no files and is not referenced by project code or build dependencies.

## Decision

1. **SilverPay is the single Silver Labs wallet-and-payments product.**
2. **The separate Silver Wallet product is retired from the roadmap.** Existing BTCS Silver Wallet application work is not a required service, package, repository, or runtime dependency.
3. **SilverPay's initial functionality is its wallet and account foundation.** "Wallet" describes the first capabilities of SilverPay, not a separate product or application.
4. **Payment processing and merchant services are later SilverPay capabilities**, gated on verified transaction, settlement, accounting, and security capabilities. They are not a separate payment application.
5. **SilverForge and Silver Scan remain separate products** integrated with SilverPay. SilverPay does not absorb their responsibilities.
6. Existing wallet-related internal components may be reused when they pass security and compatibility review. Reuse must not turn an external wallet into a mandatory dependency.

## Initial functionality — SilverPay wallet and account foundation

The first usable developer-test wallet must provide, where the underlying services genuinely support it:

- Separate BTCS L1 UTXO accounts and BTCS L2 EVM accounts, with chain and identity clearly labeled.
- Native BTCS balances, supported BSNA token balances, and supported NFTs.
- Real send and receive workflows with confirmation, fee, receipt, and error reporting.
- Combined or clearly separated transaction history, including pending, confirmed, failed, and unavailable states.
- SilverForge asset-creation handoff and Silver Scan transaction-inspection links.
- Safe local development accounts and signing flows.
- Secret isolation: seeds and private keys must not be exposed to UI components, logs, public APIs, or Silver Scan.
- Explicit unsupported-action and unavailable-service states. No mock balance, fabricated transaction, or UI-only success is acceptable.

Phase 1 may be delivered incrementally, but a capability is not complete until a real local transaction or authoritative state read proves it.

## Current implementation status (2026-10-22)

**Implemented, local read-only only:**

- `services/silverpay-service/` — loopback-only GET gateway with allowlisted L1
  Core and L2 EVM read methods; optional Core cookie auth; origin allowlist;
  sanitized errors; no keys or write methods.
- `studio/src/pages/SilverPayWallet.jsx` and `studio/src/lib/silverpay.js` —
  separate L1 UTXO/balance and L2 account/network panels with loading,
  unavailable, stale, and partial states.
- Service tests 15/15, Studio adapter tests 6/6, Studio production build passes.
  A real local L1 read returned 356 UTXOs with exact satoshi conversion; an
  unavailable L2 was reported as unavailable.

**Not implemented:** private keys, signing, send/receive, recovery, account
switching, transaction history, token/NFT balances, payments, invoices,
checkout, settlement, and a browser-driven end-to-end test. L1 reads trust the
configured Core RPC and L2 reads trust the configured L2 RPC; the service has no
canonical L1 proof, L2 state proof, finality check, authentication, or TLS. It
must remain loopback-only.

## Later functionality — SilverPay payments and merchant services

Payments are deliberately later capabilities within SilverPay. Candidate capabilities include payment requests, QR payloads, merchant checkout, invoices, transaction-status tracking, reconciliation, and settlement integration. These are not implemented by the current prototype and do not constitute a separate product or application.

A payment flow may be described as complete only when it uses verified technical capabilities and reconciles against authoritative transaction and settlement records. Submitting a transaction is not proof of payment completion.

## Dependency and security constraints

- No mandatory dependency on the existing BTCS Silver Wallet application.
- SilverPay must use the same BTCS L1/L2 security boundaries as the rest of the project.
- Withdrawals, payouts, production signing, and production financial features remain disabled until their protocol and security gates are satisfied.
- SilverPay must not make a trusted RPC response look like a cryptographic proof or verified finality.
- SilverScan must distinguish BTCS L1 from BTCS L2 data and must distinguish trusted/indexed data from verified settlement data.
- SilverForge and Silver Scan keep their own release evidence; a shared brand is not an integration proof.

## Repository impact

- **Code:** no project code currently imports or calls `silver-wallet`; no destructive rename is required.
- **UI labels:** no current product UI label uses “Silver Wallet”. Wallet-related generic labels remain valid.
- **Dependencies:** no package or build dependency references the empty sibling repository.
- **Documentation:** the roadmap, whitepaper product map, work queue, release checklist, client integration plan, and handoffs are updated to use SilverPay Wallet and SilverPay Payments terminology.

## Acceptance gates

SilverPay's initial wallet and account functionality is not complete until the required local journey runs end to end against real services:

`create/deploy an asset → see it in SilverPay → inspect it in Silver Scan → send from account A to B → receive and verify → restart → verify again`

Only the read-only L1/L2 observation part of this journey exists. The acceptance
gate is therefore unmet; see `docs/PUBLIC-RELEASE-STAGES.md`.

The NFT journey and the separate L1/L2 identity checks must also pass. SilverPay Payments remains planned until its own acceptance criteria and security review exist.
