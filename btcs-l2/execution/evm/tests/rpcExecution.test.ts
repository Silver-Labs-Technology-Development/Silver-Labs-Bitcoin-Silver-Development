import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bytesToHex, createContractAddress, hexToBytes } from '@ethereumjs/util'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
} from '../src/blockProcessor.js'
import { compileCounter } from '../src/compile.js'
import { EVM_CHAIN_ID, GENESIS_BALANCE, SENDER_ADDRESS } from '../src/config.js'
import { startLocalRpcServer } from '../src/rpc.js'
import { signFeeMarketTransaction } from '../src/transactions.js'

type RpcResult = {
  jsonrpc?: string
  id?: unknown
  result?: unknown
  error?: { code: number; message: string; data?: string }
}

const RECIPIENT = `0x${'aa'.repeat(20)}`
// Coinbase is the zero address and receives priority fees, so it is not unfunded.
const UNFUNDED = `0x${'bb'.repeat(20)}`

function selector(compiled: ReturnType<typeof compileCounter>, signature: string): Uint8Array {
  const identifier = compiled.methodIdentifiers[signature]
  assert.ok(identifier, signature)
  return hexToBytes(`0x${identifier}`)
}

async function callRpc(url: string, method: string, params: unknown[] = []): Promise<RpcResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return await response.json() as RpcResult
}

async function withRpc<T>(
  enableDevelopmentSequencer: boolean,
  run: (chain: PersistentBlockProcessor, url: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-rpc-exec-'))
  const chain = await PersistentBlockProcessor.open(directory)
  const server = await startLocalRpcServer(chain, { port: 0, enableDevelopmentSequencer })
  try {
    return await run(chain, `http://${server.host}:${server.port}`)
  } finally {
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
}

async function deployCounter(chain: PersistentBlockProcessor) {
  const compiled = compileCounter()
  const address = createContractAddress(SENDER_ADDRESS, 0n)
  const deployment = await chain.buildNextBlock(
    [signFeeMarketTransaction({ nonce: 0n, data: compiled.creationBytecode, gasLimit: 500_000n })],
    GENESIS_TIMESTAMP + 1n,
  )
  const increment = await chain.buildNextBlock(
    [signFeeMarketTransaction({
      nonce: 1n,
      to: address,
      data: selector(compiled, 'increment()'),
      gasLimit: 150_000n,
    })],
    GENESIS_TIMESTAMP + 2n,
  )
  return { compiled, address, deployment, increment }
}

async function accountSnapshot(url: string, contract: string) {
  const sender = SENDER_ADDRESS.toString().toLowerCase()
  // The server accepts four concurrent HTTP calls. Read sequentially so a
  // snapshot is not rejected as too many requests.
  const tip = await callRpc(url, 'eth_blockNumber')
  const senderBalance = await callRpc(url, 'eth_getBalance', [sender, 'latest'])
  const senderNonce = await callRpc(url, 'eth_getTransactionCount', [sender, 'latest'])
  const recipientBalance = await callRpc(url, 'eth_getBalance', [RECIPIENT, 'latest'])
  const code = await callRpc(url, 'eth_getCode', [contract, 'latest'])
  const storage = await callRpc(url, 'eth_getStorageAt', [contract, '0x0', 'latest'])
  return {
    tip: tip.result,
    senderBalance: senderBalance.result,
    senderNonce: senderNonce.result,
    recipientBalance: recipientBalance.result,
    code: code.result,
    storage: storage.result,
  }
}

test('net_version, net_listening, and net_peerCount report the local chain', async () => {
  await withRpc(false, async (_chain, url) => {
    const version = await callRpc(url, 'net_version')
    const listening = await callRpc(url, 'net_listening')
    const peers = await callRpc(url, 'net_peerCount')
    assert.equal(version.result, EVM_CHAIN_ID.toString(10))
    assert.equal(version.result, '31337')
    assert.equal(listening.result, false)
    assert.equal(peers.result, '0x0')
    assert.equal((await callRpc(url, 'net_version', ['0x1'])).error?.code, -32602)
    assert.equal((await callRpc(url, 'net_listening', [true])).error?.code, -32602)
    assert.equal((await callRpc(url, 'net_peerCount', ['0x0'])).error?.code, -32602)
    assert.equal((await callRpc(url, 'net_peerCount')).result, '0x0')
  })
})

test('eth_getTransactionByHash returns the canonical transaction or null', async () => {
  await withRpc(false, async (chain, url) => {
    assert.equal((await callRpc(url, 'eth_getTransactionByHash', [])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getTransactionByHash', ['0x1234'])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_getTransactionByHash', [`0x${'ab'.repeat(32)}`])).result, null)

    const { address, increment } = await deployCounter(chain)
    const outcome = increment.summary.receipts[0]
    assert.ok(outcome)
    const byHash = await callRpc(url, 'eth_getTransactionByHash', [outcome.transactionHash])
    const block = await callRpc(url, 'eth_getBlockByNumber', [increment.summary.number.startsWith('0x')
      ? increment.summary.number
      : `0x${BigInt(increment.summary.number).toString(16)}`, true])
    const transactions = (block.result as { transactions: unknown[] }).transactions
    assert.equal(transactions.length, 1)
    assert.deepEqual(byHash.result, transactions[0])
    const transaction = byHash.result as {
      hash: string
      from: string
      to: string
      blockHash: string
      transactionIndex: string
      input: string
    }
    assert.equal(transaction.hash, outcome.transactionHash)
    assert.equal(transaction.from, SENDER_ADDRESS.toString().toLowerCase())
    assert.equal(transaction.to, address.toString().toLowerCase())
    assert.equal(transaction.blockHash, increment.summary.hash)
    assert.equal(transaction.transactionIndex, '0x0')
    assert.equal(transaction.input, bytesToHex(selector((await Promise.resolve(compileCounter())), 'increment()')))
  })
})

test('eth_call reads contract state without persisting writes, reverts, or value', async () => {
  await withRpc(false, async (chain, url) => {
    const { compiled, address } = await deployCounter(chain)
    const contract = address.toString().toLowerCase()
    const sender = SENDER_ADDRESS.toString().toLowerCase()
    const countData = bytesToHex(selector(compiled, 'count()'))
    const incrementData = bytesToHex(selector(compiled, 'increment()'))
    const revertData = bytesToHex(selector(compiled, 'incrementThenRevert()'))
    const before = await accountSnapshot(url, contract)

    const latest = await callRpc(url, 'eth_call', [{ to: contract, data: countData }, 'latest'])
    assert.equal(latest.result, `0x${'00'.repeat(31)}01`)
    const historical = await callRpc(url, 'eth_call', [{ to: contract, data: countData }, '0x1'])
    assert.equal(historical.result, `0x${'00'.repeat(32)}`)
    const omittedFrom = await callRpc(url, 'eth_call', [{ to: contract, data: countData }])
    assert.equal(omittedFrom.result, latest.result)

    const simulatedWrite = await callRpc(url, 'eth_call', [{
      from: sender,
      to: contract,
      data: incrementData,
    }, 'latest'])
    assert.equal(simulatedWrite.result, '0x')
    const simulatedHistoricalWrite = await callRpc(url, 'eth_call', [{
      from: sender,
      to: contract,
      data: incrementData,
    }, '0x1'])
    assert.equal(simulatedHistoricalWrite.result, '0x')

    const transfer = await callRpc(url, 'eth_call', [{
      from: sender,
      to: RECIPIENT,
      value: '0x1',
    }])
    assert.equal(transfer.result, '0x')
    const poorTransfer = await callRpc(url, 'eth_call', [{
      from: UNFUNDED,
      to: sender,
      value: '0x1',
    }])
    assert.equal(poorTransfer.error?.code, -32000)
    assert.match(poorTransfer.error?.message ?? '', /funds|balance/i)

    const reverted = await callRpc(url, 'eth_call', [{ to: contract, data: revertData }])
    assert.equal(reverted.error?.code, 3)
    assert.equal(reverted.error?.message, 'execution reverted')
    assert.match(reverted.error?.data ?? '', /^0x08c379a0/)
    assert.deepEqual(await accountSnapshot(url, contract), before)
    assert.ok(BigInt(String(before.senderBalance)) < GENESIS_BALANCE)

    const batch = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: contract, data: incrementData }] },
        { jsonrpc: '2.0', id: 2, method: 'eth_getStorageAt', params: [contract, '0x0', 'latest'] },
        { jsonrpc: '2.0', id: 3, method: 'eth_getBalance', params: [sender, 'latest'] },
      ]),
    })
    const batchBody = await batch.json() as RpcResult[]
    assert.equal(batchBody[0]?.result, '0x')
    assert.equal(batchBody[1]?.result, before.storage)
    assert.equal(batchBody[2]?.result, before.senderBalance)

    assert.equal((await callRpc(url, 'eth_call', [])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_call', [{ from: '0x1234', to: contract }])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_call', [{ to: contract, data: '0x1' }])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_call', [{
      to: contract,
      data: countData,
      input: '0x1234',
    }])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_call', [{ to: contract, data: countData }, 'pending'])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_call', [{ to: contract, data: countData, chainId: '0x1' }])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_call', [
      { to: contract, data: countData },
      'latest',
      { [contract]: { balance: '0x1' } },
    ])).error?.code, -32602)
    assert.deepEqual(await accountSnapshot(url, contract), before)
    assert.equal(chain.tip.number, 2n)
  })
})

test('eth_estimateGas uses execution and rejects reverts, missing funds, and bad input', async () => {
  await withRpc(false, async (chain, url) => {
    const { compiled, address } = await deployCounter(chain)
    const contract = address.toString().toLowerCase()
    const sender = SENDER_ADDRESS.toString().toLowerCase()
    const incrementData = bytesToHex(selector(compiled, 'increment()'))
    const revertData = bytesToHex(selector(compiled, 'incrementThenRevert()'))
    const before = await accountSnapshot(url, contract)

    const estimated = await callRpc(url, 'eth_estimateGas', [{
      from: sender,
      to: contract,
      data: incrementData,
    }])
    const gasLimit = BigInt(estimated.result as string)
    assert.equal(typeof estimated.result, 'string')
    assert.match(String(estimated.result), /^0x[1-9a-f][0-9a-f]*$/)
    const unfunded = await callRpc(url, 'eth_estimateGas', [{
      from: UNFUNDED,
      to: contract,
      data: incrementData,
    }])
    assert.equal(unfunded.result, undefined)
    assert.equal(unfunded.error?.code, -32000)
    assert.match(unfunded.error?.message ?? '', /insufficient funds/i)
    const reverted = await callRpc(url, 'eth_estimateGas', [{
      from: sender,
      to: contract,
      data: revertData,
    }])
    assert.equal(reverted.error?.code, 3)
    assert.match(reverted.error?.data ?? '', /^0x08c379a0/)
    const underpriced = await callRpc(url, 'eth_estimateGas', [{
      from: sender,
      to: contract,
      data: incrementData,
      gasPrice: '0x1',
    }])
    assert.equal(underpriced.error?.code, -32000)
    assert.match(underpriced.error?.message ?? '', /base fee/i)
    assert.equal((await callRpc(url, 'eth_estimateGas', [{ from: sender, to: contract, bogus: true }])).error?.code, -32602)
    assert.deepEqual(await accountSnapshot(url, contract), before)

    // Execution out-of-gas is included with status 0. Only intrinsic-gas
    // failures abort block construction. One less than the estimate must
    // not execute successfully.
    let underpricedFailure = ''
    let underpricedStatus: number | undefined
    try {
      const underpriced = await chain.buildNextBlock(
        [signFeeMarketTransaction({
          nonce: 2n,
          to: address,
          data: selector(compiled, 'increment()'),
          gasLimit: gasLimit - 1n,
        })],
        GENESIS_TIMESTAMP + 3n,
      )
      underpricedStatus = underpriced.summary.receipts[0]?.status
    } catch (error) {
      underpricedFailure = error instanceof Error ? error.message : String(error)
    }
    if (underpricedFailure !== '') {
      assert.match(underpricedFailure, /gas|intrinsic/i)
      assert.equal(chain.tip.number, 2n)
    } else {
      assert.equal(underpricedStatus, 0)
      assert.equal(chain.tip.number, 3n)
    }

    const mined = await chain.buildNextBlock(
      [signFeeMarketTransaction({
        nonce: chain.tip.number === 2n ? 2n : 3n,
        to: address,
        data: selector(compiled, 'increment()'),
        gasLimit,
      })],
      GENESIS_TIMESTAMP + (chain.tip.number === 2n ? 3n : 4n),
    )
    const outcome = mined.summary.receipts[0]
    assert.ok(outcome)
    assert.equal(outcome.status, 1)
    assert.ok(BigInt(outcome.gasUsed) <= gasLimit)
    assert.equal((await callRpc(url, 'eth_getStorageAt', [contract, '0x0', 'latest'])).result, `0x${'00'.repeat(31)}02`)
  })
})

test('eth_getTransactionByHash returns a real pending transaction only while it is queued', async () => {
  await withRpc(true, async (chain, url) => {
    const tx = signFeeMarketTransaction({
      nonce: 0n,
      to: SENDER_ADDRESS,
      value: 5n,
      gasLimit: 21_000n,
    })
    const hash = bytesToHex(tx.hash()).toLowerCase()
    const submitted = await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(tx.serialize())])
    assert.equal(submitted.result, hash)
    assert.equal(chain.tip.number, 0n)

    const pending = await callRpc(url, 'eth_getTransactionByHash', [hash])
    const pendingTx = pending.result as {
      blockHash: null
      blockNumber: null
      transactionIndex: null
      hash: string
      from: string
      to: string
      nonce: string
      value: string
      input: string
    }
    assert.equal(pendingTx.blockHash, null)
    assert.equal(pendingTx.blockNumber, null)
    assert.equal(pendingTx.transactionIndex, null)
    assert.equal(pendingTx.hash, hash)
    assert.equal(pendingTx.from, SENDER_ADDRESS.toString().toLowerCase())
    assert.equal(pendingTx.to, SENDER_ADDRESS.toString().toLowerCase())
    assert.equal(pendingTx.nonce, '0x0')
    assert.equal(pendingTx.value, '0x5')
    assert.equal(pendingTx.input, '0x')
    assert.equal((await callRpc(url, 'eth_getTransactionReceipt', [hash])).result, null)

    const mined = await callRpc(url, 'btcs_dev_mine')
    assert.equal((mined.result as { transactions: string[] }).transactions[0], hash)
    const canonical = await callRpc(url, 'eth_getTransactionByHash', [hash])
    const block = await callRpc(url, 'eth_getBlockByNumber', ['0x1', true])
    assert.deepEqual(canonical.result, (block.result as { transactions: unknown[] }).transactions[0])
    assert.equal((canonical.result as { blockNumber: string }).blockNumber, '0x1')
    assert.equal((await callRpc(url, 'eth_getTransactionByHash', [`0x${'cd'.repeat(32)}`])).result, null)
  })
})
