import assert from 'node:assert/strict'
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PreflightError,
  assertCliExecutable,
  assertDataDirectory,
  parseRpcCookie,
  preflight,
  readRpcCookie,
  resolveE2EConfig,
  type CoreChainInfo,
  type E2EConfig,
} from '../scripts/regtest-deposit-settlement-e2e.js'

const REGTEST_INFO: CoreChainInfo = {
  chain: 'regtest',
  blocks: 101,
  bestblockhash: 'ab'.repeat(32),
}

async function withTempDir(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-preflight-test-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function createFakeCli(directory: string): Promise<string> {
  const cliPath = join(directory, 'bitcoinsilver-cli')
  await writeFile(cliPath, '#!/bin/sh\nexit 0\n')
  await chmod(cliPath, 0o755)
  return cliPath
}

async function createCoreTree(directory: string): Promise<E2EConfig> {
  const cliPath = await createFakeCli(directory)
  const dataDir = join(directory, 'datadir')
  const cookiePath = join(dataDir, 'regtest', '.cookie')
  await mkdir(join(dataDir, 'regtest'), { recursive: true })
  await writeFile(cookiePath, '__cookie__:secret\n')
  return { cliPath, dataDir, rpcPort: '29445', cookiePath }
}

test('resolveE2EConfig rejects a missing HOME', () => {
  assert.throws(() => resolveE2EConfig({}), PreflightError)
})

test('resolveE2EConfig rejects an invalid RPC port', () => {
  for (const port of ['0', '65536', 'abc', '-1']) {
    assert.throws(
      () => resolveE2EConfig({ HOME: '/home/test', BTCS_L1_RPC_PORT: port }),
      /BTCS_L1_RPC_PORT/,
    )
  }
})

test('resolveE2EConfig derives the default regtest paths from HOME', () => {
  const config = resolveE2EConfig({ HOME: '/home/test' })
  assert.equal(config.rpcPort, '29445')
  assert.equal(
    config.cookiePath,
    join('/home/test', '.local/share/btcs-l2-deposit-regtest-20261011', 'regtest', '.cookie'),
  )
})

test('parseRpcCookie accepts a valid cookie and rejects malformed ones', () => {
  assert.deepEqual(parseRpcCookie('user:pass\n'), {
    username: 'user',
    password: 'pass',
  })
  for (const malformed of ['no-colon', ':missing-user', 'missing-password:', '']) {
    assert.throws(() => parseRpcCookie(malformed), PreflightError)
  }
})

test('readRpcCookie rejects a missing cookie file without printing its path contents', async () => {
  await withTempDir(async (directory) => {
    await assert.rejects(
      readRpcCookie(join(directory, 'absent', '.cookie')),
      /cannot read the local RPC cookie/,
    )
  })
})

test('assertCliExecutable rejects a missing CLI', async () => {
  await withTempDir(async (directory) => {
    await assert.rejects(
      assertCliExecutable(join(directory, 'missing-cli')),
      /not found/,
    )
  })
})

test('assertCliExecutable rejects a non-executable CLI', async (t) => {
  if (process.getuid?.() === 0) {
    t.skip('running as root, so execute bits are not enforced')
    return
  }
  await withTempDir(async (directory) => {
    const cliPath = join(directory, 'bitcoinsilver-cli')
    await writeFile(cliPath, '#!/bin/sh\n')
    await chmod(cliPath, 0o644)
    await assert.rejects(assertCliExecutable(cliPath), /not executable/)
  })
})

test('assertDataDirectory rejects a missing directory and does not create it', async () => {
  await withTempDir(async (directory) => {
    const dataDir = join(directory, 'absent-datadir')
    await assert.rejects(assertDataDirectory(dataDir), /does not exist/)
    await assert.rejects(stat(dataDir), { code: 'ENOENT' })
  })
})

test('preflight fails fast when the data directory is missing', async () => {
  await withTempDir(async (directory) => {
    const cliPath = await createFakeCli(directory)
    const dataDir = join(directory, 'absent-datadir')
    const config: E2EConfig = {
      cliPath,
      dataDir,
      rpcPort: '29445',
      cookiePath: join(dataDir, 'regtest', '.cookie'),
    }
    await assert.rejects(preflight(config), /does not exist/)
    await assert.rejects(stat(dataDir), { code: 'ENOENT' })
  })
})

test('preflight rejects a non-regtest chain without contacting Core', async () => {
  await withTempDir(async (directory) => {
    const config = await createCoreTree(directory)
    await assert.rejects(
      preflight(config, {
        readChainInfo: () => ({ ...REGTEST_INFO, chain: 'main' }),
      }),
      /chain=regtest/,
    )
  })
})

test('preflight accepts a regtest chain reported by the injected probe', async () => {
  await withTempDir(async (directory) => {
    const config = await createCoreTree(directory)
    const chainInfo = await preflight(config, {
      readChainInfo: () => REGTEST_INFO,
    })
    assert.equal(chainInfo.chain, 'regtest')
    assert.equal(chainInfo.blocks, 101)
  })
})
