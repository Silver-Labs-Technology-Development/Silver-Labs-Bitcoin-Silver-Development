import assert from 'node:assert/strict'
import { test } from 'node:test'

import { getRecentTransactions } from './explorer.js'

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
