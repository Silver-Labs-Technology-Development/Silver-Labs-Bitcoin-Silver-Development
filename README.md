# BTCS L2 — Experimental Trusted Single-Operator Prototype

**Status:** Experimental development prototype. **NOT for production or real funds.**

## Overview

BTCS L2 is an experimental EVM-compatible Layer 2 prototype for Bitcoin Silver (BTCS). This is a **trusted single-operator model** where a single operator sequences transactions, maintains canonical L2 history, and authorizes withdrawals. L1 anchors and data publication provide evidence and recovery material, but do **not** cryptographically enforce correct L2 execution.

## Key Features
- Local EVM execution engine (EthereumJS-based)
- JSON-RPC server with development sequencer
- L1 deposit discovery and tracking
- Settlement batch creation and L1 data publication
- Batch reconstruction and clean-node recovery
- Withdrawal lifecycle management (request → authorize → payout → confirm)
- Operator-controlled, chain-guarded payout adapter (disabled by default)

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

### Run Integrated Demo
```bash
npx tsx scripts/integrated-e2e.ts
```

## Documentation
- [EVM Harness README](execution/evm/README.md)
- [Integrated Prototype Runbook](docs/INTEGRATED-PROTOTYPE-RUNBOOK.md)
- [Withdrawal Protocol](docs/WITHDRAWAL-EXIT-PROTOCOL-v0.1.md)
- [Security Gap Register](docs/SECURITY-GAP-REGISTER.md)
- [Architecture Decision Record](docs/ARCHITECTURE-DECISION-RECORD-2026-10-22.md)

## Security Limitations (IMPORTANT)
- **Trusted Operator:** Canonical sequencing and withdrawal authorization require trust in the operator
- **No Trustless Verification:** L1 RPC observations are trusted (no SPV/cryptographic proof)
- **Anchors Not Proofs:** L1 anchors and data publication do not prove correct L2 execution
- **Payouts Disabled by Default:** L1 payout adapter is disabled; requires explicit opt-in with chain validation
- **Regtest Only:** All payout functionality is designed for isolated regtest only
- **Not Production Ready:** This prototype is not suitable for real funds

## Testing
```bash
npm run typecheck
npm test
```

Current status: 293 tests passing (as of 2026-10-22)
