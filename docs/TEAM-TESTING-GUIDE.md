# BTCS L2 Alpha — Team Testing Guide

**Version:** Alpha (commit `148d14f` + uncommitted work)  
**Date:** 2026-10-22  
**Scope:** Local developer testing only. No production use. No real funds.

---

## 1. What This Alpha Provides

A working local BTCS L2 development environment with:

- **EVM execution engine** (`execution/evm/`) — runs on EthereumJS VM (Osaka hardfork), chain ID 31337, BTCS as native gas
- **Asset engine** (`execution/evm/src/assetEngine/`) — multi-network deployment, fee estimation, registry persistence
- **Asset service** (`services/asset-service/`) — HTTP API for logo/metadata upload, local storage
- **SilverForge Studio** (`studio/`) — React/Vite GUI for token creation, deployment, inspection
- **SilverPay read-only service** (`services/silverpay-service/`) — loopback HTTP gateway for separate L1 Core wallet/UTXO and L2 account/network reads
- **L1 integration** — deposit watching, settlement batch publication, anchor confirmation (regtest only; local partial proof verification when `gettxoutproof` is available)

**Supported workflows:**
- Create ERC-20 or BSNA-FTS1 fungible tokens on BTCS L2 local
- Choose BSNA-FTS1 fixed or authorized-mint supply, holder burn, admin pause, and optional mutable metadata
- Mint authorized-supply BSNA-FTS1 tokens through the asset engine
- Upload token logos (PNG, JPEG, GIF, WebP ≤5MB, ≤2000×2000px)
- Estimate deployment fees before submitting
- Deploy through asset engine with real transaction receipts
- View deployment receipts with contract address, tx hash, gas used, logs
- Inspect deployed tokens and their metadata
- Monitor L2 node status (blocks, chain ID, gas price, peers)
- Monitor L1 node status (regtest block height)
- View separate real L1 UTXOs/balance and L2 account/network state in the SilverPay read-only page
- See explicit loading, unavailable, stale, and partial states instead of mocked values

**Not yet supported:**
- NFT (ERC-721 / BSNA-721) creation — the tab is disabled because no reference bytecode exists
- MetaMask wallet connection (service-side signing only)
- External testnet deployment (BNB testnet requires credentials)
- Studio controls for burn, pause, setMinter, or setMetadata (available in the contract, not the GUI)
- Contract verification / explorer integration
- SilverPay signing, send/receive, recovery, account switching, transaction history, token/NFT balances, or payments
- Silver Scan explorer/indexer
- Withdrawals, payouts, fraud proofs, forced inclusion (disabled by design)

---

## 2. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 24.17.0 | Required by `engines` field. Use nvm. |
| npm | 11.13.0 | Comes with Node 24.17.0 |
| bitcoinsilverd | Custom build | For L1 regtest (optional for pure L2 testing) |

**Node setup:**
```bash
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
```

Verify:
```bash
node --version  # v24.17.0
npm --version   # 11.13.0
```

---

## 3. Installation

```bash
# From repository root
cd ~/Silver-Labs/btcs-l2

# Install EVM dependencies
cd execution/evm
npm install

# Install asset service dependencies
cd ../../services/asset-service
npm install

# Install Studio dependencies
cd ../../studio
npm install
```

---

## 4. Running the Stack

### 4.1 Start L1 (optional — for deposit/settlement tests)

```bash
# Requires bitcoinsilverd with regtest=1, server=1, RPC credentials
# Default datadir: ~/.bitcoinsilver/regtest
# Default RPC port: 18443

bitcoinsilverd -regtest -daemon
```

### 4.2 Start L2 EVM RPC Server

```bash
cd ~/Silver-Labs/btcs-l2/execution/evm

# Create isolated data directory
mkdir -p /tmp/btcs-l2-test-data

# Start with development sequencer (enables btcs_dev_mine)
npm run rpc -- --datadir /tmp/btcs-l2-test-data --dev-sequencer
```

Output:
```
BTCS L2 local RPC listening at http://127.0.0.1:8545 (development sequencer enabled)
```

### 4.3 Start Asset Service

```bash
cd ~/Silver-Labs/btcs-l2/services/asset-service

# Uses local-dev storage at .asset-store by default
npm start
```

Output:
```
BTCS asset service listening at http://127.0.0.1:3001
  upload route: POST http://127.0.0.1:3001/api/assets/images
  storage provider: local-dev (local-only, portable: false)
```

### 4.4 Start SilverPay read-only service

The service is optional for token deployment and required for the SilverPay
Wallet read-only page. It has no npm dependencies.

```bash
cd ~/Silver-Labs/btcs-l2

SILVERPAY_L1_RPC_URL=http://127.0.0.1:18443 \
SILVERPAY_L1_COOKIE_FILE="$HOME/.bitcoinsilver/regtest/.cookie" \
SILVERPAY_L2_RPC_URL=http://127.0.0.1:8545 \
node services/silverpay-service/src/server.mjs
```

If the local Core RPC uses a non-default datadir or port (for example
`127.0.0.1:29444`), override `SILVERPAY_L1_RPC_URL` and
`SILVERPAY_L1_COOKIE_FILE`. The default bind is `127.0.0.1:3002`. Do not expose
it or set a non-loopback bind. See `services/silverpay-service/README.md`.

### 4.5 Start Studio

```bash
cd ~/Silver-Labs/btcs-l2/studio

# Development mode with hot reload
npm run dev
```

Or build for production:
```bash
npm run build
npx serve dist  # or any static server
```

Studio will be available at `http://localhost:5173` (dev) or your static server port.

---

## 5. Verifying Services

| Service | Health Check | Expected |
|---------|--------------|----------|
| L2 RPC | `curl -X POST http://127.0.0.1:8545 -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'` | `{"jsonrpc":"2.0","id":1,"result":"0x7a69"}` |
| L2 RPC | `curl ... -d '{"method":"web3_clientVersion"}'` | Must start with `BTCSL2/` |
| Asset Service | `curl http://127.0.0.1:3001/healthz` | `{"ok":true,"status":"ready",...}` |
| Asset Service | `curl http://127.0.0.1:3001/api/asset-engine/networks` | Lists 5 networks with `configured` status |
| SilverPay service | `curl http://127.0.0.1:3002/healthz` | `{"ok":true,"readOnly":true,...}` without credentials |
| SilverPay service | `curl http://127.0.0.1:3002/api/silverpay/status` | Separate L1/L2 status; an unavailable L2 is reported as unavailable, not zero |

---

## 6. Supported Test Workflows

### 6.1 Create and Deploy a Fungible Token (ERC-20 / BSNA-FTS1)

1. Open Studio → **Token Studio** → **ERC-20 / BSNA-FTS1** tab
2. Select network: **BTCS L2 local development** (pre-connected)
3. Fill form:
   - Token Name: `Test Token`
   - Token Symbol: `TEST`
   - Decimals: `18`
   - Initial Supply (atomic): `1000000`
   - Supply Policy: `Fixed` (or `Authorized Mint`)
   - Required: token logo upload (the Studio, HTTP route, and engine service
     reject deployment without it)
   - Description and External URL are currently optional
4. Click **Estimate Fees** → verify gas estimate and native fee
5. Click **Deploy Token**
6. Wait for success → **Deployment Receipt** modal appears with:
   - Transaction hash, contract address, chain ID, network
   - Block number, gas used, effective gas price
   - Fee estimate vs actual
   - Contract details (name, symbol, decimals, supply, owner)
   - Metadata and logo links
   - Full JSON (expandable)

### 6.2 View Deployed Tokens

1. Go to **My Tokens** tab
2. See all deployed tokens with logos, addresses, supply, owner, deploy tx
3. Click **Inspect Contract** for full JSON
4. Click **View Metadata** to see asset service metadata document

### 6.3 Monitor Node Status

1. **Dashboard** — L2 block number, chain ID, gas price, RPC methods status
2. **Nodes** — L1 regtest height, L2 client version, block number
3. **Transactions** — Last 10 blocks with tx details (hash, from, to, value, gas, status)

### 6.4 Mine Blocks (Dev)

- Dashboard → **Mine Block (Dev)** calls `btcs_dev_mine`
- Transactions page auto-refreshes to show new blocks/txns

---

### 6.2 View SilverPay read-only L1/L2 state

1. Start the L2 RPC and the SilverPay service (sections 4.2 and 4.4).
2. Open Studio → **SilverPay Wallet**.
3. Confirm the L1 panel shows the Core network, wallet name, balance, and UTXO
   count from the configured Core wallet.
4. Confirm the L2 panel shows the configured chain and an account field. Enter a
   disposable `0x...` address to read its balance/nonce; do not use a real-value
   account.
5. Stop the L2 RPC and refresh. The L2 panel must show unavailable/error, not a
   fabricated zero balance. L1 may remain available; that is a partial state.
6. Try to use signing, send, receive, recovery, history, or payments: those
   controls/features must not exist or must be labeled unavailable.

Do not use this page as proof of wallet completion, payment completion, canonical
L1 inclusion, or finality.

## 7. Running Automated Tests

```bash
# EVM tests (core execution, asset engine, RPC, gas, deposits, settlement)
cd ~/Silver-Labs/btcs-l2/execution/evm
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
npx tsc --noEmit  # type check
npm test          # full EVM suite

# Asset service tests
cd ~/Silver-Labs/btcs-l2/services/asset-service
npm test
npm run test:contracts

# SilverPay service tests
cd ~/Silver-Labs/btcs-l2
node --test services/silverpay-service/tests/*.test.mjs

# Studio adapter tests and build
cd ~/Silver-Labs/btcs-l2/studio
node --test src/lib/silverpay.test.js
npm run build
```

**Expected results (as of 2026-10-22):**
- EVM full suite: 366 tests, 365 pass, 1 skipped (live BNB), 0 fail, 187.3s
- SG-01 focused confirmation/deposit/store/header/workflow: 60/60
- SilverPay service: 15/15
- SilverPay Studio adapter: 6/6
- Asset service: 82/82
- Asset service contracts: 18/18 including BSNA-FTS1 13/13
- Studio build: success (~74 kB gzipped)

---

## 8. Known Limitations

| Area | Limitation | Workaround / Status |
|------|------------|---------------------|
| NFT creation | Disabled; no audited ERC-721 reference bytecode or integrated deploy/mint path | See BTCS-L2-GUI-014 |
| SilverPay Wallet | Read-only L1/L2 slice only; no signing, send/receive, recovery, history, tokens/NFTs, account switching, or payments | See LIM-GUI-009 and the service README |
| SilverPay service | Loopback-only, no authentication/TLS; trusts configured Core/L2 RPC; no canonical L1 proof or L2 state proof | Do not expose; do not treat reads as verified settlement |
| MetaMask | No wallet connection UI | Service-side signing only (dev key) |
| External testnets | BNB testnet needs `BNB_TESTNET_RPC_URL` + `BNB_TESTNET_PRIVATE_KEY` | Not configured in alpha |
| BSNA-FTS1 | Implemented additively as the settled name; not a ratified external standard | See `docs/BSNA-FTS1-PROPOSAL.md` |
| Contract verification | No explorer integration | Verification status: `unsupported` / `not-submitted` |
| Withdrawals | Hard-disabled (`canProcessPayout() === false`) | By design — security gate |
| L1 settlement | Regtest only; local partial proof verification, but canonical most-work selection/finality open | See SG-01 and the security gap register |
| Persistence | Unmined pool txns lost on restart | Documented limitation |
| Chain ID | 31337 collides with Hardhat/Anvil | Local dev only |

See `docs/KNOWN-LIMITATIONS.md` for full list.

---

## 9. Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| `eth_chainId` returns wrong value | Wrong RPC endpoint | Verify Studio connects to `http://127.0.0.1:8545` |
| `web3_clientVersion` missing `BTCSL2/` | EVM RPC not started with `--dev-sequencer` | Restart with `--dev-sequencer` |
| Asset service `503` on upload | Storage not configured | Check `ASSET_STORAGE_PROVIDER=local-dev` |
| Studio shows "Asset service not available" | Asset service not running on 3001 | Start asset service |
| Deployment fails "insufficient BTCS" | Dev account out of gas | Mine blocks to accrue fees, or restart with fresh datadir |
| `btcs_dev_mine` returns error | Dev sequencer not enabled | Start RPC with `--dev-sequencer` |
| NFT deploy fails | Placeholder bytecode | Known limitation — uses `0x` bytecode |

---

## 10. Reporting Bugs

Use `docs/BUG-REPORT-TEMPLATE.md` and include:

1. **Environment**: OS, Node version, commit hash
2. **Steps to reproduce**: Exact clicks, inputs, commands
3. **Expected vs actual**: What should happen vs what happened
4. **Logs**: Browser console, terminal output, service logs
5. **Service status**: Output of health checks from Section 5

---

## 11. Security Boundaries

- **No private keys in browser** — all signing via asset service (dev key `0x11...`)
- **No production writes** — L1 regtest only, L2 local only
- **Withdrawals disabled** — `BTCS_ENABLE_WITHDRAWALS` and `BTCS_WITHDRAWALS_UNSAFE` both required (not set)
- **No bridge** — cross-chain links refused by `refuseCrossChainLink()`
- **Local RPC only** — binds `127.0.0.1`, no CORS for unknown origins

---

## 12. Resetting Test State

```bash
# Reset L2 chain data
rm -rf /tmp/btcs-l2-test-data

# Reset asset service storage
rm -rf ~/Silver-Labs/btcs-l2/services/asset-service/.asset-store
rm -rf ~/Silver-Labs/btcs-l2/services/asset-service/.asset-engine-registry

# Reset Studio (no persistent state)
# Just restart dev server
```

---

## 13. Architecture References

| Document | Purpose |
|----------|---------|
| `docs/BTCS-L2-TECHNICAL-WHITEPAPER-v1.2.md` | Authoritative architecture |
| `docs/BTCS-L2-WHITEPAPER-V1.5-ALIGNMENT-2026-10-22.md` | v1.5 vs implementation gaps |
| `docs/SECURITY-GAP-REGISTER.md` | Honest security gap inventory |
| `docs/BSNA-FTS1-PROPOSAL.md` | Fungible token standard proposal |
| `docs/BSNA-STANDARD-PROPOSAL.md` | BSNA recognition layer |
| `docs/WORK-QUEUE.md` | Master task register |

---

## 14. Quick Reference Commands

```bash
# Full test suite (EVM)
cd ~/Silver-Labs/btcs-l2/execution/evm
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
npx tsc --noEmit && npx tsx --test tests/*.test.ts

# Asset service tests
cd ~/Silver-Labs/btcs-l2/services/asset-service
npm test && npm run test:contracts

# Studio build
cd ~/Silver-Labs/btcs-l2/studio
npm run build

# Start all services (manual)
# Terminal 1: L1 (if needed)
bitcoinsilverd -regtest -daemon
# Terminal 2: L2
cd ~/Silver-Labs/btcs-l2/execution/evm && npm run rpc -- --datadir /tmp/btcs-l2-data --dev-sequencer
# Terminal 3: Asset service
cd ~/Silver-Labs/btcs-l2/services/asset-service && npm start
# Terminal 4: Studio
cd ~/Silver-Labs/btcs-l2/studio && npm run dev
```

---

**End of Team Testing Guide**

*This alpha is for internal developer testing only. Do not use with real funds or on production networks.*