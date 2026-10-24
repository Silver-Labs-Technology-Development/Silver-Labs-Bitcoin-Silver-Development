import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bytesToHex, createContractAddress, hexToBytes, utf8ToBytes } from '@ethereumjs/util'
import { keccak_256 } from '@noble/hashes/sha3.js'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
} from '../src/blockProcessor.js'
import { compileCounter } from '../src/compile.js'
import { EVM_CHAIN_ID, GENESIS_BALANCE, SENDER_ADDRESS } from '../src/config.js'
import { signFeeMarketTransaction } from '../src/transactions.js'
import {
  MAX_RPC_BATCH_COUNT,
  MAX_RPC_CONCURRENT_REQUESTS,
  MAX_RPC_JSON_DEPTH,
  MAX_RPC_JSON_NODES,
  MAX_RPC_CONTAINER_ITEMS,
  MAX_LOG_BLOCK_SPAN,
  MAX_RPC_REQUEST_BYTES,
  MAX_RPC_RESPONSE_BYTES,
  RPC_BIND_ADDRESS,
  isAllowedRpcHost,
  serializeBoundedRpcResponse,
  startLocalRpcServer,
} from '../src/rpc.js'

type RpcResult = {
  jsonrpc: string
  id: unknown
  result?: unknown
  error?: { code: number; message: string }
}

function topic(signature: string): string {
  return `0x${Buffer.from(keccak_256(utf8ToBytes(signature))).toString('hex')}`
}

async function withRpc<T>(run: (directory: string, chain: PersistentBlockProcessor, url: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-v012-rpc-'))
  const chain = await PersistentBlockProcessor.open(directory)
  const server = await startLocalRpcServer(chain, { port: 0 })
  try {
    return await run(directory, chain, `http://${server.host}:${server.port}`)
  } finally {
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function callRpc(
  url: string,
  method: string,
  params: unknown[] = [],
  id: unknown = 1,
): Promise<{ status: number; body: RpcResult; headers: Headers }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  })
  return {
    status: response.status,
    body: response.status === 204 ? { jsonrpc: '2.0', id: null } : await response.json() as RpcResult,
    headers: response.headers,
  }
}

async function deployAndIncrement(chain: PersistentBlockProcessor) {
  const compiled = compileCounter()
  const address = createContractAddress(SENDER_ADDRESS, 0n)
  const selector = compiled.methodIdentifiers['increment()']
  assert.ok(selector)
  const deployment = await chain.buildNextBlock(
    [signFeeMarketTransaction({ nonce: 0n, data: compiled.creationBytecode, gasLimit: 500_000n })],
    GENESIS_TIMESTAMP + 1n,
  )
  const increment = await chain.buildNextBlock(
    [signFeeMarketTransaction({
      nonce: 1n,
      to: address,
      data: hexToBytes(`0x${selector}`),
      gasLimit: 150_000n,
    })],
    GENESIS_TIMESTAMP + 2n,
  )
  return { compiled, address, deployment, increment }
}

test('serves client version, chain identity, height, and canonical block lookups', async () => {
  await withRpc(async (_directory, chain, url) => {
    const client = await callRpc(url, 'web3_clientVersion')
    const chainId = await callRpc(url, 'eth_chainId')
    const blockNumber = await callRpc(url, 'eth_blockNumber')
    assert.equal(client.body.result, 'BTCSL2/v0.14-local/ethereumjs-vm-10.1.3/osaka')
    assert.equal(chainId.body.result, '0x7a69')
    assert.equal(chainId.body.result, `0x${EVM_CHAIN_ID.toString(16)}`)
    assert.equal(blockNumber.body.result, '0x0')

    const genesis = await callRpc(url, 'eth_getBlockByNumber', ['earliest', false])
    assert.equal(genesis.body.result && (genesis.body.result as { number: string }).number, '0x0')
    const genesisHash = (genesis.body.result as { hash: string }).hash
    const byHash = await callRpc(url, 'eth_getBlockByHash', [genesisHash, false])
    assert.deepEqual(byHash.body.result, genesis.body.result)
    assert.equal((genesis.body.result as { transactions: unknown[] }).transactions.length, 0)
    assert.equal((await callRpc(url, 'eth_getBlockByNumber', ['0x1', false])).body.result, null)
    assert.equal((await callRpc(url, 'eth_getBlockByHash', [`0x${'ff'.repeat(32)}`, false])).body.result, null)
    assert.deepEqual(chain.tip, { number: 0n, hash: genesisHash })
  })
})

test('serves canonical Counter code and state at latest, genesis, and historical block tags', async () => {
  await withRpc(async (_directory, chain, url) => {
    const { compiled, address, deployment, increment } = await deployAndIncrement(chain)
    const addressHex = address.toString().toLowerCase()
    const codeLatest = await callRpc(url, 'eth_getCode', [addressHex, 'latest'])
    const codeAtGenesis = await callRpc(url, 'eth_getCode', [addressHex, 'earliest'])
    const codeAtDeployment = await callRpc(url, 'eth_getCode', [addressHex, '0x1'])
    assert.equal(codeLatest.body.result, bytesToHex(await chain.getCode(address)))
    assert.notEqual(codeLatest.body.result, '0x')
    assert.equal(codeAtGenesis.body.result, '0x')
    assert.equal(codeAtDeployment.body.result, codeLatest.body.result)

    const storageLatest = await callRpc(url, 'eth_getStorageAt', [addressHex, '0x0', 'latest'])
    const storageAtGenesis = await callRpc(url, 'eth_getStorageAt', [addressHex, '0x0', '0x0'])
    const storageAtDeploy = await callRpc(url, 'eth_getStorageAt', [addressHex, '0x0', '0x1'])
    assert.equal(storageLatest.body.result, `0x${'00'.repeat(31)}01`)
    assert.equal(storageAtGenesis.body.result, `0x${'00'.repeat(32)}`)
    assert.equal(storageAtDeploy.body.result, `0x${'00'.repeat(32)}`)

    const senderBalanceAtGenesis = await callRpc(url, 'eth_getBalance', [SENDER_ADDRESS.toString(), 'earliest'])
    const senderBalanceAtDeploy = await callRpc(url, 'eth_getBalance', [SENDER_ADDRESS.toString(), '0x1'])
    const senderBalanceLatest = await callRpc(url, 'eth_getBalance', [SENDER_ADDRESS.toString(), 'latest'])
    assert.equal(senderBalanceAtGenesis.body.result, `0x${GENESIS_BALANCE.toString(16)}`)
    assert.ok(BigInt(senderBalanceAtDeploy.body.result as string) < GENESIS_BALANCE)
    assert.ok(BigInt(senderBalanceLatest.body.result as string) < BigInt(senderBalanceAtDeploy.body.result as string))

    const nonceAtGenesis = await callRpc(url, 'eth_getTransactionCount', [SENDER_ADDRESS.toString(), '0x0'])
    const nonceAtDeploy = await callRpc(url, 'eth_getTransactionCount', [SENDER_ADDRESS.toString(), '0x1'])
    const nonceLatest = await callRpc(url, 'eth_getTransactionCount', [SENDER_ADDRESS.toString(), 'latest'])
    assert.equal(nonceAtGenesis.body.result, '0x0')
    assert.equal(nonceAtDeploy.body.result, '0x1')
    assert.equal(nonceLatest.body.result, '0x2')

    assert.equal((await callRpc(url, 'eth_getCode', [addressHex, '0x3'])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getStorageAt', [addressHex, '0x0', '0x3'])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getBalance', [SENDER_ADDRESS.toString(), '0x3'])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getTransactionCount', [SENDER_ADDRESS.toString(), '0x3'])).body.error?.code, -32602)

    const historicalBatchRequests = [
      ['eth_getCode', [addressHex, '0x0']],
      ['eth_getCode', [addressHex, '0x1']],
      ['eth_getStorageAt', [addressHex, '0x0', '0x0']],
      ['eth_getStorageAt', [addressHex, '0x0', '0x1']],
      ['eth_getStorageAt', [addressHex, '0x0', '0x2']],
      ['eth_getBalance', [SENDER_ADDRESS.toString(), '0x0']],
      ['eth_getBalance', [SENDER_ADDRESS.toString(), '0x1']],
      ['eth_getTransactionCount', [SENDER_ADDRESS.toString(), '0x0']],
      ['eth_getTransactionCount', [SENDER_ADDRESS.toString(), '0x1']],
      ['eth_getTransactionCount', [SENDER_ADDRESS.toString(), '0x2']],
    ].map(([method, params], id) => ({ jsonrpc: '2.0', id, method, params }))
    const historicalBatch = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(historicalBatchRequests),
    })
    const historicalValues = await historicalBatch.json() as RpcResult[]
    assert.deepEqual(historicalValues.map((entry) => entry.result), [
      '0x', codeLatest.body.result,
      `0x${'00'.repeat(32)}`, `0x${'00'.repeat(32)}`, `0x${'00'.repeat(31)}01`,
      `0x${GENESIS_BALANCE.toString(16)}`, senderBalanceAtDeploy.body.result,
      '0x0', '0x1', '0x2',
    ])

    const fullBlock = await callRpc(url, 'eth_getBlockByNumber', ['latest', true])
    const blockResult = fullBlock.body.result as {
      number: string
      hash: string
      transactionsRoot: string
      receiptsRoot: string
      stateRoot: string
      withdrawalsRoot: string
      blobGasUsed: string
      excessBlobGas: string
      transactions: Array<Record<string, unknown>>
    }
    assert.equal(blockResult.number, '0x2')
    assert.equal(blockResult.hash, increment.summary.hash)
    assert.equal(blockResult.transactionsRoot, increment.summary.transactionsRoot)
    assert.equal(blockResult.receiptsRoot, increment.summary.receiptsRoot)
    assert.equal(blockResult.stateRoot, increment.summary.stateRoot)
    assert.match(blockResult.withdrawalsRoot, /^0x[0-9a-f]{64}$/)
    assert.match(blockResult.blobGasUsed, /^0x(?:0|[1-9a-f][0-9a-f]*)$/)
    assert.match(blockResult.excessBlobGas, /^0x(?:0|[1-9a-f][0-9a-f]*)$/)
    assert.equal(blockResult.transactions.length, 1)
    assert.equal(blockResult.transactions[0]?.hash, increment.summary.receipts[0]?.transactionHash)
    assert.equal(blockResult.transactions[0]?.from, SENDER_ADDRESS.toString().toLowerCase())
    assert.equal((blockResult.transactions[0]?.to as string).toLowerCase(), addressHex)

    const compactBlock = await callRpc(url, 'eth_getBlockByHash', [deployment.summary.hash, false])
    assert.deepEqual(
      (compactBlock.body.result as { transactions: string[] }).transactions,
      [deployment.summary.receipts[0]?.transactionHash],
    )
    const deploymentByNumber = await callRpc(url, 'eth_getBlockByNumber', ['0x1', false])
    assert.equal((deploymentByNumber.body.result as { hash: string }).hash, deployment.summary.hash)
  })
})

test('serves transaction receipts and canonical logs with Ethereum quantity and data encodings', async () => {
  await withRpc(async (_directory, chain, url) => {
    const { address, deployment, increment } = await deployAndIncrement(chain)
    const deploymentTxHash = deployment.summary.receipts[0]!.transactionHash
    const deploymentReceipt = await callRpc(url, 'eth_getTransactionReceipt', [deploymentTxHash])
    const deploymentReceiptValue = deploymentReceipt.body.result as {
      status: string
      contractAddress: string | null
      blockHash: string
    }
    assert.equal(deploymentReceiptValue.status, '0x1')
    assert.equal(deploymentReceiptValue.contractAddress, address.toString().toLowerCase())
    assert.equal(deploymentReceiptValue.blockHash, deployment.summary.hash)

    const transactionHash = increment.summary.receipts[0]!.transactionHash
    const receipt = await callRpc(url, 'eth_getTransactionReceipt', [transactionHash])
    const value = receipt.body.result as {
      transactionHash: string
      blockNumber: string
      blockHash: string
      transactionIndex: string
      gasUsed: string
      status: string
      logsBloom: string
      logs: Array<Record<string, unknown>>
    }
    assert.equal(value.transactionHash, transactionHash)
    assert.equal(value.blockNumber, '0x2')
    assert.equal(value.transactionIndex, '0x0')
    assert.equal(value.blockHash, increment.summary.hash)
    assert.ok(BigInt(value.gasUsed) > 0n)
    assert.equal(value.status, '0x1')
    assert.match(value.logsBloom, /^0x[0-9a-f]{512}$/)
    assert.equal(value.logs.length, 1)
    assert.deepEqual(value.logs[0]?.topics, [topic('Incremented(uint256)')])
    assert.equal(value.logs[0]?.data, `0x${'00'.repeat(31)}01`)
    assert.equal(value.logs[0]?.logIndex, '0x0')
    assert.equal(value.logs[0]?.address, address.toString().toLowerCase())
    assert.equal(value.logs[0]?.blockHash, increment.summary.hash)
    assert.equal(value.logs[0]?.blockNumber, '0x2')
    assert.equal(value.logs[0]?.transactionHash, transactionHash)
    assert.equal(value.logs[0]?.transactionIndex, '0x0')
    assert.equal(value.logs[0]?.removed, false)

    const byAddress = await callRpc(url, 'eth_getLogs', [{
      fromBlock: '0x2',
      toBlock: 'latest',
      address: address.toString(),
      topics: [topic('Incremented(uint256)')],
    }])
    assert.equal((byAddress.body.result as unknown[]).length, 1)
    const queriedLog = (byAddress.body.result as Array<Record<string, unknown>>)[0]
    assert.equal(queriedLog?.transactionHash, transactionHash)
    assert.equal(queriedLog?.blockHash, value.blockHash)
    assert.equal(queriedLog?.blockNumber, value.blockNumber)
    assert.equal(queriedLog?.transactionIndex, value.transactionIndex)
    assert.equal(queriedLog?.logIndex, value.logs[0]?.logIndex)
    assert.equal(queriedLog?.removed, false)
    const defaultLatest = await callRpc(url, 'eth_getLogs', [{ address: address.toString() }])
    assert.equal((defaultLatest.body.result as unknown[]).length, 1)
    assert.equal((await callRpc(url, 'eth_getLogs', [{ toBlock: '0x1' }])).body.error?.code, -32602)

    const genesis = await callRpc(url, 'eth_getBlockByNumber', ['earliest', false])
    const genesisHash = (genesis.body.result as { hash: string }).hash
    const genesisLogs = await callRpc(url, 'eth_getLogs', [{ blockHash: genesisHash }])
    assert.equal((genesisLogs.body.result as unknown[]).length, 0)
    const unknownReceipt = await callRpc(url, 'eth_getTransactionReceipt', [`0x${'00'.repeat(32)}`])
    assert.equal(unknownReceipt.body.result, null)
  })
})

test('keeps reverted transactions in receipts without committing their logs or storage, and serves empty blocks', async () => {
  await withRpc(async (_directory, chain, url) => {
    const compiled = compileCounter()
    const address = createContractAddress(SENDER_ADDRESS, 0n)
    const revertSelector = compiled.methodIdentifiers['incrementThenRevert()']
    assert.ok(revertSelector)
    await chain.buildNextBlock(
      [signFeeMarketTransaction({ nonce: 0n, data: compiled.creationBytecode, gasLimit: 500_000n })],
      GENESIS_TIMESTAMP + 1n,
    )
    const reverted = await chain.buildNextBlock(
      [signFeeMarketTransaction({
        nonce: 1n,
        to: address,
        data: hexToBytes(`0x${revertSelector}`),
        gasLimit: 150_000n,
      })],
      GENESIS_TIMESTAMP + 2n,
    )
    const empty = await chain.buildNextBlock([], GENESIS_TIMESTAMP + 3n)
    const transactionHash = reverted.summary.receipts[0]!.transactionHash

    const receipt = await callRpc(url, 'eth_getTransactionReceipt', [transactionHash])
    const receiptValue = receipt.body.result as {
      status: string
      transactionHash: string
      blockHash: string
      transactionIndex: string
      logs: unknown[]
    }
    assert.equal(receiptValue.status, '0x0')
    assert.equal(receiptValue.transactionHash, transactionHash)
    assert.equal(receiptValue.blockHash, reverted.summary.hash)
    assert.equal(receiptValue.transactionIndex, '0x0')
    assert.deepEqual(receiptValue.logs, [])
    assert.equal((await callRpc(url, 'eth_getStorageAt', [address.toString(), '0x0', 'latest'])).body.result,
      `0x${'00'.repeat(32)}`)
    assert.equal((await callRpc(url, 'eth_getTransactionCount', [SENDER_ADDRESS.toString(), 'latest'])).body.result, '0x2')

    const revertedBlockLogs = await callRpc(url, 'eth_getLogs', [{ blockHash: reverted.summary.hash }])
    assert.deepEqual(revertedBlockLogs.body.result, [])
    const emptyBlock = await callRpc(url, 'eth_getBlockByNumber', ['latest', false])
    const emptyBlockValue = emptyBlock.body.result as { hash: string; transactions: unknown[] }
    assert.equal(emptyBlockValue.hash, empty.summary.hash)
    assert.deepEqual(emptyBlockValue.transactions, [])
    assert.deepEqual(
      (await callRpc(url, 'eth_getLogs', [{ blockHash: empty.summary.hash }])).body.result,
      [],
    )

    const unknownBlock = await callRpc(url, 'eth_getBlockByHash', [`0x${'ef'.repeat(32)}`, false])
    assert.equal(unknownBlock.body.result, null)
    const unknownTransaction = await callRpc(url, 'eth_getTransactionReceipt', [`0x${'ef'.repeat(32)}`])
    assert.equal(unknownTransaction.body.result, null)
    assert.equal(chain.tip.hash, empty.summary.hash)
  })
})

test('uses block-global log indexes and transaction indexes across multiple transactions', async () => {
  await withRpc(async (_directory, chain, url) => {
    const compiled = compileCounter()
    const address = createContractAddress(SENDER_ADDRESS, 0n)
    const selector = compiled.methodIdentifiers['increment()']
    assert.ok(selector)
    await chain.buildNextBlock(
      [signFeeMarketTransaction({ nonce: 0n, data: compiled.creationBytecode, gasLimit: 500_000n })],
      GENESIS_TIMESTAMP + 1n,
    )
    const block = await chain.buildNextBlock([
      signFeeMarketTransaction({ nonce: 1n, to: address, data: hexToBytes(`0x${selector}`), gasLimit: 150_000n }),
      signFeeMarketTransaction({ nonce: 2n, to: address, data: hexToBytes(`0x${selector}`), gasLimit: 150_000n }),
    ], GENESIS_TIMESTAMP + 2n)

    const [firstHash, secondHash] = block.summary.receipts.map((receipt) => receipt.transactionHash)
    const firstReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [firstHash])).body.result as {
      transactionIndex: string
      gasUsed: string
      cumulativeGasUsed: string
      logs: Array<Record<string, unknown>>
    }
    const secondReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [secondHash])).body.result as {
      transactionIndex: string
      gasUsed: string
      cumulativeGasUsed: string
      logs: Array<Record<string, unknown>>
    }
    assert.equal(firstReceipt.transactionIndex, '0x0')
    assert.equal(firstReceipt.logs[0]?.logIndex, '0x0')
    assert.equal(secondReceipt.transactionIndex, '0x1')
    assert.equal(secondReceipt.logs[0]?.logIndex, '0x1')
    assert.equal(secondReceipt.logs[0]?.transactionHash, secondHash)
    assert.equal(BigInt(firstReceipt.cumulativeGasUsed), BigInt(firstReceipt.gasUsed))
    assert.equal(BigInt(secondReceipt.cumulativeGasUsed),
      BigInt(firstReceipt.gasUsed) + BigInt(secondReceipt.gasUsed))
    assert.equal(BigInt(secondReceipt.cumulativeGasUsed), BigInt(block.summary.gasUsed))

    const logs = await callRpc(url, 'eth_getLogs', [{ fromBlock: '0x2', toBlock: '0x2' }])
    const logValues = logs.body.result as Array<Record<string, unknown>>
    assert.equal(logValues.length, 2)
    assert.deepEqual(logValues.map((log) => log.logIndex), ['0x0', '0x1'])
    assert.deepEqual(logValues.map((log) => log.transactionIndex), ['0x0', '0x1'])
    assert.deepEqual(logValues.map((log) => log.transactionHash), [firstHash, secondHash])
  })
})

test('validates JSON-RPC envelopes, parameters, methods, and bounded batch/body sizes', async () => {
  await withRpc(async (_directory, _chain, url) => {
    const malformed = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":',
    })
    assert.equal(malformed.status, 400)
    assert.equal(((await malformed.json()) as RpcResult).error?.code, -32700)

    const malformedUtf8Body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }))
    malformedUtf8Body[malformedUtf8Body.indexOf('eth_chainId')] = 0xff
    const malformedUtf8 = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: malformedUtf8Body,
    })
    assert.equal(malformedUtf8.status, 400)
    assert.equal(((await malformedUtf8.json()) as RpcResult).error?.code, -32700)

    const wrongVersion = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 3, method: 'eth_chainId', params: [] }),
    })
    assert.equal(((await wrongVersion.json()) as RpcResult).error?.code, -32600)
    assert.equal((await callRpc(url, 'eth_chainId', [], 1.5)).body.error?.code, -32600)
    assert.equal((await callRpc(url, 'eth_chainId', [], 'x'.repeat(129))).body.error?.code, -32600)

    const notification = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [] }),
    })
    assert.equal(notification.status, 204)
    const mixedBatch = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 9, method: 'eth_chainId', params: [] },
        { jsonrpc: '2.0', method: 'eth_chainId', params: [] },
        { jsonrpc: '2.0', id: 3, method: 'not_a_method', params: [] },
      ]),
    })
    const mixedBatchBody = await mixedBatch.json() as RpcResult[]
    assert.deepEqual(mixedBatchBody.map((entry) => entry.id), [9, 3])
    assert.equal(mixedBatchBody[0]?.result, '0x7a69')
    assert.equal(mixedBatchBody[1]?.error?.code, -32601)

    assert.equal((await callRpc(url, 'not_a_method')).body.error?.code, -32601)
    assert.equal((await callRpc(url, 'eth_getBalance', ['0x1234', 'latest'])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getBlockByNumber', ['pending', false])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getBlockByNumber', ['0x1fffffffffffff', false])).body.result, null)
    assert.equal((await callRpc(url, 'eth_getBlockByNumber', ['0x20000000000000', false])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getBlockByNumber', ['0X1', false])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getStorageAt', [SENDER_ADDRESS.toString(), '0x00', 'latest'])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getLogs', [{ blockHash: `0x${'00'.repeat(32)}`, fromBlock: '0x0' }])).body.error?.code, -32602)

    const batch = Array.from({ length: MAX_RPC_BATCH_COUNT + 1 }, (_, id) => ({
      jsonrpc: '2.0', id, method: 'eth_chainId', params: [],
    }))
    const tooMany = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(batch),
    })
    assert.equal(((await tooMany.json()) as RpcResult).error?.code, -32600)

    const oversized = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: ' '.repeat(MAX_RPC_REQUEST_BYTES + 1),
    })
    assert.equal(oversized.status, 413)
    assert.equal(((await oversized.json()) as RpcResult).error?.code, -32005)

    let tooDeep: unknown = null
    for (let index = 0; index <= MAX_RPC_JSON_DEPTH; index++) tooDeep = [tooDeep]
    const deepResponse = await callRpc(url, 'eth_chainId', tooDeep as unknown[])
    assert.equal(deepResponse.body.error?.code, -32600)

    const tooManyItems = await callRpc(url, 'eth_chainId', Array(MAX_RPC_CONTAINER_ITEMS + 1).fill(null))
    assert.equal(tooManyItems.body.error?.code, -32600)

    const nodeHeavyParams = Array.from({ length: 40 }, () => Array(250).fill(null))
    const tooManyNodes = await callRpc(url, 'eth_chainId', nodeHeavyParams)
    assert.equal(tooManyNodes.body.error?.code, -32600)
  })
})

test('bounds serialized JSON-RPC response bytes', () => {
  const body = serializeBoundedRpcResponse({
    jsonrpc: '2.0',
    id: 77,
    result: 'x'.repeat(MAX_RPC_RESPONSE_BYTES),
  })
  const parsed = JSON.parse(body) as RpcResult
  assert.equal(parsed.id, 77)
  assert.equal(parsed.error?.code, -32005)
  assert.ok(Buffer.byteLength(body) <= MAX_RPC_RESPONSE_BYTES)
})

test('uses one verified canonical read view per HTTP request and never caches across requests', async () => {
  await withRpc(async (_directory, chain, url) => {
    let openedViews = 0
    const createView = chain.createCanonicalReadView.bind(chain)
    chain.createCanonicalReadView = async () => {
      openedViews += 1
      return createView()
    }

    assert.equal((await callRpc(url, 'eth_getBalance', ['0x1234', 'latest'])).body.error?.code, -32602)
    assert.equal((await callRpc(url, 'not_a_method')).body.error?.code, -32601)
    const malformed = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    })
    assert.equal(malformed.status, 400)
    const invalidEnvelope = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '1.0', id: 1, method: 'eth_blockNumber', params: [] }),
    })
    assert.equal(((await invalidEnvelope.json()) as RpcResult).error?.code, -32600)
    const duplicateProperty = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","method":"not_a_method","params":[]}',
    })
    const duplicateBody = await duplicateProperty.json() as RpcResult
    assert.equal(duplicateBody.error?.code, -32600)
    assert.equal(duplicateBody.id, null)
    const escapedDuplicateProperty = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","meth\\u006fd":"not_a_method","params":[]}',
    })
    const escapedDuplicateBody = await escapedDuplicateProperty.json() as RpcResult
    assert.equal(escapedDuplicateBody.error?.code, -32600)
    assert.equal(escapedDuplicateBody.id, null)
    const excessiveRange = await callRpc(url, 'eth_getLogs', [{
      fromBlock: '0x0',
      toBlock: `0x${MAX_LOG_BLOCK_SPAN.toString(16)}`,
    }])
    assert.equal(excessiveRange.body.error?.code, -32005)
    assert.equal(openedViews, 0)

    const batch = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] },
        { jsonrpc: '2.0', id: 2, method: 'eth_getBlockByNumber', params: ['latest', false] },
        { jsonrpc: '2.0', id: 3, method: 'eth_getBalance', params: [SENDER_ADDRESS.toString(), 'latest'] },
      ]),
    })
    const batchBody = await batch.json() as RpcResult[]
    assert.deepEqual(batchBody.map((entry) => entry.id), [1, 2, 3])
    assert.equal(openedViews, 1)

    assert.equal((await callRpc(url, 'eth_blockNumber')).body.result, '0x0')
    assert.equal(openedViews, 2)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
    assert.equal((await callRpc(url, 'eth_blockNumber')).body.result, '0x1')
    assert.equal(openedViews, 3)
  })
})

test('returns generic RPC errors without exposing unexpected exception details', async () => {
  await withRpc(async (_directory, chain, url) => {
    chain.createCanonicalReadView = async () => {
      throw new Error('/tmp/private/.env SECRET_KEY=do-not-return')
    }
    const response = await callRpc(url, 'eth_blockNumber')
    assert.equal(response.body.error?.code, -32603)
    assert.equal(response.body.error?.message, 'Internal error')
    assert.doesNotMatch(JSON.stringify(response.body), /\/tmp\/private|SECRET_KEY|do-not-return/)
  })
})

test('server binds only loopback, rejects hostile hosts and paths, and sends no CORS permission', async () => {
  await withRpc(async (_directory, _chain, url) => {
    assert.ok(url.startsWith(`http://${RPC_BIND_ADDRESS}:`))
    const port = Number(new URL(url).port)
    assert.equal(isAllowedRpcHost(`${RPC_BIND_ADDRESS}:${port}`, port), true)
    assert.equal(isAllowedRpcHost(`LOCALHOST:${port}`, port), true)
    assert.equal(isAllowedRpcHost('127.0.0.1', 80), true)
    assert.equal(isAllowedRpcHost('localhost:80', 80), true)
    assert.equal(isAllowedRpcHost('127.0.0.1', 8545), false)
    assert.equal(isAllowedRpcHost('attacker.example:8545', 8545), false)
    const allowed = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }),
    })
    assert.equal(allowed.headers.get('access-control-allow-origin'), null)

    const hostileHostStatus = await new Promise<number>((resolve, reject) => {
      const port = Number(new URL(url).port)
      const request = httpRequest({
        hostname: RPC_BIND_ADDRESS,
        port,
        method: 'POST',
        headers: { 'content-type': 'application/json', host: 'attacker.example:8545' },
      }, (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode ?? 0))
      })
      request.once('error', reject)
      request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }))
    })
    assert.equal(hostileHostStatus, 403)

    const traversalPathStatus = await new Promise<number>((resolve, reject) => {
      const target = new URL(url)
      const request = httpRequest({
        hostname: RPC_BIND_ADDRESS,
        port: Number(target.port),
        method: 'POST',
        path: '/../../chain.json',
        headers: { host: target.host, 'content-type': 'application/json' },
      }, (response) => {
        response.resume()
        response.once('end', () => resolve(response.statusCode ?? 0))
      })
      request.once('error', reject)
      request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }))
    })
    assert.equal(traversalPathStatus, 404)
    const options = await fetch(url, { method: 'OPTIONS' })
    assert.equal(options.status, 405)
    assert.equal(options.headers.get('access-control-allow-origin'), null)
  })
})

test('caps concurrent RPC requests while canonical replay is in progress', async () => {
  await withRpc(async (_directory, chain, url) => {
    let entered = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const createView = chain.createCanonicalReadView.bind(chain)
    chain.createCanonicalReadView = async () => {
      entered += 1
      await gate
      return createView()
    }
    const target = new URL(url)
    const rawRequest = () => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = httpRequest({
        hostname: RPC_BIND_ADDRESS,
        port: Number(target.port),
        method: 'POST',
        path: '/',
        headers: { host: target.host, 'content-type': 'application/json' },
      }, (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.once('end', () => resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }))
      })
      request.once('error', reject)
      request.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }))
    })

    const pending = Array.from({ length: MAX_RPC_CONCURRENT_REQUESTS }, () => rawRequest())
    try {
      for (let attempt = 0; attempt < 100 && entered < MAX_RPC_CONCURRENT_REQUESTS; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      assert.equal(entered, MAX_RPC_CONCURRENT_REQUESTS)
      const overflow = await rawRequest()
      assert.equal(overflow.status, 503)
      assert.equal((JSON.parse(overflow.body) as RpcResult).error?.code, -32005)
    } finally {
      release()
    }
    const completed = await Promise.all(pending)
    assert.deepEqual(completed.map((result) => result.status), Array(MAX_RPC_CONCURRENT_REQUESTS).fill(200))
  })
})

test('does not provide a fake transaction pool or let RPC bypass canonical validation', async () => {
  await withRpc(async (directory, chain, url) => {
    const beforeTip = chain.tip
    const submission = await callRpc(url, 'eth_sendRawTransaction', [`0x${'02'.repeat(40)}`])
    assert.equal(submission.body.error?.code, -32601)
    assert.equal((await callRpc(url, 'btcs_dev_mine')).body.error?.code, -32601)
    assert.deepEqual(chain.tip, beforeTip)

    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    const accepted = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const recordPath = join(directory, 'blocks', `${accepted.summary.hash.slice(2)}.json`)
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as { receiptRlpHexes: string[] }
    record.receiptRlpHexes[0] = '0x00'
    await writeFile(recordPath, `${JSON.stringify(record)}\n`)

    const verificationFailure = await callRpc(url, 'eth_blockNumber')
    assert.equal(verificationFailure.body.error?.code, -32000)
    assert.equal(verificationFailure.body.error?.message, 'Canonical chain verification failed')
    assert.equal((await callRpc(url, 'eth_getBlockByNumber', ['0x1', false])).body.error?.code, -32000)
    assert.equal((await callRpc(url, 'eth_getTransactionReceipt', [accepted.summary.receipts[0]!.transactionHash])).body.error?.code, -32000)
    assert.equal((await callRpc(url, 'eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x1' }])).body.error?.code, -32000)
    assert.deepEqual(chain.tip, { number: 1n, hash: accepted.summary.hash })
    assert.equal((await callRpc(url, 'eth_sendRawTransaction', ['0x00'])).body.error?.code, -32601)
  })
})
