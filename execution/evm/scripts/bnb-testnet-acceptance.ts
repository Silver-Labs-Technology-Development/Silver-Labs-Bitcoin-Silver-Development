/**
 * BNB Smart Chain testnet deploy-and-transfer acceptance.
 *
 * This script sends transactions only when both `BNB_TESTNET_RPC_URL` and
 * `BNB_TESTNET_PRIVATE_KEY` are set in the environment. It does not embed an
 * RPC endpoint or a key. Exit 2 means the live run did not start.
 */
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bytesToHex } from '@ethereumjs/util'
import { SENDER_PRIVATE_KEY_HEX } from '../src/config.js'
import {
  AssetDevelopmentSession,
  AssetEngineError,
  DeploymentRegistry,
  NETWORKS,
  PrivateKeySigner,
  parsePrivateKeyHex,
} from '../src/assetEngine/index.js'

const rpcUrl = process.env.BNB_TESTNET_RPC_URL
const privateKeyHex = process.env.BNB_TESTNET_PRIVATE_KEY
if (rpcUrl === undefined || rpcUrl.trim() === '' || privateKeyHex === undefined || privateKeyHex.trim() === '') {
  console.error(
    'Live BNB Smart Chain testnet acceptance was not executed. Set BNB_TESTNET_RPC_URL and BNB_TESTNET_PRIVATE_KEY to an account that holds test tBNB. No RPC endpoint or key is built in.',
  )
  process.exit(2)
}

const privateKey = parsePrivateKeyHex(privateKeyHex)
if (bytesToHex(privateKey).toLowerCase() === SENDER_PRIVATE_KEY_HEX.toLowerCase()) {
  console.error('Refusing the public BTCS development key on BNB Smart Chain. No transaction was submitted.')
  process.exit(1)
}

const registryDirectory = await mkdtemp(join(tmpdir(), 'bnb-testnet-acceptance-'))
const registry = new DeploymentRegistry(registryDirectory)
const signer = new PrivateKeySigner(privateKey)
const recipient = `0x${'aa'.repeat(20)}`

try {
  const session = await AssetDevelopmentSession.connect({
    profile: NETWORKS.bnbTestnet,
    rpcUrl,
    signer,
    registry,
    devSequencer: false,
  })
  if (session.connection().chainId !== 97 || session.connection().nativeSymbol !== 'tBNB') {
    throw new AssetEngineError('connected network is not BNB Smart Chain testnet')
  }
  const balance = await session.nativeBalance()
  if (balance === 0n) {
    console.error('The testnet account has no tBNB. No transaction was submitted.')
    process.exit(3)
  }
  const deployment = await session.deployFungible({
    name: 'Engine Probe',
    symbol: 'PROBE',
    decimals: 18,
    atomicSupply: 1000n,
    description: 'BNB Smart Chain testnet acceptance probe',
  })
  const transferred = await session.transfer(deployment.assetId, recipient, 1n)
  const recipientBalance = await session.balanceOf(deployment.assetId, recipient)
  if (recipientBalance !== 1n) {
    throw new AssetEngineError(`recipient balance is ${recipientBalance}, expected 1`)
  }
  console.log(JSON.stringify({
    execution: 'bnb-testnet-deploy-and-transfer',
    networkId: deployment.networkId,
    chainId: deployment.chainId,
    nativeGas: deployment.nativeGas.symbol,
    interfaceConvention: deployment.interfaceConvention,
    contractAddress: deployment.contractAddress,
    deployTransaction: deployment.creationTransactionHash,
    transferTransaction: transferred.transactionHash,
    recipientBalance: recipientBalance.toString(10),
    registryDirectory,
    liveNetworkProven: false,
    note: 'Transactions were submitted to BNB_TESTNET_RPC_URL and the receipt and balance were read back. This does not by itself prove which organization operates that URL.',
  }))
} catch (error) {
  const message = error instanceof Error ? error.message : 'BNB testnet acceptance failed'
  console.error(message)
  process.exit(1)
}
