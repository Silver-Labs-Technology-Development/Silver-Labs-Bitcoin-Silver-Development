# BTCS L2 — Experimental Trusted Single-Operator Prototype

**Status:** Experimental development prototype. **NOT for production or real funds.**

## Overview

BTCS L2 is an experimental EVM-compatible Layer 2 prototype for Bitcoin Silver (BTCS). This is a **trusted single-operator model** where a single operator sequences transactions, maintains canonical L2 history, and authorizes withdrawals. L1 anchors and data publication provide evidence and recovery material, but do **not** cryptographically enforce correct L2 execution.

**SilverPay product direction:** SilverPay is the unified Silver Labs wallet-and-payments product. SilverPay Wallet is Phase 1 and the initial priority; SilverPay Payments is Phase 2 and remains planned. The separate Silver Wallet product is retired and is not a dependency. SilverForge and Silver Scan remain separate integrated products. See [the SilverPay ADR](docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md).

## Key Features
- Local EVM execution engine (EthereumJS-based)
- JSON-RPC server with development sequencer
- L1 deposit discovery and tracking
- Settlement batch creation and L1 data publication
- Batch reconstruction and clean-node recovery
- Withdrawal lifecycle management (request → authorize → payout → confirm)
- Operator-controlled, chain-guarded payout adapter (disabled by default)
- SilverPay read-only loopback service for separate L1 UTXO/balance and L2 account/network reads

## Quick Start (Developer Node)

### Prerequisites
- Node.js 24.17.0 (use nvm: `nvm use 24.17.0` or set PATH)
- Git

### Installation
```bash
cd btcs-l2/execution/evm
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
npm ci
npm run typecheck
npm test
```

### Start Development Node
```bash
# Start RPC server with dev sequencer
npm run rpc -- --datadir /tmp/btcs-l2-node --port 8545 --dev-sequencer
```

### Use the Node
```bash
# Check chain ID
curl -sS http://127.0.0.1:8545/ -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'

# Mine a block (with dev sequencer)
curl -sS http://127.0.0.1:8545/ -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"btcs_dev_mine","params":[]}'
```

### Run SilverPay read-only service

```bash
SILVERPAY_L1_RPC_URL=http://127.0.0.1:18443 \
SILVERPAY_L1_COOKIE_FILE="$HOME/.bitcoinsilver/regtest/.cookie" \
SILVERPAY_L2_RPC_URL=http://127.0.0.1:8545 \
node services/silverpay-service/src/server.mjs
```

The service binds `127.0.0.1:3002` by default. It is read-only: no keys, signing,
send/receive, recovery, history, payments, or write RPC methods. See
[services/silverpay-service/README.md](services/silverpay-service/README.md).
The Studio SilverPay page shows separate L1/L2 state and explicit unavailable
states; it is not a complete wallet.

### Run Integrated Demo
```bash
npx tsx scripts/integrated-e2e.ts
```

## Documentation
- [EVM Harness README](execution/evm/README.md)
- [Integrated Prototype Runbook](docs/INTEGRATED-PROTOTYPE-RUNBOOK.md)
- [Withdrawal Protocol](docs/WITHDRAWAL-EXIT-PROTOCOL-v0.1.md)
- [Security Gap Register](docs/SECURITY-GAP-REGISTER.md)
- [Public-Release Stages 1–5](docs/PUBLIC-RELEASE-STAGES.md)
- [SilverPay read-only service](services/silverpay-service/README.md)
- [Architecture Decision Record: Trust Model](docs/ARCHITECTURE-DECISION-RECORD-2026-10-22.md)
- [Architecture Decision Record: SilverPay](docs/ARCHITECTURE-DECISION-RECORD-SILVERPAY-2026-10-22.md)

## Security Limitations (IMPORTANT)
- **Trusted Operator:** Canonical sequencing and withdrawal authorization require trust in the operator
- **No Trustless Verification:** Deposit/anchor confirmation verifies a local partial Merkle proof when the RPC exposes `gettxoutproof`, but the header and active-chain view still come from the trusted L1 RPC. Canonical/most-work selection, peer consensus, and finality are not implemented. A verified partial proof is not canonical membership.
- **Anchors Not Proofs:** L1 anchors and data publication do not prove correct L2 execution
- **Payouts Disabled by Default:** L1 payout adapter is disabled; requires explicit opt-in with chain validation
- **Regtest Only:** All payout functionality is designed for isolated regtest only
- **Not Production Ready:** This prototype is not suitable for real funds

## Testing
```bash
npm run typecheck
npm test
```

Current status: the EVM suite passed 366 tests (365 pass, 1 skipped live BNB, 0 fail, 187.3s) on Node v24.17.0 on 2026-10-22. The SG-01 focused confirmation/deposit/store/header/workflow set passed 60/60; the SilverPay service passed 15/15, Studio adapter 6/6, and the Studio production build passed. Asset-service tests passed 82/82 and contracts 18/18 (including 13 BSNA-FTS1 conformance tests). This is local prototype evidence, not a production certification. The local prototype remains PARTIAL; public developer test, production readiness, and public production release are separate gated statuses. See `docs/PUBLIC-RELEASE-STAGES.md` and `docs/ALPHA-RELEASE-CHECKLIST.md`.
