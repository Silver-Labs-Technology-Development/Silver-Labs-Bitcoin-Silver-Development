import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getRecentTransactions, lookupExplorerQuery } from './explorer.js'

test('recent explorer transactions are collected from full blocks and enriched with receipts', async () => {
  const blocks = [
    {
      number: 12,
      hash: '0xblock12',
      transactions: [
        { hash: '0xsuccess', from: '0xsender', to: '0xreceiver' },
        { hash: '0xreverted', from: '0xsender', to: null },
      ],
    },
  ]
  const calls = []
  const callRpc = async (method, params) => {
    calls.push([method, params])
    return params[0] === '0xsuccess'
      ? { gasUsed: '0x5208', status: '0x1' }
      : { gasUsed: '0x7a12', status: '0x0' }
  }

  const transactions = await getRecentTransactions(blocks, callRpc)

  assert.deepEqual(calls, [
    ['eth_getTransactionReceipt', ['0xsuccess']],
    ['eth_getTransactionReceipt', ['0xreverted']],
  ])
  assert.deepEqual(
    transactions.map(({ blockNumber, blockHash, receiptGasUsed, receiptStatus }) => ({
      blockNumber,
      blockHash,
      receiptGasUsed,
      receiptStatus,
    })),
    [
      { blockNumber: 12, blockHash: '0xblock12', receiptGasUsed: '0x5208', receiptStatus: '0x1' },
      { blockNumber: 12, blockHash: '0xblock12', receiptGasUsed: '0x7a12', receiptStatus: '0x0' },
    ],
  )
})

test('recent explorer transaction receipt lookup respects the display limit', async () => {
  const blocks = [{
    number: 2,
    hash: '0xblock2',
    transactions: [{ hash: '0xfirst' }, { hash: '0xsecond' }],
  }]
  const calls = []

  const transactions = await getRecentTransactions(
    blocks,
    async (_method, params) => {
      calls.push(params[0])
      return null
    },
    1,
  )

  assert.deepEqual(calls, ['0xfirst'])
  assert.equal(transactions.length, 1)
  assert.equal(transactions[0].receiptGasUsed, null)
  assert.equal(transactions[0].receiptStatus, null)
})

test('recent explorer transaction receipt failures remain visible to the caller', async () => {
  await assert.rejects(
    getRecentTransactions(
      [{ number: 1, hash: '0xblock1', transactions: [{ hash: '0xtransaction' }] }],
      async () => {
        throw new Error('RPC unavailable')
      },
    ),
    /RPC unavailable/,
  )
})

test('recent explorer rejects blocks without the requested full transaction list', async () => {
  await assert.rejects(
    getRecentTransactions([{ number: 3, hash: '0xblock3' }], async () => null),
    /missing its full transaction list/,
  )
})

test('explorer looks up block numbers and enriches their transactions', async () => {
  const calls = []
  const block = {
    number: '0x2a',
    hash: `0x${'ab'.repeat(32)}`,
    timestamp: '0x64',
    gasUsed: '0x5208',
    gasLimit: '0x100000',
    miner: '0xminer',
    transactions: [{ hash: `0x${'12'.repeat(32)}` }],
  }
  const callRpc = async (method, params) => {
    calls.push([method, params])
    if (method === 'eth_getBlockByNumber') return block
    if (method === 'eth_getTransactionReceipt') return { gasUsed: '0x5208', status: '0x1' }
    throw new Error(`Unexpected RPC method: ${method}`)
  }

  const result = await lookupExplorerQuery('42', callRpc)

  assert.equal(result.type, 'block')
  assert.equal(result.block.number, 42)
  assert.equal(result.block.txCount, 1)
  assert.equal(result.transactions[0].receiptStatus, '0x1')
  assert.deepEqual(calls, [
    ['eth_getBlockByNumber', ['0x2a', true]],
    ['eth_getTransactionReceipt', [`0x${'12'.repeat(32)}`]],
  ])
})

test('explorer looks up transaction hashes when no block has the matching hash', async () => {
  const transactionHash = `0x${'34'.repeat(32)}`
  const transaction = { hash: transactionHash, blockNumber: '0x8', from: '0xsender' }
  const calls = []
  const callRpc = async (method, params) => {
    calls.push([method, params])
    if (method === 'eth_getBlockByHash') return null
    if (method === 'eth_getTransactionByHash') return transaction
    if (method === 'eth_getTransactionReceipt') return { gasUsed: '0x1234', status: '0x0' }
    throw new Error(`Unexpected RPC method: ${method}`)
  }

  const result = await lookupExplorerQuery(transactionHash, callRpc)

  assert.equal(result.type, 'transaction')
  assert.equal(result.transaction.receiptGasUsed, '0x1234')
  assert.equal(result.transaction.receiptStatus, '0x0')
  assert.deepEqual(calls.map(([method]) => method), [
    'eth_getBlockByHash',
    'eth_getTransactionByHash',
    'eth_getTransactionReceipt',
  ])
})

test('explorer looks up blocks by hash and reports missing records explicitly', async () => {
  const blockHash = `0x${'56'.repeat(32)}`
  const block = {
    number: '0x1',
    hash: blockHash,
    timestamp: '0x1',
    gasUsed: '0x0',
    gasLimit: '0x100000',
    miner: '0xminer',
    transactions: [],
  }

  const blockResult = await lookupExplorerQuery(blockHash, async (method) =>
    method === 'eth_getBlockByHash' ? block : null,
  )
  assert.equal(blockResult.type, 'block')
  assert.equal(blockResult.block.hash, blockHash)

  const missing = await lookupExplorerQuery(blockHash, async () => null)
  assert.equal(missing, null)
})

test('explorer validates lookup values and safely rejects invalid RPC responses', async () => {
  await assert.rejects(lookupExplorerQuery('', async () => null), /Enter a block number/)
  await assert.rejects(lookupExplorerQuery('1.2', async () => null), /32-byte block\/transaction hash/)
  await assert.rejects(lookupExplorerQuery('9'.repeat(20), async () => null), /32-byte block\/transaction hash/)
  await assert.rejects(
    lookupExplorerQuery('0x7', async () => ({ number: '0x7', transactions: null })),
    /missing its full transaction list/,
  )
})
