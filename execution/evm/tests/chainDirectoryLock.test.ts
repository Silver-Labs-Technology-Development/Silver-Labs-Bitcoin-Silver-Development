import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
} from '../src/blockProcessor.js'
import {
  CHAIN_DIRECTORY_LOCK_FILENAME,
  ChainDirectoryLockError,
  chainDirectoryLockPath,
} from '../src/chainDirectoryLock.js'

function runWriter(chainDirectory: string, barrierDirectory: string) {
  const fixturePath = resolve('tests/fixtures/chain-directory-writer.ts')
  const child = spawn(process.execPath, [
    '--import',
    'tsx',
    fixturePath,
    chainDirectory,
    barrierDirectory,
  ], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  const exit = new Promise<number>((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('close', (code) => {
      if (code === null) rejectExit(new Error(`writer exited without a code: ${stderr}`))
      else resolveExit(code)
    })
  })
  return { exit, stdout: () => stdout, stderr: () => stderr }
}

async function waitForReadyFiles(directory: string, count: number): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const files = (await readdir(directory)).filter((file) => file.endsWith('.ready'))
    if (files.length === count) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 10))
  }
  throw new Error(`timed out waiting for ${count} independent writers to be ready`)
}

async function runConcurrentWriters(
  root: string,
  chainDirectory: string,
  name: string,
): Promise<string[]> {
  const barrierDirectory = join(root, name)
  await mkdir(barrierDirectory)
  const writers = [
    runWriter(chainDirectory, barrierDirectory),
    runWriter(chainDirectory, barrierDirectory),
  ]
  await waitForReadyFiles(barrierDirectory, writers.length)
  await writeFile(join(barrierDirectory, 'start'), 'go\n')
  const results = await Promise.all(writers.map(async (writer) => ({
    code: await writer.exit,
    stdout: writer.stdout(),
    stderr: writer.stderr(),
  })))
  assert.deepEqual(results.map(({ code }) => code), [0, 0], JSON.stringify(results))
  return results.map(({ stdout }) => stdout.trim()).sort()
}

test('independent processes refresh and append without losing a canonical block', async () => {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-chain-lock-process-'))
  try {
    const chainDirectory = join(root, 'chain')
    assert.deepEqual(
      await runConcurrentWriters(root, chainDirectory, 'initialization-barrier'),
      ['1', '2'],
    )

    // Keep one processor open at height 2 while new independent writers commit
    // heights 3 and 4, then prove its async view refreshes chain.json.
    const longLivedProcessor = await PersistentBlockProcessor.open(chainDirectory)
    assert.deepEqual(
      await runConcurrentWriters(root, chainDirectory, 'stale-tip-barrier'),
      ['3', '4'],
    )
    const view = await longLivedProcessor.createCanonicalReadView()
    assert.equal(view.report.tip.number, 4n)
    assert.equal(longLivedProcessor.tip.number, 4n)
    for (let height = 1n; height <= 4n; height += 1n) {
      assert.equal(view.getCanonicalBlockByNumber(height)?.summary.number, height.toString(10))
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('stale and malformed locks fail closed without changing canonical metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-chain-lock-failure-'))
  const chainDirectory = join(root, 'chain')
  try {
    const processor = await PersistentBlockProcessor.open(chainDirectory, {
      chainDirectoryLockTimeoutMs: 1_500,
    })
    const metadataPath = join(chainDirectory, 'chain.json')
    const originalMetadata = await readFile(metadataPath, 'utf8')
    const lockPath = chainDirectoryLockPath(chainDirectory)
    assert.equal(lockPath, join(chainDirectory, CHAIN_DIRECTORY_LOCK_FILENAME))

    await writeFile(lockPath, `${JSON.stringify({
      format: 'btcs-l2-chain-directory-lock',
      version: 1,
      host: hostname(),
      pid: 2_147_483_647,
      token: '123e4567-e89b-42d3-a456-426614174000',
      startedAtMs: Date.now(),
    })}\n`)
    await assert.rejects(
      processor.buildNextBlock([], GENESIS_TIMESTAMP + 1n),
      ChainDirectoryLockError,
    )
    assert.equal(await readFile(metadataPath, 'utf8'), originalMetadata)
    await rm(lockPath)

    await writeFile(lockPath, '{ malformed owner')
    await assert.rejects(
      processor.buildNextBlock([], GENESIS_TIMESTAMP + 1n),
      ChainDirectoryLockError,
    )
    assert.equal(await readFile(metadataPath, 'utf8'), originalMetadata)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
