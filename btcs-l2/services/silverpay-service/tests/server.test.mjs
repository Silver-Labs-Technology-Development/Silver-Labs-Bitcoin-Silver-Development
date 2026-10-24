import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createSilverPayServer } from '../src/server.mjs'
import { UpstreamError } from '../src/rpc.mjs'

const account = `0x${'a'.repeat(40)}`
const origin = 'http://127.0.0.1:3000'

let service
let baseUrl

const l1 = {
  async readNetwork() {
    return {
      chain: 'regtest',
      blocks: 556,
      headers: 556,
      bestBlockHash: 'a'.repeat(64),
      difficulty: 1,
      verificationProgress: 1,
      initialBlockDownload: false,
      pruned: false,
      warnings: '',
      peer: { subversion: '/BitcoinSilver:test/', protocolVersion: 70016, connections: 1, networkActive: true },
    }
  },
  async readWallet() {
    return {
      walletName: 'silverpay',
      balanceSats: '150000000',
      trustedSats: '150000000',
      pendingSats: '0',
      immatureSats: '0',
      utxoCount: 1,
      utxoTotal: 1,
      truncated: false,
      utxos: [
        {
          txid: 'b'.repeat(64),
          vout: 0,
          address: 'bcrt1qexample',
          label: '',
          amountSats: '150000000',
          confirmations: 12,
          spendable: true,
          solvable: true,
          safe: true,
        },
      ],
      readOnly: true,
    }
  },
}

const l2 = {
  async readNetwork() {
    return {
      chainId: 31337,
      chainIdHex: '0x7a69',
      blockNumber: 16,
      clientVersion: 'BTCS-L2/test',
      networkVersion: '31337',
      listening: true,
    }
  },
  async readAccount(address) {
    return {
      address,
      balanceWei: '1000000000000000000',
      nonce: 3,
      isContract: false,
      blockNumber: 16,
      readOnly: true,
    }
  },
}

before(async () => {
  const config = {
    bindHost: '127.0.0.1',
    port: 0,
    allowedOrigins: [origin],
    cacheTtlMs: 0,
    l1: {
      url: 'http://127.0.0.1:18443',
      auth: { username: '__cookie__', password: 'must-not-leak' },
      timeoutMs: 1000,
    },
    l2: { url: 'http://127.0.0.1:8545', timeoutMs: 1000 },
  }
  service = createSilverPayServer({ config, l1, l2, logger: { error() {} } })
  const address = await service.listen()
  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await service.close()
})

async function get(path, options = {}) {
  return fetch(`${baseUrl}${path}`, options)
}

test('reports separate L1 and L2 read-only status', async () => {
  const response = await get('/api/silverpay/status', { headers: { Origin: origin } })
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('access-control-allow-origin'), origin)
  const body = await response.json()
  assert.equal(body.format, 'btcs-l2-silverpay-status')
  assert.equal(body.readOnly, true)
  assert.equal(body.l1.ok, true)
  assert.equal(body.l1.network.data.chain, 'regtest')
  assert.equal(body.l1.wallet.data.balanceSats, '150000000')
  assert.equal(body.l1.wallet.data.readOnly, true)
  assert.equal(body.l2.ok, true)
  assert.equal(body.l2.network.data.chainId, 31337)
})

test('serves L1 wallet and L2 account data without wallet credentials', async () => {
  const walletResponse = await get('/api/silverpay/l1/wallet')
  assert.equal(walletResponse.status, 200)
  const wallet = await walletResponse.json()
  assert.equal(wallet.data.utxos.length, 1)
  assert.equal(wallet.data.utxos[0].amountSats, '150000000')

  const accountResponse = await get(`/api/silverpay/l2/account/${account}`)
  assert.equal(accountResponse.status, 200)
  const body = await accountResponse.json()
  assert.equal(body.data.address, account)
  assert.equal(body.data.balanceWei, '1000000000000000000')
  assert.equal(body.data.nonce, 3)
})

test('health exposes configuration status but not credentials', async () => {
  const response = await get('/healthz')
  assert.equal(response.status, 200)
  const text = await response.text()
  assert.equal(text.includes('must-not-leak'), false)
  assert.equal(text.includes('__cookie__'), false)
  const body = JSON.parse(text)
  assert.equal(body.ok, true)
  assert.equal(body.config.l1.auth, 'configured')
  assert.equal(body.readOnly, true)
})

test('rejects invalid accounts and unsupported methods', async () => {
  const invalid = await get('/api/silverpay/l2/account/0x1234')
  assert.equal(invalid.status, 400)
  assert.equal((await invalid.json()).error.code, 'invalid_request')

  const post = await get('/api/silverpay/status', { method: 'POST' })
  assert.equal(post.status, 405)
  assert.equal((await post.json()).error.code, 'method_not_allowed')
  assert.equal(post.headers.get('allow'), 'GET, OPTIONS')
})

test('handles CORS preflight and rejects unknown origins', async () => {
  const preflight = await get('/api/silverpay/status', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin)

  const rejected = await get('/api/silverpay/status', {
    headers: { Origin: 'https://evil.example' },
  })
  assert.equal(rejected.status, 403)
  assert.equal((await rejected.json()).error.code, 'origin_not_allowed')
})

test('reports partial L1 failure honestly and returns 503 for wallet-only failures', async () => {
  const failingL1 = {
    async readNetwork() {
      return l1.readNetwork()
    },
    async readWallet() {
      throw new UpstreamError('rpc_error', 'L1 RPC error: wallet not loaded')
    },
  }
  const config = {
    bindHost: '127.0.0.1',
    port: 0,
    allowedOrigins: [origin],
    cacheTtlMs: 0,
    l1: { url: 'http://127.0.0.1:18443', auth: undefined, timeoutMs: 1000 },
    l2: { url: 'http://127.0.0.1:8545', timeoutMs: 1000 },
  }
  const app = createSilverPayServer({
    config,
    l1: failingL1,
    l2,
    logger: { error() {} },
  })
  const address = await app.listen()
  const root = `http://127.0.0.1:${address.port}`
  try {
    const status = await (await fetch(`${root}/api/silverpay/status`)).json()
    assert.equal(status.l1.ok, false)
    assert.equal(status.l1.network.ok, true)
    assert.equal(status.l1.wallet.ok, false)
    assert.equal(status.l1.wallet.error.code, 'rpc_error')
    assert.equal((await fetch(`${root}/api/silverpay/l1/wallet`)).status, 503)
  } finally {
    await app.close()
  }
})
