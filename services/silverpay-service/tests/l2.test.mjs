import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createL2Reader, normalizeL2Address } from '../src/l2.mjs'

test('normalizes and rejects L2 account addresses', () => {
  assert.equal(normalizeL2Address(`0x${'A'.repeat(40)}`), `0x${'a'.repeat(40)}`)
  assert.throws(() => normalizeL2Address('0x1234'), /20-byte/)
})

test('reads chain and account data through the allowlisted methods', async () => {
  const reader = createL2Reader({
    async call(method, params) {
      if (method === 'eth_chainId') return '0x7a69'
      if (method === 'eth_blockNumber') return '0x10'
      if (method === 'web3_clientVersion') return 'BTCS-L2/test'
      if (method === 'net_version') return '31337'
      if (method === 'net_listening') return true
      if (method === 'eth_getBalance') return '0xde0b6b3a7640000'
      if (method === 'eth_getTransactionCount') return '0x3'
      if (method === 'eth_getCode') return '0x'
      throw new Error(`unexpected method ${method} ${params}`)
    },
  })
  const network = await reader.readNetwork()
  assert.equal(network.chainId, 31337)
  assert.equal(network.blockNumber, 16)
  assert.equal(network.chainIdHex, '0x7a69')

  const account = await reader.readAccount(`0x${'A'.repeat(40)}`)
  assert.equal(account.address, `0x${'a'.repeat(40)}`)
  assert.equal(account.balanceWei, '1000000000000000000')
  assert.equal(account.nonce, 3)
  assert.equal(account.isContract, false)
  assert.equal(account.readOnly, true)
})

test('rejects malformed RPC quantities', async () => {
  const reader = createL2Reader({
    async call(method) {
      if (method === 'eth_chainId') return 'not-hex'
      if (method === 'eth_blockNumber') return '0x1'
      if (method === 'web3_clientVersion') return 'client'
      if (method === 'net_version') return '1'
      if (method === 'net_listening') return true
      return '0x0'
    },
  })
  await assert.rejects(reader.readNetwork(), /hex quantity/)
})
