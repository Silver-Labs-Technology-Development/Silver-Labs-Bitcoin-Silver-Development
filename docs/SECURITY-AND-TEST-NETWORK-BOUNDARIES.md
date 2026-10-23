# BTCS L2 Alpha — Security & Test Network Boundaries

**Version:** Alpha (commit `148d14f` + uncommitted work)  
**Date:** 2026-10-22  
**Audience:** Developers, testers, auditors

---

## 1. Security Model Summary

BTCS L2 is a **trusted single-operator prototype**. It does not provide trustless guarantees. The following boundaries are enforced by design and must not be crossed in this alpha.

---

## 2. Absolute Prohibitions (Never Do These)

| Prohibition | Enforcement | Reason |
|-------------|-------------|--------|
| **Enable withdrawals/payouts** | `withdrawalService.ts` requires both `BTCS_ENABLE_WITHDRAWALS=true` AND `BTCS_WITHDRAWALS_UNSAFE=true`; `canProcessPayout()` hard-coded `false` | No trustless exit exists; payouts would be operator-controlled |
| **Set `BTCS_ENABLE_WITHDRAWALS` or `BTCS_WITHDRAWALS_UNSAFE`** | Environment variables not set; code checks both | Would enable unsafe payout path |
| **Deploy to production networks** | Deployment policy `mainnet-disabled` for Ethereum/BNB mainnet | Asset engine throws before sending |
| **Use real funds or production keys** | Dev key `0x11...` is public test key in repo | No real value should be at risk |
| **Modify BTCS L1 consensus** | `btcs-core` not modified by L2 sessions | L1 remains Bitcoin Silver Core |
| **Claim trustless settlement** | Local partial Merkle proof verification is integrated only when `gettxoutproof` is available; the header/active chain is still trusted. No fraud/validity proofs or forced inclusion | SG-01 canonical selection, SG-02, SG-03 open |
| **Expose RPC publicly** | Binds `127.0.0.1` only; rejects non-loopback | Dev safety boundary |
| **Store private keys in browser** | All existing signing is in the asset service; the SilverPay read-only service has no signing or key material | Architecture invariant |

---

## 3. Network Boundaries

### 3.1 Supported Networks (Alpha)

| Network | Chain ID | Status | Gas | RPC Config |
|---------|----------|--------|-----|------------|
| **BTCS L2 Local** | 31337 (0x7a69) | ✅ **Primary** | BTCS | `BTCS_L2_RPC_URL` (default: `http://127.0.0.1:8545`) |
| Ethereum Sepolia | 11155111 | ⚠️ Configured, not tested | ETH | `ETH_SEPOLIA_RPC_URL` (required) |
| Ethereum Mainnet | 1 | 🚫 Disabled | ETH | `ETH_MAINNET_RPC_URL` (deployment blocked) |
| BNB Testnet | 97 | ⚠️ Configured, not tested | tBNB | `BNB_TESTNET_RPC_URL` + `BNB_TESTNET_PRIVATE_KEY` |
| BNB Mainnet | 56 | 🚫 Disabled | BNB | `BNB_MAINNET_RPC_URL` (deployment blocked) |

### 3.2 Network Isolation Guarantees

- **Asset engine enforces chain separation**: `refuseCrossChainLink()` throws if an asset recorded on one network is used on another
- **Registry is network-scoped**: `DeploymentRegistry.list(networkId)` filters by network
- **Signer validates network**: `PrivateKeySigner.sign()` checks `feeQuote.networkId === profile.id`
- **Connection validates chain ID**: `validateConnection()` rejects mismatched `eth_chainId`
- **BTCS local requires `BTCSL2/` client banner**: Rejects generic chain ID 31337

### 3.3 What Crosses Network Boundaries (Intentionally)

| Data | Direction | Control |
|------|-----------|---------|
| Wallet `wallet_addEthereumChain` params | Asset engine → Studio → MetaMask | User must approve in wallet |
| Wallet `wallet_switchEthereumChain` | Asset engine → Studio → MetaMask | User must approve in wallet |
| Network configuration (chain ID, gas symbol, RPC URL) | Asset engine → Studio | Read-only display |

---

## 4. Test Network Rules

### 4.1 Local Development (Primary Alpha Environment)

| Component | Network | Access |
|-----------|---------|--------|
| L2 EVM RPC | `http://127.0.0.1:8545` | Localhost only |
| Asset Service | `http://127.0.0.1:3001` | Localhost only |
| SilverPay read-only service | `http://127.0.0.1:3002` | Loopback only; GET-only reads; no keys or writes |
| Studio Dev Server | `http://127.0.0.1:5173` | Localhost only |
| L1 Regtest (optional) | `http://127.0.0.1:18443` (default) or an explicit override such as `29444` | Localhost only |

**All services bind `127.0.0.1` — no external access.**

### 4.2 External Testnets (Not Active in Alpha)

| Network | Required Config | Status |
|---------|----------------|--------|
| Ethereum Sepolia | `ETH_SEPOLIA_RPC_URL` | Not configured |
| BNB Testnet | `BNB_TESTNET_RPC_URL` + `BNB_TESTNET_PRIVATE_KEY` | Not configured |

**Do not configure these for alpha testing.** The alpha is validated against the local BTCS L2 environment only.

### 4.3 Regtest L1 (Optional for Deposit/Settlement Tests)

If testing deposit/settlement workflows:

```bash
# Requires bitcoinsilverd built with regtest support
bitcoinsilverd -regtest -daemon \
  -rpcuser=test -rpcpassword=test \
  -rpcport=18443 \
  -fallbackfee=0.0002
```

- Wallet must have ≥201 mature coinbases for `e2e:batch-data`
- `e2e:deposit` mines 201 blocks for coinbase maturity
- All regtest data in `~/.bitcoinsilver/regtest/` (gitignored)

---

## 5. Credential Handling

| Credential | Location | Alpha Status |
|------------|----------|--------------|
| L2 dev private key (`0x11...`) | Hardcoded in asset engine, repo | Public test key — **no value** |
| L1 RPC cookie | Configurable via `SILVERPAY_L1_COOKIE_FILE` / Core datadir `regtest/.cookie` | Gitignored, local only; SilverPay reads it at startup and never returns it |
| Asset service IPFS auth | `ASSET_IPFS_AUTH_TOKEN` / user+pass | Not configured |
| BNB testnet private key | `BNB_TESTNET_PRIVATE_KEY` env var | Not set |
| Ethereum testnet private key | Not used (service-side signing) | N/A |

**Never commit credentials.** The repo `.gitignore` excludes:
- `.regtest/`
- `.asset-store/`
- `.asset-engine-registry/`
- `*.cookie`
- `wallet.dat`

---

## 6. Signing Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    BROWSER (Studio)                         │
│  • No private keys                                          │
│  • Sends deployment request to Asset Service                │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS POST /api/asset-engine/deploy
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                 ASSET SERVICE (Node.js)                     │
│  • Receives deployment request                              │
│  • Calls AssetEngineService.deployFungible()                │
│  • AssetEngineService uses PrivateKeySigner (dev key)       │
│  • Signs transaction, submits to L2 RPC                     │
│  • Waits for receipt, verifies on-chain                     │
│  • Persists to DeploymentRegistry                           │
└─────────────────────────┬───────────────────────────────────┘
                          │ JSON-RPC (eth_sendRawTransaction, etc.)
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    L2 EVM RPC (127.0.0.1:8545)              │
│  • Validates transaction                                    │
│  • Executes in VM (btcs_dev_mine for dev sequencer)         │
│  • Returns receipt                                          │
└─────────────────────────────────────────────────────────────┘
```

**Key invariant:** Private key never leaves the Asset Service process.

### 6.1 SilverPay read-only service boundary

The SilverPay service is a separate loopback gateway for the Phase 1 read-only
wallet view. It holds no keys and exposes only allowlisted GET/read methods:

- L1 reads use the configured Core RPC with optional cookie/user-password auth.
- L2 reads use the configured L2 JSON-RPC endpoint.
- Browser origins are explicitly allowlisted; there is no generic proxy.
- The service itself has no authentication or TLS. Do not bind it to a
  non-loopback address or expose it through a reverse proxy.
- L1 wallet values trust Core RPC and its active-chain/wallet view. L2 values
  trust the L2 RPC. There is no canonical L1 proof, L2 state proof, or finality
  check in this service.
- L1 and L2 balances are separate. There is no transfer, signing, send,
  receive, recovery, history, token/NFT, or payment capability.

---

## 7. Data Classification

| Data | Classification | Handling |
|------|----------------|----------|
| Dev private key (`0x11...`) | **Public test credential** | In repo, no value |
| L1 RPC cookie | **Local secret** | File, 0600, gitignored |
| Deployed contract addresses | **Public** | On-chain, queryable |
| Transaction hashes | **Public** | On-chain, queryable |
| Asset metadata (name, symbol, logo) | **Public** | IPFS/local, queryable |
| User-provided logo images | **User data** | Stored per storage provider |
| Regtest wallet.dat | **Local secret** | Gitignored, never shared |

---

## 8. Incident Response (Alpha)

| Scenario | Response |
|----------|----------|
| Accidental real-fund deposit | **Do not use this alpha for real funds.** No recovery mechanism. |
| Private key exposure (dev key) | Key is public; rotate if used for value (should not happen). |
| RPC exposed externally | Firewall `127.0.0.1` only; do not reverse proxy. |
| Asset service storage corrupted | Delete `.asset-store` and `.asset-engine-registry`, restart. |
| L2 chain data corrupted | Delete datadir (`/tmp/btcs-l2-test-data`), restart. |

---

## 9. Compliance Checklist for Testers

Before testing, confirm:

- [ ] Using only local networks (`127.0.0.1`)
- [ ] No real funds or production keys anywhere
- [ ] `BTCS_ENABLE_WITHDRAWALS` not set
- [ ] `BTCS_WITHDRAWALS_UNSAFE` not set
- [ ] L1 regtest only (if used)
- [ ] No credentials committed to repo
- [ ] Understanding that this is a **trusted prototype**, not a trustless system

---

## 10. Escalation

| Issue | Contact |
|-------|---------|
| Security vulnerability | Repository owner (Joshua) |
| Safety boundary violation | Stop testing immediately |
| Data loss / corruption | Reset per Section 8 |
| Unexpected network write | Check RPC bind address; report |

---

## 11. Reference Documents

| Document | Purpose |
|----------|---------|
| `docs/SECURITY-GAP-REGISTER.md` | Honest gap inventory (SG-01 through SG-13) |
| `docs/PUBLIC-RELEASE-STAGES.md` | Public-release Stage 1–5 gates and independent statuses |
| `services/silverpay-service/README.md` | Read-only service boundary, endpoints, and limits |
| `docs/ARCHITECTURE-DECISION-RECORD-2026-10-22.md` | Interim trusted model decision |
| `docs/WORK-QUEUE.md` | Task register with security-related tasks |
| `docs/BTCS-L2-FULL-PROJECT-AUDIT-2026-10-22.md` | Implementation vs security audit |

---

**This document defines the security and network boundaries for the BTCS L2 alpha. Any deviation requires explicit owner approval and must be documented.**