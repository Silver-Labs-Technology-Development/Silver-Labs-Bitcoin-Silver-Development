# SilverPay read-only service

Local, loopback-only HTTP gateway for SilverPay's initial read-only wallet and
account experience. SilverPay is one unified wallet, account, and
digital-asset-management product; payment processing and merchant services
are later milestones. This gateway reads configured BTCS L1 Core wallet and
BTCS L2 EVM account state. It does not hold keys, sign, send, receive, recover
wallets, submit L2 transactions, or process payments.

## Status

The service is an implementation slice, not a production wallet or payment
service. It is intentionally narrow so the Studio can show real L1 and L2 reads
without exposing authenticated Core/L2 RPC endpoints to the browser.

Working now:

- L1 network identity and Core wallet balances/UTXOs via allowlisted read-only
  Core RPC methods.
- L2 chain identity and account balance/nonce/code via allowlisted read-only EVM
  RPC methods.
- Separate L1 UTXO and L2 EVM account payloads.
- Explicit loading, unavailable, stale, and partial states in the Studio page.
- Sanitized errors; credentials are never returned by `/healthz`.

Not implemented:

- Private-key handling, signing, sending, receiving, wallet recovery, account
  switching, or transaction history.
- Payments, invoices, checkout, settlement, bridge, or withdrawal flows.
- Independent consensus verification. L1 reads trust the configured Core RPC,
  including its active-chain view. L2 reads trust the configured L2 RPC.

## Requirements

- Node.js 24.17.x
- A running BTCS L1 Core node with an optional loaded wallet
- A running BTCS L2 EVM JSON-RPC endpoint
- The sibling `silver-labs-platform` checkout for the shared BTCS L2 client
  while its package has no approved remote/release

## Run

```bash
cd ~/Silver-Labs/btcs-l2/services/silverpay-service
npm ci
SILVERPAY_L1_RPC_URL=http://127.0.0.1:29444 \
SILVERPAY_L1_COOKIE_FILE="$HOME/.local/share/<datadir>/regtest/.cookie" \
SILVERPAY_L2_RPC_URL=http://127.0.0.1:8545 \
node src/server.mjs
```

The default bind is `127.0.0.1:3002`. Copy `.env.example` as a reference; do not
commit a real cookie file or credentials. The service reads the cookie at
startup, so restart it after Core rotates the cookie.

The L2 reader uses the shared read-only
`@silver-labs/btcs-l2-client` through the lockfile's local
`file:../../../silver-labs-platform/packages/btcs-l2-client` dependency. This
workspace link is not a published or portable SDK release. Do not replace it
with a guessed registry version; consume a reviewed, approved release only
after the platform remote and release process are authorized.

SilverPay uses the SDK's only registered profile, `BTCS_L2_LOCAL`. The SDK
checks explicit network identity schema v1, local profile ID
`btcs-l2-local`, chain ID `31337`, and the `BTCSL2/` client banner before any
normal read. Unsupported schema versions, profiles, or RPC identity are
reported as unavailable/invalid upstream responses. The schema check is
development-only and is not cryptographic authentication or proof of
consensus.

## Endpoints

All endpoints are read-only and GET-only.

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | Service health and non-secret configuration summary |
| `GET /api/silverpay/status` | Combined L1 network/wallet and L2 network status |
| `GET /api/silverpay/l1/wallet` | L1 wallet balances and unspent outputs |
| `GET /api/silverpay/l1/network` | L1 chain and peer state |
| `GET /api/silverpay/l2/network` | L2 chain, block, client, and listening state |
| `GET /api/silverpay/l2/account/0x...` | L2 balance, nonce, and contract state |

`status` returns partial results: L1 network can be available while the Core
wallet or L2 node is unavailable. A partial response is not a healthy full
wallet. The Studio page displays those failures rather than filling them in.

```bash
curl -sS http://127.0.0.1:3002/api/silverpay/status
curl -sS http://127.0.0.1:3002/api/silverpay/l1/wallet
curl -sS http://127.0.0.1:3002/api/silverpay/l2/account/0x0000000000000000000000000000000000000000
```

## Security boundary

- The service binds to a loopback host only.
- L1 and L2 URLs must be HTTP(S) and must not contain embedded credentials.
- L1 Core cookie/user-password authentication supports local Core RPC.
- L1 RPC methods are allowlisted in `src/server.mjs`; L2 RPC calls are limited
  to the shared read-only client's implemented methods. There is no generic
  proxy.
- Browser origins must be explicitly allowlisted.
- No keys, seeds, signing capabilities, or write RPC methods are present.
- The service itself has no authentication or TLS; do not expose it beyond
  loopback. A reverse proxy or remote access is outside this slice.

## Limits and release status

- L1 wallet values are only as trustworthy as the configured Core RPC and its
  wallet state. UTXO reads are capped at 500 entries with explicit truncation
  metadata.
- L2 values are only as trustworthy as the configured L2 RPC. This service does
  not verify block headers, state proofs, finality, or consensus.
- The L1 and L2 balances are not a unified spendable balance. No transfer path
  exists between them.
- This service is not approved for public testnet or production use. Public
  developer testing, production readiness, and production release remain
  separate gated stages.

## Test

```bash
cd ~/Silver-Labs/btcs-l2/services/silverpay-service
npm test
npm run check
```

With the local BTCS L2 RPC running, verify the real consumer path with:

```bash
SILVERPAY_L2_RPC_URL=http://127.0.0.1:8545 npm run test:integration
```

The integration test requires a loopback BTCS L2 local RPC and performs only
identity, block, and account reads. Until a release is authorized, another
product agent must use the documented sibling workspace checkout and run
`npm ci`; this does not establish a published package dependency.
