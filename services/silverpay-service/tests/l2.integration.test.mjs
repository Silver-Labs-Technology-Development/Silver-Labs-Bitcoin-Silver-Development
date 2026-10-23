import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createReaders } from '../src/server.mjs'

const endpoint = process.env.SILVERPAY_L2_RPC_URL

test('SilverPay reads its configured local BTCS L2 node through the shared SDK', {
  skip: !endpoint && 'Set SILVERPAY_L2_RPC_URL to a running local BTCS L2 RPC',
}, async () => {
  const { l2: reader } = createReaders({
    l1: {
      url: 'http://127.0.0.1:18443',
      timeoutMs: 1000,
    },
    l2: {
      url: endpoint,
      timeoutMs: 5000,
    },
  })
  const network = await reader.readNetwork()
  assert.equal(network.chainId, 31337)
  assert.ok(network.clientVersion.startsWith('BTCSL2/'))
  assert.equal(network.networkIdentitySchemaVersion, 1)
  assert.equal(network.profileId, 'btcs-l2-local')

  const account = await reader.readAccount(`0x${'00'.repeat(20)}`)
  assert.equal(account.address, `0x${'00'.repeat(20)}`)
  assert.ok(/^(0|[1-9][0-9]*)$/.test(account.balanceWei))
  assert.ok(account.readOnly)
})
