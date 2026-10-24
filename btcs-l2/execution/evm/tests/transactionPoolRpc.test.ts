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
import { SENDER_ADDRESS } from '../src/config.js'
import { signFeeMarketTransaction } from '../src/transactions.js'
import { startLocalRpcServer } from '../src/rpc.js'
import { compileCounter } from '../src/compile.js'
import { MAX_RAW_TRANSACTION_BYTES } from '../src/transactionPool.js'

type RpcResult = {
  id: unknown
  result?: unknown
  error?: { code: number; message: string }
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
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-v014-rpc-'))
  const chain = await PersistentBlockProcessor.open(directory)
  const server = await startLocalRpcServer(chain, {
    port: 0,
    enableDevelopmentSequencer,
  })
  try {
    return await run(chain, `http://${server.host}:${server.port}`)
  } finally {
    await server.close()
    await rm(directory, { recursive: true, force: true })
  }
}

test('keeps submission and development block production disabled unless explicitly enabled', async () => {
  await withRpc(false, async (chain, url) => {
    const transaction = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    const raw = bytesToHex(transaction.serialize())
    assert.equal((await callRpc(url, 'eth_sendRawTransaction', [raw])).error?.code, -32601)
    assert.equal((await callRpc(url, 'btcs_dev_mine')).error?.code, -32601)
    assert.equal(chain.tip.number, 0n)
  })
})

test('accepts signed raw transactions into memory and includes them only after explicit btcs_dev_mine', async () => {
  await withRpc(true, async (chain, url) => {
    const compiled = compileCounter()
    const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
    const deployment = signFeeMarketTransaction({
      nonce: 0n,
      data: compiled.creationBytecode,
      gasLimit: 500_000n,
    })
    const deploymentHash = bytesToHex(deployment.hash()).toLowerCase()
    const accepted = await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(deployment.serialize())])
    assert.equal(accepted.result, deploymentHash)
    assert.equal(chain.tip.number, 0n)
    assert.equal((await callRpc(url, 'eth_blockNumber')).result, '0x0')
    assert.equal((await callRpc(url, 'eth_getTransactionReceipt', [deploymentHash])).result, null)

    assert.equal((await callRpc(url, 'eth_sendRawTransaction', ['0x0'])).error?.code, -32602)
    assert.equal((await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(deployment.serialize()), SENDER_ADDRESS.toString()])).error?.code, -32602)
    const oversized = await callRpc(url, 'eth_sendRawTransaction', [`0x${'00'.repeat(MAX_RAW_TRANSACTION_BYTES + 1)}`])
    assert.equal(oversized.error?.code, -32005)

    const mined = await callRpc(url, 'btcs_dev_mine')
    const block = mined.result as {
      number: string
      parentHash: string
      timestamp: string
      transactions: string[]
      discardedTransactions: unknown[]
    }
    assert.equal(block.number, '0x1')
    assert.equal(block.parentHash.length, 66)
    assert.equal(block.timestamp, (GENESIS_TIMESTAMP + 1n).toString(16).replace(/^/, '0x'))
    assert.deepEqual(block.transactions, [deploymentHash])
    assert.deepEqual(block.discardedTransactions, [])
    assert.equal(chain.tip.number, 1n)
    assert.ok(((await callRpc(url, 'eth_getCode', [contractAddress.toString(), 'latest'])).result as string).length > 2)

    const incrementSelector = compiled.methodIdentifiers['increment()']
    const revertSelector = compiled.methodIdentifiers['incrementThenRevert()']
    assert.ok(incrementSelector)
    assert.ok(revertSelector)
    const increment = signFeeMarketTransaction({
      nonce: 1n,
      to: contractAddress,
      data: hexToBytes(`0x${incrementSelector}`),
      gasLimit: 150_000n,
    })
    const incrementHash = bytesToHex(increment.hash()).toLowerCase()
    assert.equal((await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(increment.serialize())])).result, incrementHash)
    const incrementBlock = await callRpc(url, 'btcs_dev_mine')
    assert.deepEqual((incrementBlock.result as { transactions: string[] }).transactions, [incrementHash])
    const incrementReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [incrementHash])).result as {
      status: string
      logs: Array<{ transactionHash: string; logIndex: string }>
    }
    assert.equal(incrementReceipt.status, '0x1')
    assert.equal(incrementReceipt.logs.length, 1)
    assert.equal(incrementReceipt.logs[0]?.transactionHash, incrementHash)
    assert.equal(incrementReceipt.logs[0]?.logIndex, '0x0')

    const revert = signFeeMarketTransaction({
      nonce: 2n,
      to: contractAddress,
      data: hexToBytes(`0x${revertSelector}`),
      gasLimit: 150_000n,
    })
    const revertHash = bytesToHex(revert.hash()).toLowerCase()
    await callRpc(url, 'eth_sendRawTransaction', [bytesToHex(revert.serialize())])
    const revertBlock = await callRpc(url, 'btcs_dev_mine')
    assert.deepEqual((revertBlock.result as { transactions: string[] }).transactions, [revertHash])
    const revertReceipt = (await callRpc(url, 'eth_getTransactionReceipt', [revertHash])).result as {
      status: string
      logs: unknown[]
    }
    assert.equal(revertReceipt.status, '0x0')
    assert.deepEqual(revertReceipt.logs, [])
    const storage = await callRpc(url, 'eth_getStorageAt', [contractAddress.toString(), '0x0', 'latest'])
    assert.equal(storage.result, `0x${'00'.repeat(31)}01`)
  })
})
