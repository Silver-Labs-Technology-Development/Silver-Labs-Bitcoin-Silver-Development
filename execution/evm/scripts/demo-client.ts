import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  Address,
  bytesToHex,
  createContractAddress,
  hexToBytes,
  unprefixedHexToBytes,
  utf8ToBytes,
} from '@ethereumjs/util'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { compileCounter } from '../src/compile.js'
import { GENESIS_BALANCE, SENDER_ADDRESS } from '../src/config.js'
import { startLocalRpcServer } from '../src/rpc.js'
import { createEvmSettlementBatch, EVM_SETTLEMENT_BATCH_VERSION } from '../src/settlementBatch.js'
import { exportEvmSettlementBatchFile } from '../src/settlementBatchFile.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { verifyEvmSettlementBatchExecution } from '../src/settlementBatchReplay.js'
import { signFeeMarketTransaction } from '../src/transactions.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ONE_ETHER = 10n ** 18n

export class ClientDemoAssertionError extends Error {}

type RpcResponse = Readonly<{
  jsonrpc: string
  id: unknown
  result?: unknown
  error?: { code: number; message: string }
}>

type RpcLog = Readonly<{
  address: string
  topics: string[]
  data: string
  transactionHash: string
}>

type RpcReceipt = Readonly<{
  status: string
  blockNumber: string
  transactionHash: string
  gasUsed: string
  contractAddress: string | null
  to: string | null
  logs: RpcLog[]
}>

type RpcBlock = Readonly<{
  number: string
  hash: string
  transactions: Array<Readonly<{ hash: string; to: string | null }>>
}>

export type ClientDemoSummary = Readonly<{
  format: string
  version: number
  chainId: number
  dataDirectory: string
  batchFilePath: string
  deployTx: Readonly<{ hash: string; contractAddress: string }>
  incrementTx: Readonly<{ hash: string; status: number }>
  revertedTx: Readonly<{ hash: string; status: number }>
  transferTx: Readonly<{ hash: string; status: number }>
  blockNumber: number
  reads: Readonly<{
    codeBytes: number
    storageValue: string
    incrementLogCount: number
    revertLogCount: number
    senderNonce: number
    senderBalanceWei: string
    recipientBalanceWei: string
  }>
  settlement: Readonly<{
    version: string
    startHeight: string
    endHeight: string
    blocksVerified: number
    childBlocksReexecuted: number
    executionVerified: boolean
    batchHash: string
  }>
  notes: Readonly<{
    whatThisProves: string[]
    doesNotProve: string[]
  }>
}>

export type ClientDemoOptions = {
  datadir?: string
  batchOut?: string
}

function demoAssert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new ClientDemoAssertionError(message)
  }
}

async function callRpc(url: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const body = (await response.json()) as RpcResponse
  if (body.error !== undefined) {
    throw new Error(`RPC ${method} failed (${body.error.code}): ${body.error.message}`)
  }
  return body.result
}

function asHex(value: unknown, label: string): string {
  demoAssert(typeof value === 'string' && /^0x[0-9a-f]+$/.test(value), `${label} must be a 0x-prefixed hex string`)
  return value
}

export async function runClientDemo(options: ClientDemoOptions = {}): Promise<ClientDemoSummary> {
  const providedDatadir = options.datadir
  const cleanDirectory = providedDatadir === undefined
  const dataDirectory = providedDatadir === undefined
    ? await mkdtemp(join(tmpdir(), 'btcs-l2-client-demo-'))
    : resolve(providedDatadir)
  const providedBatchOut = options.batchOut
  const batchFilePath = providedBatchOut === undefined
    ? join(await mkdtemp(join(tmpdir(), 'btcs-l2-client-demo-artifact-')), 'client-demo-batch-v2.json')
    : resolve(providedBatchOut)
  await mkdir(dirname(batchFilePath), { recursive: true })

  const chain = await PersistentBlockProcessor.open(dataDirectory)
  const server = await startLocalRpcServer(chain, { port: 0, enableDevelopmentSequencer: true })
  try {
    const url = `http://${server.host}:${server.port}/`
    const chainIdResult = asHex(await callRpc(url, 'eth_chainId'), 'eth_chainId')
    demoAssert(BigInt(chainIdResult) === 31337n, 'eth_chainId must be 31337')

    const compiled = compileCounter()
    const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
    const incrementSelector = compiled.methodIdentifiers['increment()']
    const revertSelector = compiled.methodIdentifiers['incrementThenRevert()']
    demoAssert(incrementSelector !== undefined && revertSelector !== undefined, 'Counter selectors are present')
    const recipient = new Address(unprefixedHexToBytes('22'.repeat(20)))
    const incrementTopic = `0x${Buffer.from(keccak_256(utf8ToBytes('Incremented(uint256)'))).toString('hex')}`

    const deployRaw = signFeeMarketTransaction({
      nonce: 0n,
      data: compiled.creationBytecode,
      gasLimit: 500_000n,
    })
    const incrementRaw = signFeeMarketTransaction({
      nonce: 1n,
      to: contractAddress,
      data: hexToBytes(`0x${incrementSelector}`),
      gasLimit: 150_000n,
    })
    const revertRaw = signFeeMarketTransaction({
      nonce: 2n,
      to: contractAddress,
      data: hexToBytes(`0x${revertSelector}`),
      gasLimit: 150_000n,
    })
    const transferRaw = signFeeMarketTransaction({
      nonce: 3n,
      to: recipient,
      value: ONE_ETHER,
      gasLimit: 21_000n,
    })

    const deployTx = asHex(
      await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(deployRaw.serialize()).toLowerCase()]),
      'deploy tx hash',
    )
    const incrementTx = asHex(
      await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(incrementRaw.serialize()).toLowerCase()]),
      'increment tx hash',
    )
    const revertedTx = asHex(
      await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(revertRaw.serialize()).toLowerCase()]),
      'reverted tx hash',
    )
    const transferTx = asHex(
      await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(transferRaw.serialize()).toLowerCase()]),
      'transfer tx hash',
    )

    const mined = (await callRpc(url, 'btcs_dev_mine')) as Readonly<{ number: string; hash: string; transactions: string[] }>
    demoAssert(mined.number === '0x1', 'btcs_dev_mine produced block height 1')
    for (const hash of [deployTx, incrementTx, revertedTx, transferTx]) {
      demoAssert(mined.transactions.includes(hash), `block includes transaction ${hash}`)
    }

    const blockNumberResult = asHex(await callRpc(url, 'eth_blockNumber'), 'eth_blockNumber')
    demoAssert(BigInt(blockNumberResult) === 1n, 'eth_blockNumber is 1')

    const latest = (await callRpc(url, 'eth_getBlockByNumber', ['latest', true])) as RpcBlock
    demoAssert(latest.number === '0x1', 'latest block is height 1')
    demoAssert(latest.transactions.length === 4, 'latest block contains the four submitted transactions')

    const deployReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [deployTx])) as RpcReceipt | null
    demoAssert(deployReceipt !== null, 'deploy receipt is present')
    demoAssert(deployReceipt.status === '0x1', 'deploy transaction succeeded')
    const deployedAddress = deployReceipt.contractAddress
    demoAssert(
      deployedAddress !== null && deployedAddress.toLowerCase() === contractAddress.toString().toLowerCase(),
      'receipt contractAddress matches the CREATE address',
    )

    const incrementReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [incrementTx])) as RpcReceipt | null
    demoAssert(incrementReceipt !== null, 'increment receipt is present')
    demoAssert(incrementReceipt.status === '0x1', 'increment transaction succeeded')
    demoAssert(incrementReceipt.logs.length === 1, 'increment emitted exactly one event')
    demoAssert(incrementReceipt.logs[0].address.toLowerCase() === deployedAddress.toLowerCase(), 'event comes from Counter')
    demoAssert(incrementReceipt.logs[0].topics[0] === incrementTopic, 'event topic is Incremented(uint256)')
    demoAssert(BigInt(incrementReceipt.logs[0].data) === 1n, 'event payload is count = 1')

    const revertReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [revertedTx])) as RpcReceipt | null
    demoAssert(revertReceipt !== null, 'reverted receipt is present')
    demoAssert(revertReceipt.status === '0x0', 'reverted transaction has status 0')
    demoAssert(revertReceipt.logs.length === 0, 'reverted transaction emitted no logs')
    demoAssert(BigInt(revertReceipt.gasUsed) > 0n, 'reverted transaction still consumed gas')

    const transferReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [transferTx])) as RpcReceipt | null
    demoAssert(transferReceipt !== null, 'transfer receipt is present')
    demoAssert(transferReceipt.status === '0x1', 'transfer transaction succeeded')
    demoAssert(
      transferReceipt.to !== null && transferReceipt.to.toLowerCase() === recipient.toString().toLowerCase(),
      'transfer receipt recipient matches',
    )

    const code = asHex(await callRpc(url, 'eth_getCode', [deployedAddress, 'latest']), 'eth_getCode')

    const storage = asHex(await callRpc(url, 'eth_getStorageAt', [deployedAddress, '0x0', 'latest']), 'eth_getStorageAt')
    const storageValue = BigInt(storage)
    demoAssert(storageValue === 1n, 'count storage is 1 after increment and reverted increment')

    const allLogs = (await callRpc(url, 'eth_getLogs', [
      { fromBlock: '0x0', toBlock: 'latest' },
    ])) as RpcLog[]
    demoAssert(allLogs.length === 1, 'exactly one persisted event log')
    demoAssert(allLogs[0].transactionHash === incrementTx, 'the persisted log came from the increment transaction')

    const senderAddressHex = SENDER_ADDRESS.toString().toLowerCase()
    const senderNonceResult = asHex(
      await callRpc(url, 'eth_getTransactionCount', [senderAddressHex, 'latest']),
      'eth_getTransactionCount',
    )
    demoAssert(BigInt(senderNonceResult) === 4n, 'sender nonce advanced to 4 (revert nonce effect remains)')

    const senderBalance = BigInt(
      asHex(await callRpc(url, 'eth_getBalance', [senderAddressHex, 'latest']), 'eth_getBalance sender'),
    )
    const recipientBalance = BigInt(
      asHex(await callRpc(url, 'eth_getBalance', [recipient.toString().toLowerCase(), 'latest']), 'eth_getBalance recipient'),
    )
    demoAssert(recipientBalance === ONE_ETHER, 'recipient received exactly the transfer value')
    demoAssert(senderBalance < GENESIS_BALANCE - ONE_ETHER, 'sender paid value plus gas fees')
    demoAssert(senderBalance > 0n, 'sender retains a positive balance')

    const genesisData = await chain.getCanonicalBlockByNumber(0n)
    const childData = await chain.getCanonicalBlockByNumber(1n)
    demoAssert(genesisData !== undefined && childData !== undefined, 'canonical genesis and child blocks are present')

    const genesisEnvelope = createEvmSettlementEnvelope(genesisData.blockRlpHex)
    const childEnvelope = createEvmSettlementEnvelope(childData.blockRlpHex, genesisEnvelope.commitmentHash, [])
    const batch = createEvmSettlementBatch([genesisEnvelope, childEnvelope])

    const replay = await verifyEvmSettlementBatchExecution(batch, ZERO_COMMITMENT, ZERO_HASH, '0')
    demoAssert(replay.executionVerified === true, 'settlement replay execution is verified')
    demoAssert(replay.blocksVerified === 2 && replay.childBlocksReexecuted === 1, 'replay covers genesis plus one child block')
    const exported = await exportEvmSettlementBatchFile(batchFilePath, batch, {
      previousCommitment: ZERO_COMMITMENT,
      parentHash: ZERO_HASH,
      startHeight: '0',
    })
    demoAssert(exported.batchHash === batch.batchHash, 'exported batch file matches the in-memory batch hash')

    return {
      format: 'btcs-l2-client-demo-summary',
      version: 1,
      chainId: 31337,
      dataDirectory,
      batchFilePath,
      deployTx: { hash: deployTx, contractAddress: deployedAddress },
      incrementTx: { hash: incrementTx, status: 1 },
      revertedTx: { hash: revertedTx, status: 0 },
      transferTx: { hash: transferTx, status: 1 },
      blockNumber: 1,
      reads: {
        codeBytes: (code.length - 2) / 2,
        storageValue: storageValue.toString(),
        incrementLogCount: 1,
        revertLogCount: 0,
        senderNonce: 4,
        senderBalanceWei: senderBalance.toString(),
        recipientBalanceWei: recipientBalance.toString(),
      },
      settlement: {
        version: EVM_SETTLEMENT_BATCH_VERSION,
        startHeight: '0',
        endHeight: '1',
        blocksVerified: replay.blocksVerified,
        childBlocksReexecuted: replay.childBlocksReexecuted,
        executionVerified: replay.executionVerified === true,
        batchHash: batch.batchHash,
      },
      notes: {
        whatThisProves: [
          'A local BTCS L2 EVM chain runs headlessly with no BTCS Core: fixed genesis, dev sequencer, signed EIP-1559 transactions.',
          'Counter deploys and increments; the transfer moves native value; receipts, code, storage, balances, and logs are served over JSON-RPC.',
          'A reverted transaction keeps status 0 with rolled-back storage/logs while its nonce and gas effects remain.',
          'A genesis-starting settlement batch is built from canonical block RLP and verified by verifyEvmSettlementBatchExecution; the emitted batch file is accepted by npm run verify:batch:execution.',
        ],
        doesNotProve: [
          'This demo does not call eth_call or eth_estimateGas. The server implements both; this run does not exercise them.',
          'Blocks are mined only by explicit btcs_dev_mine; there is no automatic mining.',
          'No withdrawal path, escrow, production balance semantics, or L1 acceptance is present.',
          'This is not a production sequencer, RPC server, rollup, proof system, or BTCS settlement client.',
        ],
      },
    }
  } finally {
    await server.close()
    if (cleanDirectory) {
      await rm(dataDirectory, { recursive: true, force: true })
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const options: ClientDemoOptions = {}
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--datadir' && args[index + 1] !== undefined) {
      options.datadir = args[index + 1]
      index += 1
    } else if (args[index] === '--batch-out' && args[index + 1] !== undefined) {
      options.batchOut = args[index + 1]
      index += 1
    } else {
      process.stderr.write('Usage: npm run demo:client -- [--datadir <path>] [--batch-out <path>]\n')
      process.exitCode = 2
      return
    }
  }
  const summary = await runClientDemo(options)
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`demo:client failed: ${message}\n`)
    process.exitCode = 1
  })
}