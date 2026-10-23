import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BtcsL1CoreRpcClient } from '../src/btcsL1CoreRpc.js'

const txid = '1'.repeat(64)
const blockHash = '2'.repeat(64)

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

test('uses the expected read-only Core RPC methods and parameters', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  const calls: Array<{ url: string; body: Record<string, unknown> }> = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    })
    const body = calls.length === 1
      ? { txid, blockhash: blockHash }
      : calls.length === 2
        ? { hash: blockHash, height: 10, confirmations: 6 }
        : '00ff'
    return response({ result: body, error: null, id: calls.length })
  }) as typeof fetch

  const client = new BtcsL1CoreRpcClient({ url: 'http://127.0.0.1:8332' })
  assert.deepEqual(await client.getRawTransaction(txid, blockHash), {
    txid, blockhash: blockHash,
  })
  assert.deepEqual(await client.getBlockHeader(blockHash), {
    hash: blockHash, height: 10, confirmations: 6,
  })
  assert.equal(await client.getTxOutProof(txid, blockHash), '00ff')

  assert.deepEqual(calls.map((call) => ({
    url: call.url,
    method: call.body.method,
    params: call.body.params,
    jsonrpc: call.body.jsonrpc,
  })), [
    {
      url: 'http://127.0.0.1:8332/',
      method: 'getrawtransaction',
      params: [txid, true, blockHash],
      jsonrpc: '1.0',
    },
    {
      url: 'http://127.0.0.1:8332/',
      method: 'getblockheader',
      params: [blockHash, true],
      jsonrpc: '1.0',
    },
    {
      url: 'http://127.0.0.1:8332/',
      method: 'gettxoutproof',
      params: [[txid], blockHash],
      jsonrpc: '1.0',
    },
  ])
})

test('sends optional HTTP Basic authentication without embedding credentials in the URL', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  let authorization: string | null = null
  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get('authorization')
    return response({ result: {}, error: null, id: 1 })
  }) as typeof fetch

  const client = new BtcsL1CoreRpcClient({
    url: 'http://localhost:8332',
    username: 'rpcuser',
    password: 'rpcpass',
  })
  await client.getBlockHeader(blockHash)
  assert.equal(authorization, `Basic ${Buffer.from('rpcuser:rpcpass').toString('base64')}`)
})

test('rejects non-loopback URLs, embedded credentials, and invalid options', () => {
  for (const url of [
    'https://127.0.0.1:8332',
    'http://192.0.2.10:8332',
    'http://user:pass@127.0.0.1:8332',
    'http://127.0.0.1:8332/?token=secret',
  ]) {
    assert.throws(() => new BtcsL1CoreRpcClient({ url }), /loopback URL/)
  }

  assert.throws(
    () => new BtcsL1CoreRpcClient({ url: 'http://127.0.0.1:8332', username: 'user' }),
    /credentials are incomplete/,
  )
  assert.throws(
    () => new BtcsL1CoreRpcClient({ url: 'http://127.0.0.1:8332', timeoutMs: 0 }),
    /timeout must be between/,
  )
})

test('rejects HTTP errors, malformed JSON, mismatched IDs, and Core RPC errors', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  const client = new BtcsL1CoreRpcClient({ url: 'http://127.0.0.1:8332' })

  globalThis.fetch = (async () => response({}, 401)) as typeof fetch
  await assert.rejects(client.getBlockHeader(blockHash), /HTTP 401/)

  globalThis.fetch = (async () => new Response('not json')) as typeof fetch
  await assert.rejects(client.getBlockHeader(blockHash), /invalid JSON/)

  globalThis.fetch = (async () => response({ result: {}, error: null, id: 999 })) as typeof fetch
  await assert.rejects(client.getBlockHeader(blockHash), /ID does not match/)

  globalThis.fetch = (async () =>
    response({ result: null, error: { code: -5, message: 'Block not found' }, id: 4 })
  ) as typeof fetch
  await assert.rejects(client.getBlockHeader(blockHash), /method getblockheader failed: Block not found/)
})

test('rejects transport failures and missing result fields', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  const client = new BtcsL1CoreRpcClient({ url: 'http://127.0.0.1:8332' })

  globalThis.fetch = (async () => { throw new Error('private transport detail') }) as typeof fetch
  await assert.rejects(client.getBlockHeader(blockHash), /request failed or timed out/)

  globalThis.fetch = (async () => response({ error: null, id: 2 })) as typeof fetch
  await assert.rejects(client.getBlockHeader(blockHash), /has no result/)
})
