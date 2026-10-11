import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createStateCheckpoint } from '../src/stateCheckpoint.js'
import { recoverStateCheckpoint } from '../src/stateCheckpointRecovery.js'

const PROFILE = 'btcs-l2-local-v0.11-osaka'

async function withDirectory<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-recovery-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('recovery rejects a checkpoint whose state root differs from canonical history', async () => {
  await withDirectory(async (directory) => {
    const processor = await PersistentBlockProcessor.open(join(directory, 'chain'))
    const view = await processor.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const sourcePath = join(directory, 'source-db')
    const checkpointPath = join(directory, 'checkpoint')
    const { ClassicLevel } = await import('classic-level')
    const { MerklePatriciaTrie } = await import('@ethereumjs/mpt')
    const { MerkleStateManager } = await import('@ethereumjs/statemanager')
    const { ValueEncoding } = await import('@ethereumjs/util')
    const { createHarnessCommon } = await import('../src/config.js')

    const source = new ClassicLevel<string, Uint8Array>(sourcePath, {
      valueEncoding: 'view',
    })
    await source.open()
    let emptyRoot: string
    try {
      const state = new MerkleStateManager({
        common: createHarnessCommon(),
        trie: new MerklePatriciaTrie({
          db: {
            get: async (key: string) => {
              try {
                return await source.get(key, { keyEncoding: 'utf8', valueEncoding: 'view' })
              } catch (error) {
                if ((error as { code?: string }).code === 'LEVEL_NOT_FOUND') return undefined
                throw error
              }
            },
            put: async (key: string, value: Uint8Array) => source.put(key, value, { keyEncoding: 'utf8', valueEncoding: 'view' }),
            del: async (key: string) => source.del(key, { keyEncoding: 'utf8' }),
            batch: async () => { throw new Error('unexpected batch') },
            shallowCopy: () => { throw new Error('unexpected shallowCopy') },
            open: async () => {},
          },
          useKeyHashing: true,
          valueEncoding: ValueEncoding.Bytes,
        }),
      })
      emptyRoot = `0x${Buffer.from(await state.getStateRoot()).toString('hex')}`
    } finally {
      await source.close()
    }

    await createStateCheckpoint(sourcePath, checkpointPath, {
      profileId: PROFILE,
      blockHeight: genesis.summary.number,
      blockHash: genesis.summary.hash,
      stateRoot: emptyRoot!,
    })

    await assert.rejects(
      recoverStateCheckpoint(checkpointPath, view, PROFILE),
      /state-root mismatch/,
    )
  })
})
