import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createSilverPayClient,
  formatDecimal,
  formatSats,
  formatWei,
  isStale,
  parseAccount,
  parseStatus,
  parseWallet,
  shorten,
  SilverPayError,
} from './silverpay.js'

const accountAddress = `0x${'a'.repeat(40)}`

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body
    },
  }
}

const statusBody = {
  format: 'btcs-l2-silverpay-status',
  version: 1,
  observedAt: '2026-10-22T10:00:00.000Z',
  readOnly: true,
  l1: {
    ok: true,
    network: {
      ok: true,
      data: { chain: 'regtest', blocks: 556, headers: 556 },
    },
    wallet: {
      ok: true,
      data: { walletName: 'silverpay', balanceSats: '150000000' },
    },
  },
  l2: {
    ok: true,
    network: {
      ok: true,
      data: { chainId: 31337, blockNumber: 16 },
    },
  },
}

const walletBody = {
  format: 'btcs-l2-silverpay-l1-wallet',
  version: 1,
  ok: true,
  observedAt: '2026-10-22T10:00:00.000Z',
  readOnly: true,
  data: {
    walletName: 'silverpay',
    balanceSats: '150000000',
    trustedSats: '150000000',
    pendingSats: '0',
    immatureSats: '0',
    utxoCount: 1,
    utxoTotal: 1,
    truncated: false,
    readOnly: true,
    utxos: [
      {
        txid: 'b'.repeat(64),
        vout: 0,
        address: 'bcrt1qexample',
        amountSats: '150000000',
        confirmations: 12,
        spendable: true,
        solvable: true,
        safe: true,
      },
    ],
  },
}

const accountBody = {
  format: 'btcs-l2-silverpay-l2-account',
  version: 1,
  ok: true,
  observedAt: '2026-10-22T10:00:00.000Z',
  readOnly: true,
  data: {
    address: accountAddress,
    balanceWei: '1000000000000000000',
    nonce: 3,
    isContract: false,
    blockNumber: 16,
    readOnly: true,
  },
}

test('adapter calls the read-only service and parses separate L1/L2 status', async () => {
  const client = createSilverPayClient({
    baseUrl: 'http://127.0.0.1:3002/',
    fetchImpl: async (url) => {
      assert.equal(url, 'http://127.0.0.1:3002/api/silverpay/status')
      return jsonResponse(200, statusBody)
    },
  })
  const status = await client.status()
  assert.equal(status.format, 'btcs-l2-silverpay-status')
  assert.equal(status.l1.network.ok, true)
  assert.equal(status.l1.wallet.ok, true)
  assert.equal(status.l2.network.data.chainId, 31337)
  assert.equal(status.readOnly, true)
})

test('adapter reads wallet and account data without inventing values', async () => {
  const client = createSilverPayClient({
    fetchImpl: async (url) => {
      if (url.endsWith('/api/silverpay/l1/wallet')) return jsonResponse(200, walletBody)
      if (url.endsWith(`/api/silverpay/l2/account/${accountAddress}`)) {
        return jsonResponse(200, accountBody)
      }
      throw new Error(`unexpected URL ${url}`)
    },
  })
  const wallet = await client.wallet()
  assert.equal(wallet.data.walletName, 'silverpay')
  assert.equal(wallet.data.balanceSats, '150000000')
  assert.equal(wallet.data.utxos[0].vout, 0)
  assert.equal(wallet.data.readOnly, true)

  const account = await client.account(accountAddress.toUpperCase().replace('0X', '0x'))
  assert.equal(account.data.address, accountAddress)
  assert.equal(account.data.balanceWei, '1000000000000000000')
  assert.equal(account.data.nonce, 3)
})

test('adapter surfaces service errors and rejects fabricated or malformed responses', async () => {
  const serviceError = createSilverPayClient({
    fetchImpl: async () => jsonResponse(503, {
      ok: false,
      error: { code: 'rpc_error', message: 'L1 RPC error: wallet not loaded' },
    }),
  })
  await assert.rejects(serviceError.wallet(), (error) => {
    assert.ok(error instanceof SilverPayError)
    assert.equal(error.code, 'rpc_error')
    return true
  })

  const malformed = createSilverPayClient({
    fetchImpl: async () => jsonResponse(200, { format: 'wrong', version: 1 }),
  })
  await assert.rejects(malformed.status(), /format is unsupported/)

  await assert.rejects(
    createSilverPayClient({ fetchImpl: async () => jsonResponse(200, { ...statusBody, l1: {} }) }).status(),
    /status\.l1\.network/,
  )
})

test('adapter rejects network failures and invalid account requests', async () => {
  const client = createSilverPayClient({
    fetchImpl: async () => {
      throw new Error('connection refused')
    },
  })
  await assert.rejects(client.status(), (error) => error.code === 'network_error')
  await assert.rejects(client.account('0x1234'), /20-byte/)
})

test('formats exact sats/wei and detects stale observations', () => {
  assert.equal(formatSats('150000000'), '1.5')
  assert.equal(formatSats('1'), '0.00000001')
  assert.equal(formatWei('1000000000000000000'), '1')
  assert.equal(formatWei('1'), '0.000000000000000001')
  assert.equal(formatDecimal('123000', 3), '123')
  assert.equal(shorten(`0x${'a'.repeat(40)}`), '0xaaaaaa…aaaaaa')
  assert.equal(isStale('2026-10-22T10:00:00.000Z', Date.parse('2026-10-22T10:00:10.000Z')), false)
  assert.equal(isStale('2026-10-22T10:00:00.000Z', Date.parse('2026-10-22T10:01:00.000Z')), true)
  assert.equal(isStale('not-a-date'), true)
})

test('parsers fail closed on nonzero but malformed envelopes', () => {
  assert.throws(() => parseWallet({ ...walletBody, data: { ...walletBody.data, balanceSats: '-1' } }), /integer amount/)
  assert.throws(() => parseAccount({ ...accountBody, data: { ...accountBody.data, address: '0x1' } }), /malformed/)
  assert.throws(() => parseStatus({ ...statusBody, observedAt: 'bad' }), /timestamp/)
})
