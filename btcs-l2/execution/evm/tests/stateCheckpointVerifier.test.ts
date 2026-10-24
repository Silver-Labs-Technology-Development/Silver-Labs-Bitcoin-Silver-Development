import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import type { StateCheckpointManifest } from '../src/stateCheckpoint.js'
import { verifyStateCheckpointAgainstCanonical } from '../src/stateCheckpointVerifier.js'

const PROFILE = 'btcs-l2-local-v0.11-osaka'

async function withStore<T>(
  run: (directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-checkpoint-verify-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('checkpoint verifier accepts metadata matching replayed canonical genesis', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const view = await processor.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const manifest: StateCheckpointManifest = {
      formatVersion: 1,
      profileId: PROFILE,
      blockHeight: genesis.summary.number,
      blockHash: genesis.summary.hash,
      stateRoot: genesis.summary.stateRoot,
    }

    assert.deepEqual(
      verifyStateCheckpointAgainstCanonical(manifest, view, PROFILE),
      {
        verified: true,
        profileId: PROFILE,
        blockHeight: genesis.summary.number,
        blockHash: genesis.summary.hash,
        stateRoot: genesis.summary.stateRoot,
      },
    )
  })
})

test('checkpoint verifier rejects a profile mismatch', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const view = await processor.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const manifest: StateCheckpointManifest = {
      formatVersion: 1,
      profileId: PROFILE,
      blockHeight: genesis.summary.number,
      blockHash: genesis.summary.hash,
      stateRoot: genesis.summary.stateRoot,
    }

    assert.throws(
      () => verifyStateCheckpointAgainstCanonical(manifest, view, 'wrong-profile'),
      /profile mismatch/,
    )
  })
})

test('checkpoint verifier rejects a wrong height', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const view = await processor.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const manifest: StateCheckpointManifest = {
      formatVersion: 1,
      profileId: PROFILE,
      blockHeight: '1',
      blockHash: genesis.summary.hash,
      stateRoot: genesis.summary.stateRoot,
    }

    assert.throws(
      () => verifyStateCheckpointAgainstCanonical(manifest, view, PROFILE),
      /height mismatch/,
    )
  })
})

test('checkpoint verifier rejects a hash absent from canonical history', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const view = await processor.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const manifest: StateCheckpointManifest = {
      formatVersion: 1,
      profileId: PROFILE,
      blockHeight: '0',
      blockHash: `0x${'ab'.repeat(32)}`,
      stateRoot: genesis.summary.stateRoot,
    }

    assert.throws(
      () => verifyStateCheckpointAgainstCanonical(manifest, view, PROFILE),
      /not in canonical history/,
    )
  })
})

test('checkpoint verifier rejects a wrong state root', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const view = await processor.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const manifest: StateCheckpointManifest = {
      formatVersion: 1,
      profileId: PROFILE,
      blockHeight: genesis.summary.number,
      blockHash: genesis.summary.hash,
      stateRoot: `0x${'ab'.repeat(32)}`,
    }

    assert.throws(
      () => verifyStateCheckpointAgainstCanonical(manifest, view, PROFILE),
      /state-root mismatch/,
    )
  })
})
