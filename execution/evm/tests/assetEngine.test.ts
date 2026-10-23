import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { createServer as createNetServer, type Server } from 'node:net'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { createFeeMarket1559TxFromRLP, createLegacyTxFromRLP } from '@ethereumjs/tx'
import { bytesToHex, createAddressFromString, createContractAddress, hexToBytes } from '@ethereumjs/util'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { randomBytes } from 'node:crypto'
import { EVM_CHAIN_ID, SENDER_PRIVATE_KEY } from '../src/config.js'
import { DEFAULT_MAX_FEE_PER_GAS, DEFAULT_MAX_PRIORITY_FEE_PER_GAS } from '../src/transactions.js'
import {
  AssetDevelopmentSession,
  AssetEngineError,
  CROSS_CHAIN_BRIDGE,
  DeploymentRegistry,
  NETWORKS,
  PrivateKeySigner,
  assetIdFor,
  compileFungibleAsset,
  defineEthereumCompatibleNetwork,
  feeFieldsForProfile,
  liveBnbTestnetConfigured,
  refuseCrossChainLink,
  resolveRpcUrl,
  walletAddParams,
  walletSwitchParams,
} from '../src/assetEngine/index.js'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RECIPIENT = `0x${'aa'.repeat(20)}`
const SPENDER = `0x${'bb'.repeat(20)}`
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const TRANSFER_TOPIC = bytesToHex(
  keccak_256(new TextEncoder().encode('Transfer(address,address,uint256)')),
).toLowerCase()

test('network profiles keep gas symbols, chain ids, and RPC endpoints apart', async () => {
  assert.equal(NETWORKS.btcsL2Local.chainId, Number(EVM_CHAIN_ID))
  assert.equal(NETWORKS.btcsL2Local.nativeGas.symbol, 'BTCS')
  assert.equal(NETWORKS.btcsL2Local.interfaceConvention, 'erc-20')
  assert.equal(NETWORKS.btcsL2Local.feeMarket, 'eip-1559-only')
  assert.equal(NETWORKS.btcsL2Local.explorer, null)
  assert.equal(NETWORKS.ethereumSepolia.nativeGas.symbol, 'ETH')
  assert.equal(NETWORKS.ethereumSepolia.chainId, 11_155_111)
  assert.equal(NETWORKS.bnbTestnet.chainId, 97)
  assert.equal(NETWORKS.bnbTestnet.nativeGas.symbol, 'tBNB')
  assert.equal(NETWORKS.bnbTestnet.interfaceConvention, 'bep-20')
  assert.equal(NETWORKS.bnbMainnet.chainId, 56)
  assert.equal(NETWORKS.bnbMainnet.nativeGas.symbol, 'BNB')
  assert.equal(NETWORKS.bnbMainnet.deploymentPolicy, 'mainnet-disabled')
  assert.notEqual(NETWORKS.bnbTestnet.fallbackPriorityFee, DEFAULT_MAX_PRIORITY_FEE_PER_GAS)
  assert.notEqual(NETWORKS.ethereumSepolia.fallbackPriorityFee, NETWORKS.bnbTestnet.fallbackPriorityFee)
  assert.equal(CROSS_CHAIN_BRIDGE, 'not-implemented')
  assert.throws(refuseCrossChainLink, AssetEngineError)

  const btcsSwitch = walletSwitchParams(NETWORKS.btcsL2Local)
  const bnbSwitch = walletSwitchParams(NETWORKS.bnbTestnet)
  assert.equal(btcsSwitch.params[0]?.chainId, '0x7a69')
  assert.equal(bnbSwitch.params[0]?.chainId, '0x61')
  const added = walletAddParams(NETWORKS.bnbTestnet, 'http://127.0.0.1:1')
  const params = added.params[0] as { nativeCurrency: { symbol: string }; rpcUrls: string[] }
  assert.equal(params.nativeCurrency.symbol, 'tBNB')
  assert.deepEqual(params.rpcUrls, ['http://127.0.0.1:1'])
  const btcsAdd = walletAddParams(NETWORKS.btcsL2Local, 'http://127.0.0.1:2').params[0] as {
    nativeCurrency: { symbol: string }
    blockExplorerUrls: string[]
  }
  assert.equal(btcsAdd.nativeCurrency.symbol, 'BTCS')
  assert.deepEqual(btcsAdd.blockExplorerUrls, [])

  assert.throws(() => resolveRpcUrl(NETWORKS.bnbTestnet), /BNB_TESTNET_RPC_URL/)
  assert.equal(resolveRpcUrl(NETWORKS.bnbTestnet, 'http://127.0.0.1:9'), 'http://127.0.0.1:9')
  assert.throws(
    () => defineEthereumCompatibleNetwork({
      id: 'not-bnb',
      name: 'Mislabelled',
      chainId: 97,
      deploymentPolicy: 'testnet',
      rpcUrlEnv: 'CUSTOM_RPC_URL',
    }),
    /bnb-smart-chain-testnet/,
  )
  assert.throws(
    () => defineEthereumCompatibleNetwork({
      id: 'not-btcs',
      name: 'Mislabelled',
      chainId: Number(EVM_CHAIN_ID),
      deploymentPolicy: 'testnet',
      rpcUrlEnv: 'CUSTOM_RPC_URL',
    }),
    /btcs-l2-local/,
  )
  const holesky = defineEthereumCompatibleNetwork({
    id: 'ethereum-holesky',
    name: 'Ethereum Holesky',
    chainId: 17000,
    deploymentPolicy: 'testnet',
    rpcUrlEnv: 'ETH_HOLESKY_RPC_URL',
  })
  assert.equal(holesky.nativeGas.symbol, 'ETH')
  assert.equal(holesky.kind, 'ethereum')

  const sourceDirectory = fileURLToPath(new URL('../src/assetEngine/', import.meta.url))
  const files = await readdir(sourceDirectory)
  for (const file of files) {
    const source = await readFile(join(sourceDirectory, file), 'utf8')
    assert.doesNotMatch(source, /binance\.org|infura|alchemy|onfinality|localhost:8545/i)
    assert.equal(source.includes(`0x${'11'.repeat(32)}`), false)
  }

  const left = assetIdFor('btcs-l2-local', RECIPIENT)
  const right = assetIdFor('bnb-smart-chain-testnet', RECIPIENT)
  assert.notEqual(left, right)
  assert.equal(NETWORKS.bnbTestnet.explorer?.transactionUrl('0x' + 'ab'.repeat(32)),
    `https://testnet.bscscan.com/tx/${'0x' + 'ab'.repeat(32)}`)
  assert.equal(NETWORKS.ethereumMainnet.explorer?.addressUrl(RECIPIENT), `https://etherscan.io/address/${RECIPIENT}`)
})

test('fee quotes use the connected network rules', () => {
  const baseFee = 3_000_000_000n
  const btcs = feeFieldsForProfile(NETWORKS.btcsL2Local, {
    baseFeePerGas: baseFee,
    gasPrice: 9n,
    priorityFee: 9n,
  })
  assert.equal(btcs.model, 'eip-1559')
  assert.equal(btcs.nativeSymbol, 'BTCS')
  assert.equal(btcs.maxPriorityFeePerGas, DEFAULT_MAX_PRIORITY_FEE_PER_GAS)
  assert.equal(btcs.maxFeePerGas, baseFee + DEFAULT_MAX_PRIORITY_FEE_PER_GAS)
  assert.equal(btcs.gasPrice, undefined)

  const localDefault = feeFieldsForProfile(NETWORKS.btcsL2Local, {
    baseFeePerGas: 1_000_000_000n,
    gasPrice: undefined,
    priorityFee: undefined,
  })
  assert.equal(localDefault.maxFeePerGas, DEFAULT_MAX_FEE_PER_GAS)
  assert.equal(localDefault.maxPriorityFeePerGas, DEFAULT_MAX_PRIORITY_FEE_PER_GAS)

  const bnb = feeFieldsForProfile(NETWORKS.bnbTestnet, {
    baseFeePerGas: baseFee,
    gasPrice: undefined,
    priorityFee: undefined,
  })
  assert.equal(bnb.nativeSymbol, 'tBNB')
  assert.equal(bnb.model, 'eip-1559')
  assert.equal(bnb.maxPriorityFeePerGas, NETWORKS.bnbTestnet.fallbackPriorityFee)
  assert.equal(bnb.maxFeePerGas, baseFee * 2n + (NETWORKS.bnbTestnet.fallbackPriorityFee ?? 0n))

  const legacy = feeFieldsForProfile(NETWORKS.bnbTestnet, {
    baseFeePerGas: undefined,
    gasPrice: 5_000_000_000n,
    priorityFee: undefined,
  })
  assert.equal(legacy.model, 'legacy')
  assert.equal(legacy.gasPrice, 5_000_000_000n)
  assert.equal(legacy.nativeSymbol, 'tBNB')

  const eth = feeFieldsForProfile(NETWORKS.ethereumSepolia, {
    baseFeePerGas: baseFee,
    gasPrice: undefined,
    priorityFee: 7n,
  })
  assert.equal(eth.nativeSymbol, 'ETH')
  assert.equal(eth.networkId, 'ethereum-sepolia')
  assert.equal(eth.maxPriorityFeePerGas, 7n)
  assert.throws(() => feeFieldsForProfile(NETWORKS.btcsL2Local, {
    baseFeePerGas: undefined,
    gasPrice: 1n,
    priorityFee: undefined,
  }), /EIP-1559/)
  assert.throws(() => feeFieldsForProfile(NETWORKS.bnbTestnet, {
    baseFeePerGas: undefined,
    gasPrice: 0n,
    priorityFee: undefined,
  }), /gasPrice/)
})

test('the shared template is the ERC-20/BEP-20 interface and has no mint', () => {
  const compiled = compileFungibleAsset()
  assert.equal(compiled.evmVersion, 'london')
  assert.equal(compiled.methodIdentifiers['transfer(address,uint256)'], 'a9059cbb')
  assert.equal(compiled.methodIdentifiers['name()'], '06fdde03')
  assert.equal(Object.keys(compiled.methodIdentifiers).some((signature) => signature.startsWith('mint(')), false)
  assert.equal(compileFungibleAsset().creationBytecodeSha256, compiled.creationBytecodeSha256)
  assert.equal(TRANSFER_TOPIC, `0x${'ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'}`)
})

test('BNB adapter signs chain 97 against a mock and does not record a fake deployment', async () => {
  const mock = await startMock({
    chainId: 97,
    clientVersion: 'mock-bnb-testnet',
    gasPrice: 1_000_000_000n,
    balance: 10n ** 18n,
  })
  const registry = new DeploymentRegistry(await mkdtemp(join(tmpdir(), 'asset-engine-bnb-')))
  try {
    const session = await AssetDevelopmentSession.connect({
      profile: NETWORKS.bnbTestnet,
      rpcUrl: mock.url,
      signer: new PrivateKeySigner(SENDER_PRIVATE_KEY),
      registry,
      devSequencer: false,
    })
    assert.equal(session.connection().liveNetworkProven, false)
    assert.equal(session.connection().nativeSymbol, 'tBNB')
    const compiled = compileFungibleAsset()
    const quote = await session.estimateFees({ data: compiled.creationBytecode })
    assert.equal(quote.model, 'legacy')
    assert.equal(quote.nativeSymbol, 'tBNB')
    assert.equal(quote.gasPrice, 1_000_000_000n)
    const submitted = await session.signAndSubmit({ data: compiled.creationBytecode })
    assert.equal(submitted.receipt.transactionHash, submitted.transactionHash)
    const raw = mock.sent[0]
    assert.ok(raw)
    const common = createCustomCommon({ name: 'bnb-smart-chain-testnet', chainId: 97 }, Mainnet, { hardfork: Hardfork.London })
    const tx = createLegacyTxFromRLP(hexToBytes(raw as `0x${string}`), { common })
    assert.ok(tx.v !== undefined && tx.v >= 35n)
    assert.equal((tx.v - 35n) / 2n, 97n)
    assert.equal(tx.type, 0)
    assert.equal(tx.gasPrice, 1_000_000_000n)
    await assert.rejects(
      session.deployFungible({ name: 'Probe', symbol: 'PRB', decimals: 18, atomicSupply: 10n }),
      /read-back failed/,
    )
    assert.equal((await registry.list()).length, 0)
  } finally {
    await mock.close()
  }
})

test('a BNB block with a base fee is quoted in tBNB, not BTCS defaults', async () => {
  const mock = await startMock({
    chainId: 97,
    clientVersion: 'mock-bnb-1559',
    baseFeePerGas: 3_000_000_000n,
    balance: 10n ** 18n,
  })
  const registry = new DeploymentRegistry(await mkdtemp(join(tmpdir(), 'asset-engine-bnb-fee-')))
  try {
    const session = await AssetDevelopmentSession.connect({
      profile: NETWORKS.bnbTestnet,
      rpcUrl: mock.url,
      signer: new PrivateKeySigner(randomBytes(32)),
      registry,
    })
    const quote = await session.estimateFees({ data: new Uint8Array([0x01]) })
    assert.equal(quote.nativeSymbol, 'tBNB')
    assert.equal(quote.model, 'eip-1559')
    assert.equal(quote.maxPriorityFeePerGas, NETWORKS.bnbTestnet.fallbackPriorityFee)
    assert.notEqual(quote.maxPriorityFeePerGas, DEFAULT_MAX_PRIORITY_FEE_PER_GAS)
    const submitted = await session.signAndSubmit({ data: new Uint8Array([0x01]) })
    const common = createCustomCommon({ name: 'bnb-smart-chain-testnet', chainId: 97 }, Mainnet, { hardfork: Hardfork.London })
    const raw = mock.sent[0]
    assert.ok(raw)
    const tx = createFeeMarket1559TxFromRLP(hexToBytes(raw as `0x${string}`), { common })
    assert.equal(tx.chainId, 97n)
    assert.equal(tx.type, 2)
    assert.equal(tx.maxPriorityFeePerGas, NETWORKS.bnbTestnet.fallbackPriorityFee)
    assert.equal(submitted.quote.nativeSymbol, 'tBNB')
  } finally {
    await mock.close()
  }
})

test('mainnet profiles refuse deployment before a transaction is sent', async () => {
  const mock = await startMock({ chainId: 56, clientVersion: 'mock-bnb-mainnet', gasPrice: 1n, balance: 10n ** 18n })
  const registry = new DeploymentRegistry(await mkdtemp(join(tmpdir(), 'asset-engine-mainnet-')))
  try {
    const session = await AssetDevelopmentSession.connect({
      profile: NETWORKS.bnbMainnet,
      rpcUrl: mock.url,
      signer: new PrivateKeySigner(randomBytes(32)),
      registry,
    })
    await assert.rejects(
      session.deployFungible({ name: 'No', symbol: 'NO', decimals: 18, atomicSupply: 1n }),
      /allowMainnet/,
    )
    assert.equal(mock.sent.length, 0)
    assert.equal(session.connection().nativeSymbol, 'BNB')
  } finally {
    await mock.close()
  }
})

test('a rate-limited client version does not hide the chain id or send a transaction', async () => {
  const mock = await startMock({
    chainId: 97,
    clientVersion: 'unused',
    gasPrice: 1n,
    balance: 1n,
    clientVersionHttpStatus: 429,
  })
  const registry = new DeploymentRegistry(await mkdtemp(join(tmpdir(), 'asset-engine-rate-')))
  try {
    const session = await AssetDevelopmentSession.connect({
      profile: NETWORKS.bnbTestnet,
      rpcUrl: mock.url,
      signer: new PrivateKeySigner(randomBytes(32)),
      registry,
    })
    assert.equal(session.connection().chainId, 97)
    assert.equal(session.connection().nativeSymbol, 'tBNB')
    assert.equal(session.connection().clientVersion, null)
    assert.equal(session.connection().liveNetworkProven, false)
    assert.equal(mock.sent.length, 0)
    await assert.rejects(
      AssetDevelopmentSession.connect({
        profile: NETWORKS.btcsL2Local,
        rpcUrl: mock.url,
        signer: new PrivateKeySigner(randomBytes(32)),
        registry,
        devSequencer: true,
      }),
      /expected chain 31337/,
    )
  } finally {
    await mock.close()
  }
})

test('chain id 31337 without the BTCS client banner is not the BTCS L2 network', async () => {
  const mock = await startMock({ chainId: 31337, clientVersion: 'Hardhat', gasPrice: 1n, balance: 1n })
  try {
    await assert.rejects(
      AssetDevelopmentSession.connect({
        profile: NETWORKS.btcsL2Local,
        rpcUrl: mock.url,
        signer: new PrivateKeySigner(randomBytes(32)),
        registry: new DeploymentRegistry(await mkdtemp(join(tmpdir(), 'asset-engine-hardhat-'))),
        devSequencer: true,
      }),
      /BTCSL2/,
    )
    assert.equal(mock.sent.length, 0)
  } finally {
    await mock.close()
  }
})

test('local BTCS RPC deploys, transfers, and keeps the asset off other networks', { timeout: 120_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-asset-engine-'))
  const registryDirectory = await mkdtemp(join(tmpdir(), 'btcs-l2-asset-registry-'))
  const registry = new DeploymentRegistry(registryDirectory)
  let rpc: RpcProcess | undefined
  const bnbMock = await startMock({ chainId: 97, clientVersion: 'mock-bnb', gasPrice: 1n, balance: 10n ** 18n })
  try {
    rpc = await startRpc(directory)
    const session = await AssetDevelopmentSession.connect({
      profile: NETWORKS.btcsL2Local,
      rpcUrl: rpc.url,
      signer: new PrivateKeySigner(SENDER_PRIVATE_KEY),
      registry,
      devSequencer: true,
    })
    assert.match(session.connection().clientVersion ?? '', /^BTCSL2\//)
    assert.equal(session.connection().nativeSymbol, 'BTCS')
    assert.equal(session.walletSwitch().params[0]?.chainId, '0x7a69')
    const added = session.walletAdd().params[0] as { nativeCurrency: { symbol: string }; rpcUrls: string[] }
    assert.equal(added.nativeCurrency.symbol, 'BTCS')
    assert.deepEqual(added.rpcUrls, [rpc.url])

    await assert.rejects(
      AssetDevelopmentSession.connect({
        profile: NETWORKS.bnbTestnet,
        rpcUrl: rpc.url,
        signer: new PrivateKeySigner(SENDER_PRIVATE_KEY),
        registry,
      }),
      /expected chain 97/,
    )

    const deployment = await session.deployFungible({
      name: 'Probe Token',
      symbol: 'PRB',
      decimals: 8,
      atomicSupply: 1_000_000n,
      description: 'local probe',
      externalUrl: 'https://example.invalid/probe',
      logoBytes: new Uint8Array(PNG),
    })
    assert.equal(deployment.networkId, 'btcs-l2-local')
    assert.equal(deployment.interfaceConvention, 'erc-20')
    assert.equal(deployment.nativeGas.symbol, 'BTCS')
    assert.equal(deployment.supplyAtomic, '1000000')
    assert.equal(deployment.supplyUnit, 'atomic')
    assert.equal(deployment.permissions.mint, 'none')
    assert.equal(deployment.explorerTransactionUrl, null)
    assert.equal(deployment.sameAssetOnOtherNetworks.length, 0)
    assert.equal(deployment.metadata.logo?.mediaType, 'image/png')
    assert.equal(deployment.metadata.description, 'local probe')
    assert.equal(session.verificationPlan(deployment).state, 'unsupported')
    const onChain = await session.readFungible(deployment.assetId)
    assert.deepEqual(onChain, {
      name: 'Probe Token',
      symbol: 'PRB',
      decimals: 8,
      totalSupply: 1_000_000n,
      owner: session.signerAddress,
    })
    assert.equal(await session.balanceOf(deployment.assetId, session.signerAddress), 1_000_000n)

    const before = await session.nativeBalance()
    const coinbaseBefore = await session.nativeBalance(`0x${'00'.repeat(20)}`)
    const transferred = await session.transfer(deployment.assetId, RECIPIENT, 1n)
    assert.equal(transferred.quote.nativeSymbol, 'BTCS')
    assert.equal(transferred.quote.model, 'eip-1559')
    assert.equal(transferred.receipt.status, '0x1')
    const baseFee = await session.baseFee(transferred.receipt.blockNumber)
    const after = await session.nativeBalance()
    const coinbaseAfter = await session.nativeBalance(`0x${'00'.repeat(20)}`)
    assert.equal(before - after, transferred.receipt.gasUsed * transferred.receipt.effectiveGasPrice)
    assert.equal(
      coinbaseAfter - coinbaseBefore,
      transferred.receipt.gasUsed * (transferred.receipt.effectiveGasPrice - baseFee),
    )
    assert.equal(await session.balanceOf(deployment.assetId, session.signerAddress), 999_999n)
    assert.equal(await session.balanceOf(deployment.assetId, RECIPIENT), 1n)
    const logs = await session.getLogs(deployment.assetId)
    assert.ok(logs.length >= 2)
    assert.equal(logs[0]?.topics[0]?.toLowerCase(), TRANSFER_TOPIC)
    assert.equal(transferred.receipt.logs[0]?.topics[0]?.toLowerCase(), TRANSFER_TOPIC)

    await session.approve(deployment.assetId, SPENDER, 5n)
    assert.equal(await session.allowance(deployment.assetId, session.signerAddress, SPENDER), 5n)
    const balanceBeforeUnauthorized = await session.balanceOf(deployment.assetId, session.signerAddress)
    await assert.rejects(
      session.transferFrom(deployment.assetId, session.signerAddress, RECIPIENT, 2n),
      /reverted/,
    )
    assert.equal(await session.balanceOf(deployment.assetId, session.signerAddress), balanceBeforeUnauthorized)
    await session.approve(deployment.assetId, session.signerAddress, 5n)
    await session.transferFrom(deployment.assetId, session.signerAddress, RECIPIENT, 2n)
    assert.equal(await session.balanceOf(deployment.assetId, RECIPIENT), 3n)
    assert.equal(await session.allowance(deployment.assetId, session.signerAddress, session.signerAddress), 3n)
    assert.equal(await session.allowance(deployment.assetId, session.signerAddress, SPENDER), 5n)

    const balanceBeforeRevert = await session.balanceOf(deployment.assetId, session.signerAddress)
    await assert.rejects(session.transfer(deployment.assetId, RECIPIENT, balanceBeforeRevert + 1n), /reverted/)
    assert.equal(await session.balanceOf(deployment.assetId, session.signerAddress), balanceBeforeRevert)

    await assert.rejects(session.attachLogo(deployment.assetId, new Uint8Array([1, 2, 3, 4])), /png, jpeg, gif, or webp/)
    const unfunded = await AssetDevelopmentSession.connect({
      profile: NETWORKS.btcsL2Local,
      rpcUrl: rpc.url,
      signer: new PrivateKeySigner(randomBytes(32)),
      registry,
      devSequencer: true,
    })
    const tipBefore = session.connection().blockNumber
    await assert.rejects(
      unfunded.deployFungible({ name: 'Empty', symbol: 'EMP', decimals: 18, atomicSupply: 1n }),
      /insufficient|funds|balance|gas/i,
    )
    assert.ok((await session.nativeBalance()) > 0n)
    assert.ok(tipBefore >= 0n)

    await session.switchNetwork({ profile: NETWORKS.bnbTestnet, rpcUrl: bnbMock.url })
    assert.equal(session.network.nativeGas.symbol, 'tBNB')
    assert.equal(session.walletSwitch().params[0]?.chainId, '0x61')
    await assert.rejects(session.transfer(deployment.assetId, RECIPIENT, 1n), /will not send that asset/)
    assert.equal((await registry.list('btcs-l2-local')).length, 1)
    assert.equal((await registry.list('bnb-smart-chain-testnet')).length, 0)
    assert.equal(bnbMock.sent.length, 0)
  } finally {
    await bnbMock.close()
    if (rpc !== undefined) await stopRpc(rpc.child)
  }
})

test('live BNB Smart Chain testnet deploy and transfer', {
  skip: liveBnbTestnetConfigured()
    ? false
    : 'live BNB testnet was not executed: BNB_TESTNET_RPC_URL and BNB_TESTNET_PRIVATE_KEY are unset',
}, async () => {
  const { spawn: spawnProcess } = await import('node:child_process')
  const child = spawnProcess(process.execPath, ['--import', 'tsx', 'scripts/bnb-testnet-acceptance.ts'], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = await new Promise<string>((resolve, reject) => {
    let text = ''
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => { text += chunk })
    child.stderr?.on('data', (chunk: string) => { text += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve(text)
      else reject(new Error(`acceptance exit ${code}: ${text}`))
    })
  })
  const summary = JSON.parse(output) as { execution?: string; chainId?: number; recipientBalance?: string }
  assert.equal(summary.execution, 'bnb-testnet-deploy-and-transfer')
  assert.equal(summary.chainId, 97)
  assert.equal(summary.recipientBalance, '1')
})

type RpcProcess = { child: ChildProcess; url: string }

type MockOptions = {
  chainId: number
  clientVersion: string
  gasPrice?: bigint
  baseFeePerGas?: bigint
  balance: bigint
  clientVersionHttpStatus?: number
}

type MockServer = {
  url: string
  sent: string[]
  close: () => Promise<void>
}

async function startMock(options: MockOptions): Promise<MockServer> {
  const sent: string[] = []
  const common = createCustomCommon(
    { name: 'mock', chainId: options.chainId },
    Mainnet,
    { hardfork: Hardfork.London },
  )
  const server = createServer((request, response) => {
    void handleMock(request, response, options, sent, common)
  })
  await listen(server)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('mock did not bind')
  return {
    url: `http://127.0.0.1:${address.port}`,
    sent,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
}

async function handleMock(
  request: IncomingMessage,
  response: ServerResponse,
  options: MockOptions,
  sent: string[],
  common: ReturnType<typeof createCustomCommon>,
): Promise<void> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { id?: unknown; method?: string; params?: unknown[] }
  const method = body.method
  const id = body.id ?? null
  const send = (result: unknown) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id, result }))
  }
  const fail = (code: number, message: string) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }))
  }
  if (method === 'eth_chainId') return send(`0x${options.chainId.toString(16)}`)
  if (method === 'net_version') return send(String(options.chainId))
  if (method === 'web3_clientVersion') {
    if (options.clientVersionHttpStatus !== undefined) {
      response.writeHead(options.clientVersionHttpStatus)
      response.end('unavailable')
      return
    }
    return send(options.clientVersion)
  }
  if (method === 'eth_blockNumber') return send('0x10')
  if (method === 'eth_getBalance') return send(`0x${options.balance.toString(16)}`)
  if (method === 'eth_getTransactionCount') return send(`0x${nonceOf(sent).toString(16)}`)
  if (method === 'eth_gasPrice') {
    if (options.gasPrice === undefined) return fail(-32601, 'Method not found')
    return send(`0x${options.gasPrice.toString(16)}`)
  }
  if (method === 'eth_maxPriorityFeePerGas') return fail(-32601, 'Method not found')
  if (method === 'eth_getBlockByNumber') {
    return send({
      number: '0x10',
      ...(options.baseFeePerGas === undefined ? {} : { baseFeePerGas: `0x${options.baseFeePerGas.toString(16)}` }),
    })
  }
  if (method === 'eth_estimateGas') return send('0x10000')
  if (method === 'eth_call') return fail(-32000, 'mock does not execute contracts')
  if (method === 'eth_sendRawTransaction') {
    const raw = body.params?.[0]
    if (typeof raw !== 'string') return fail(-32602, 'raw transaction')
    sent.push(raw)
    const bytes = hexToBytes(raw as `0x${string}`)
    const tx = bytes[0] === 2
      ? createFeeMarket1559TxFromRLP(bytes, { common })
      : createLegacyTxFromRLP(bytes, { common })
    return send(bytesToHex(tx.hash()))
  }
  if (method === 'eth_getTransactionReceipt') {
    const hash = body.params?.[0]
    const match = sent.find((raw) => {
      const bytes = hexToBytes(raw as `0x${string}`)
      const tx = bytes[0] === 2
        ? createFeeMarket1559TxFromRLP(bytes, { common })
        : createLegacyTxFromRLP(bytes, { common })
      return bytesToHex(tx.hash()).toLowerCase() === String(hash).toLowerCase()
    })
    if (match === undefined) return send(null)
    const bytes = hexToBytes(match as `0x${string}`)
    const tx = bytes[0] === 2
      ? createFeeMarket1559TxFromRLP(bytes, { common })
      : createLegacyTxFromRLP(bytes, { common })
    const price = tx.type === 0 ? tx.gasPrice : tx.maxFeePerGas
    const contractAddress = tx.to === undefined
      ? createContractAddress(createAddressFromString(tx.getSenderAddress().toString()), tx.nonce).toString().toLowerCase()
      : null
    return send({
      transactionHash: bytesToHex(tx.hash()),
      status: '0x1',
      contractAddress,
      gasUsed: '0x5208',
      effectiveGasPrice: `0x${price.toString(16)}`,
      blockNumber: '0x11',
      from: tx.getSenderAddress().toString(),
      to: tx.to?.toString() ?? null,
      logs: [],
    })
  }
  return fail(-32601, 'Method not found')
}

function nonceOf(sent: string[]): bigint {
  return BigInt(sent.length)
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('could not reserve a loopback port'))
        return
      }
      const { port } = address
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function startRpc(directory: string): Promise<RpcProcess> {
  const port = await freePort()
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    'src/rpcServer.ts',
    '--datadir', directory,
    '--port', String(port),
    '--dev-sequencer',
  ], { cwd: PACKAGE_ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { output += chunk })
  child.stderr?.on('data', (chunk: string) => { output += chunk })
  const url = `http://127.0.0.1:${port}`
  const started = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 20_000)
    const onData = () => {
      if (output.includes('BTCS L2 local RPC listening')) {
        clearTimeout(timer)
        resolve(true)
      }
    }
    child.stdout?.on('data', onData)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  if (!started) {
    child.kill('SIGKILL')
    throw new Error(`RPC process did not listen: ${output}`)
  }
  return { child, url }
}

async function stopRpc(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (!stopped) {
    child.kill('SIGKILL')
    await exited
  }
}
