import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createL2Reader, normalizeL2Address } from '../src/l2.mjs'

const address = `0x${'A'.repeat(40)}`

function createMockFetch(values) {
  const methods = []
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body)
    methods.push(request.method)
    const result = values[request.method]
    if (result instanceof Error) {
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: { code: -32601, message: result.message },
          }
        },
      }
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return { jsonrpc: '2.0', id: request.id, result }
      },
    }
  }
  return { fetchImpl, methods }
}

const rpcValues = {
  'web3_clientVersion': 'BTCSL2/v0.14-local/test',
  'eth_chainId': '0x7a69',
  'eth_blockNumber': '0x10',
  'net_version': '31337',
  'net_listening': false,
  'eth_getBalance': '0xde0b6b3a7640000',
  'eth_getTransactionCount': '0x3',
  'eth_getCode': '0x',
}

test('normalizes and rejects L2 account addresses', () => {
  assert.equal(normalizeL2Address(address), address.toLowerCase())
  assert.throws(() => normalizeL2Address('0x1234'), /20-byte/)
})

test('reads identity and account data through the shared read-only SDK', async () => {
  const { fetchImpl, methods } = createMockFetch(rpcValues)
  const reader = createL2Reader({
    endpoint: 'http://127.0.0.1:8545',
    fetchImpl,
  })
  const network = await reader.readNetwork()
  assert.equal(network.chainId, 31337)
  assert.equal(network.blockNumber, 16)
  assert.equal(network.chainIdHex, '0x7a69')
  assert.equal(network.clientVersion, 'BTCSL2/v0.14-local/test')
  assert.equal(network.networkIdentitySchemaVersion, 1)
  assert.equal(network.profileId, 'btcs-l2-local')
  assert.equal(network.readOnly, true)
  assert.equal(network.listening, false)

  const account = await reader.readAccount(address)
  assert.equal(account.address, address.toLowerCase())
  assert.equal(account.balanceWei, '1000000000000000000')
  assert.equal(account.nonce, 3)
  assert.equal(account.isContract, false)
  assert.equal(account.blockNumber, 16)
  assert.equal(account.readOnly, true)
  assert.deepEqual(new Set(methods), new Set(Object.keys(rpcValues)))
})

test('rejects an unrelated EVM endpoint with a matching chain ID', async () => {
  const { fetchImpl } = createMockFetch({
    ...rpcValues,
    'web3_clientVersion': 'Geth/v1.15.0',
  })
  const reader = createL2Reader({
    endpoint: 'http://127.0.0.1:8545',
    fetchImpl,
  })
  await assert.rejects(reader.readNetwork(), /BTCS L2 local profile/)
  await assert.rejects(reader.readAccount(address), /BTCS L2 local profile/)
})

test('reports unsupported methods and malformed account data explicitly', async () => {
  const { fetchImpl } = createMockFetch({
    ...rpcValues,
    'eth_chainId': new Error('Method not found'),
  })
  const reader = createL2Reader({
    endpoint: 'http://127.0.0.1:8545',
    fetchImpl,
  })
  await assert.rejects(reader.readNetwork(), /JSON-RPC error -32601/)

  const malformed = createMockFetch({
    ...rpcValues,
    'eth_getBalance': 'not-hex',
  })
  const malformedReader = createL2Reader({
    endpoint: 'http://127.0.0.1:8545',
    fetchImpl: malformed.fetchImpl,
  })
  await assert.rejects(malformedReader.readAccount(address), /Account balance is not a valid JSON-RPC quantity/)
})
