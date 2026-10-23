import assert from 'node:assert/strict'
import { test } from 'node:test'
import { coinsToSats, createL1Reader } from '../src/l1.mjs'

test('converts BTCS coin amounts to exact satoshis', () => {
  assert.equal(coinsToSats(0), '0')
  assert.equal(coinsToSats(1), '100000000')
  assert.equal(coinsToSats('0.00000001'), '1')
  assert.equal(coinsToSats('12.34567890'), '1234567890')
  assert.throws(() => coinsToSats('1.000000001'), /valid BTCS decimal/)
  assert.throws(() => coinsToSats('-1'), /valid BTCS decimal/)
})

test('reads real-shaped L1 network and wallet data without fabricating values', async () => {
  const calls = []
  const rpc = {
    async call(method, params = []) {
      calls.push([method, params])
      if (method === 'getblockchaininfo') {
        return {
          chain: 'regtest',
          blocks: 556,
          headers: 556,
          bestblockhash: 'a'.repeat(64),
          difficulty: 4.656542373906925e-10,
          verificationprogress: 1,
          initialblockdownload: false,
          pruned: false,
          warnings: '',
        }
      }
      if (method === 'getnetworkinfo') {
        return {
          subversion: '/BitcoinSilver:1.0.0/',
          protocolversion: 70016,
          connections: 0,
          networkactive: true,
        }
      }
      if (method === 'getwalletinfo') return { walletname: 'silverpay' }
      if (method === 'getbalances') {
        return { mine: { trusted: 1.5, pending: 0.25, immature: 0 } }
      }
      if (method === 'listunspent') {
        return [
          {
            txid: 'b'.repeat(64),
            vout: 0,
            address: 'bcrt1qexample',
            amount: 1.5,
            confirmations: 12,
            spendable: true,
            solvable: true,
            safe: true,
          },
        ]
      }
      throw new Error(`unexpected method ${method}`)
    },
  }
  const reader = createL1Reader(rpc)
  const network = await reader.readNetwork()
  const wallet = await reader.readWallet()

  assert.equal(network.chain, 'regtest')
  assert.equal(network.blocks, 556)
  assert.equal(network.peer.connections, 0)
  assert.equal(wallet.walletName, 'silverpay')
  assert.equal(wallet.trustedSats, '150000000')
  assert.equal(wallet.pendingSats, '25000000')
  assert.equal(wallet.balanceSats, '175000000')
  assert.equal(wallet.utxos[0].amountSats, '150000000')
  assert.equal(wallet.utxos[0].address, 'bcrt1qexample')
  assert.equal(wallet.readOnly, true)
  assert.deepEqual(calls.find(([method]) => method === 'listunspent')[1], [0, 9999999])
})

test('fails closed on malformed wallet data', async () => {
  const reader = createL1Reader({
    async call(method) {
      if (method === 'getwalletinfo') return { walletname: 'wallet' }
      if (method === 'getbalances') return { mine: { trusted: 'not-a-number' } }
      return []
    },
  })
  await assert.rejects(reader.readWallet(), /valid BTCS decimal/)
})
