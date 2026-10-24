import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { loadConfig, publicConfig } from '../src/config.mjs'

test('loads safe loopback defaults and never exposes credentials', () => {
  const config = loadConfig({})
  assert.equal(config.l1.url, 'http://127.0.0.1:18443')
  assert.equal(config.l2.url, 'http://127.0.0.1:8545')
  assert.equal(config.bindHost, '127.0.0.1')
  assert.equal(config.port, 3002)
  assert.equal(config.l1.auth, undefined)
  assert.equal(publicConfig(config).l1.auth, 'none')
})

test('rejects incomplete credentials, non-loopback binds and non-http RPC URLs', () => {
  assert.throws(
    () => loadConfig({ SILVERPAY_L1_RPC_USER: 'only-user' }),
    /provided together/,
  )
  assert.throws(
    () => loadConfig({ SILVERPAY_BIND_HOST: '0.0.0.0' }),
    /loopback/,
  )
  assert.throws(
    () => loadConfig({ SILVERPAY_L1_RPC_URL: 'ftp://127.0.0.1:18443' }),
    /http or https/,
  )
  assert.throws(
    () => loadConfig({ SILVERPAY_L2_RPC_URL: 'http://user:pass@127.0.0.1:8545' }),
    /embedded credentials/,
  )
  assert.throws(
    () => loadConfig({ SILVERPAY_ALLOWED_ORIGINS: 'not an origin' }),
    /invalid origin/,
  )
})

test('reads a Core cookie file without returning it in public config', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'silverpay-config-'))
  try {
    const cookieFile = join(directory, '.cookie')
    await writeFile(cookieFile, '__cookie__:super-secret\n', { mode: 0o600 })
    const config = loadConfig({ SILVERPAY_L1_COOKIE_FILE: cookieFile })
    assert.equal(config.l1.auth.username, '__cookie__')
    assert.equal(config.l1.auth.password, 'super-secret')
    const exposed = JSON.stringify(publicConfig(config))
    assert.equal(exposed.includes('super-secret'), false)
    assert.equal(exposed.includes('__cookie__'), false)
    assert.equal(publicConfig(config).l1.auth, 'configured')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
