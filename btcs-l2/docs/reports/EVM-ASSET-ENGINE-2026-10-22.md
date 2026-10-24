# Shared EVM asset engine — 2026-10-22

Status: partial. This is not BNB Smart Chain compatibility and it is not production-ready.

## What was built

`execution/evm/src/assetEngine/` is a JSON-RPC client with separate profiles. It does not modify the canonical block processor, chain id `31337`, EIP-1559 signer defaults, BSNA contracts, or Studio. Studio's Deploy button still only sets a status string.

| Profile | Chain id | Gas symbol | Interface label | Deployment |
|---|---:|---|---|---|
| `btcs-l2-local` | 31337 | BTCS | erc-20 | local, requires a `BTCSL2/` client banner |
| `ethereum-sepolia` | 11155111 | ETH | erc-20 | testnet |
| `ethereum-mainnet` | 1 | ETH | erc-20 | disabled until `allowMainnet` |
| `bnb-smart-chain-testnet` | 97 | tBNB | bep-20 | testnet |
| `bnb-smart-chain-mainnet` | 56 | BNB | bep-20 | disabled until `allowMainnet` |

Profiles store an environment-variable name, not an RPC URL, and no private key. ERC-20 and BEP-20 in this engine are the same function selectors on `execution/evm/contracts/EvmFungibleAsset.sol`. A deployment id is `{network id}:{contract address}`. Supply is not shared. `refuseCrossChainLink()` throws. There is no bridge.

BTCS local gas stays on the existing type-2 defaults (`DEFAULT_MAX_FEE_PER_GAS` and `DEFAULT_MAX_PRIORITY_FEE_PER_GAS`) and `btcs_dev_mine`. Ethereum and BNB quotes follow the connected block and keep their own symbols: EIP-1559 when `baseFeePerGas` is present, including zero, otherwise legacy `eth_gasPrice`. The template is compiled with Solidity 0.8.37, `evmVersion` `london`, optimizer off, so the shared bytecode does not use PUSH0.

Token name, symbol, decimals, atomic supply, owner, fixed-supply permissions, a description, and a png/jpeg/gif/webp logo are stored in a local deployment registry. The logo URI is `registry-local:{sha256}`. It is not an IPFS upload and it is not the asset-service BSNA API. Explorer verification is `unsupported` on BTCS local and `not-submitted` elsewhere. No explorer API key is built in, and nothing is marked verified.

## What actually ran

Node v24.17.0.

Focused `npx tsx --test tests/assetEngine.test.ts` on the final tree: 9 pass, 1 skipped, 0 fail, `duration_ms` 22833.142478. The skip text is `live BNB testnet was not executed: BNB_TESTNET_RPC_URL and BNB_TESTNET_PRIVATE_KEY are unset`.

The local BTCS test started `src/rpcServer.ts` with `--dev-sequencer` and, through that process:

- deployed the template and read back name `Probe Token`, symbol `PRB`, decimals 8, atomic supply `1000000` (not scaled by decimals), and the owner
- transferred 1 atomic unit, then approved and used `transferFrom` only for an allowance held by the signer
- checked the native debit was `gasUsed * effectiveGasPrice` in the BTCS fee quote, and the zero-address coinbase credit was the priority-fee portion
- refused to send that asset id after switching the session to the BNB testnet profile
- refused to connect the BNB profile to the BTCS RPC because the chain id was 31337, not 97

The BNB mock tests sign transactions and check chain id 97 in the legacy `v` value, the `tBNB` symbol, and that a receipt without a successful token read-back records no deployment. They do not execute contract code. A mainnet mock records zero `eth_sendRawTransaction` calls.

`npm run acceptance:bnb-testnet` with neither variable set printed the not-executed message and exited 2.

## Live BNB testnet

Deployment and transfer were **not executed**. No test key and no test tBNB were available. No transaction was signed or broadcast.

Two read-only observations were made:

- `https://bnb-testnet.api.onfinality.io/public` answered `eth_chainId` with `0x61` (97). A following `web3_clientVersion` from this engine received HTTP 429. That host is not a configured default.
- `https://data-seed-prebsc-1-s1.binance.org:8545/` passed `validateConnection` for the BNB testnet profile. Reported chain id 97, native symbol `tBNB`, block `138348544`, client `Geth/v1.8.1-56d84e62-20261019/linux-amd64/go1.26.9`, `baseFeePerGas` `0x0`, `eth_gasPrice` and `eth_maxPriorityFeePerGas` both `0x5f5e100` (0.1 gwei). The engine's quote was EIP-1559 in tBNB because the base-fee field was present. `liveNetworkProven` was false. `transactionSubmitted` was false. This host is not a configured default.

A chain-id read and a fee quote are not a deployment, a transfer, or proof that a type-2 transaction would be accepted by BNB Smart Chain.

## Not done

- No funded BNB testnet deploy or transfer.
- No Sepolia or Ethereum mainnet transaction.
- No bridge and no claim that a BTCS token exists on BNB.
- No Studio wiring and no fake deploy button.
- Solana / SPL are still absent.
- Explorer source verification is not submitted.
- Withdrawals, proofs, and production vault behavior stay disabled.
