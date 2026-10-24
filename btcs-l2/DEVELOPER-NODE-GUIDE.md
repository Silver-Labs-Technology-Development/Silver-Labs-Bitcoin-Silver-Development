# BTCS L2 Developer Node Guide

## Overview
This guide helps you run a local BTCS L2 development node independently. The node uses a trusted single-operator model for prototyping.

## Prerequisites
- Node.js 24.17.0
- Linux/macOS (tested on Linux)
- ~1GB disk space

## Setup
```bash
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
cd btcs-l2/execution/evm
npm ci
```

## Start the Node
```bash
# Create data directory and start
mkdir -p /tmp/btcs-l2-dev
npm run rpc -- --datadir /tmp/btcs-l2-dev --port 8545 --dev-sequencer
```

The node will listen on `http://127.0.0.1:8545`

## Available RPC Methods
- `web3_clientVersion`
- `eth_chainId` (returns 0x7a69 = 31337)
- `eth_blockNumber`
- `eth_getBlockByNumber`, `eth_getBlockByHash`
- `eth_getTransactionReceipt`
- `eth_getCode`, `eth_getStorageAt`, `eth_getBalance`
- `eth_getTransactionCount`
- `eth_getLogs`
- `eth_sendRawTransaction` (with --dev-sequencer)
- `btcs_dev_mine` (with --dev-sequencer)

## Quick Test
```bash
# In another terminal
curl -sS http://127.0.0.1:8545/ -H 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}'
```

## Demo Client
```bash
npm run demo:client
```

## Integrated E2E (includes withdrawals)
```bash
npx tsx scripts/integrated-e2e.ts
```

## Troubleshooting
- Ensure port is not in use
- Use only loopback (127.0.0.1)
- Data directory must be writable
- Node.js version must be 24.x

## Security Notes
- This is experimental, trusted single-operator prototype
- Do not use real funds
- Payouts are disabled by default
- Only use for development/testing
