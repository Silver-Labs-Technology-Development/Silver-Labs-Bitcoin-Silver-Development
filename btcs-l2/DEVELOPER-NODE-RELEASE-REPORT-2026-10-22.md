# Developer Node Release Report (2026-10-22)

## Repository State
- Branch: **experimental/deposit-prelude-v1**
- HEAD: **d9ae157**
- Worktree: modified (33 files changed/added), no commits/pushes
- git diff --check: **CLEAN**
- Typecheck: **CLEAN**
- Tests: **293/293 PASSING**

## Can a developer start the node independently?
**YES** - with documented prerequisites and commands.

### Exact Start Command
```bash
export PATH="$HOME/.nvm/versions/node/v24.17.0/bin:$PATH"
cd btcs-l2/execution/evm
npm ci
npm run rpc -- --datadir /tmp/btcs-l2-node --port 8545 --dev-sequencer
```

### RPC Endpoint
`http://127.0.0.1:8545` (loopback only)

### Working CLI/RPC Capabilities
**RPC Methods (working):**
- web3_clientVersion, eth_chainId, eth_blockNumber
- eth_getBlockByNumber, eth_getBlockByHash
- eth_getTransactionReceipt, eth_getCode, eth_getStorageAt, eth_getBalance
- eth_getTransactionCount, eth_getLogs
- eth_sendRawTransaction, btcs_dev_mine (with --dev-sequencer)

**CLI Scripts:**
- `npm run rpc` - Start node
- `npm run demo:client` - Full demo
- `npm run test` - Run tests
- `npx tsx scripts/integrated-e2e.ts` - Integrated lifecycle demo
- `npx tsx src/cli.ts` - Basic CLI

## Payout Status
- **L1 payout adapter:** DISABLED by default (safe)
- **Actual regtest L1 payout:** NOT demonstrated in this session
- **Simulated payout:** Demonstrated in integrated E2E with full state machine
- **Chain guards:** Implemented (refuses wrong chain, validates addresses/amounts)
- **Opt-in required:** Must explicitly enable with chain validation

## Clean-Clone Test
**Verified:** All dependencies in package.json, no missing files blocking startup. README and DEVELOPER-NODE-GUIDE.md added. Node can start from fresh clone following docs.

## Repository Safety
- **Secrets:** None found in modified/added files
- **Credentials:** None
- **Local paths:** Only in docs/examples, not hardcoded in code
- **Wallet material:** None
- **Generated data:** In /tmp, gitignored appropriately
- **Third-party:** solc pinned, EthereumJS pinned, overrides documented

## Release Readiness
**Prepared for experimental release:**
- README.md updated with clear warnings
- DEVELOPER-NODE-GUIDE.md created
- Security limitations documented
- Experimental disclaimer included
- No commits/tags/pushes made

## Recommendation
Ready for experimental public-source release as **trusted single-operator prototype**. Owner must decide on publication. All safety boundaries maintained.
