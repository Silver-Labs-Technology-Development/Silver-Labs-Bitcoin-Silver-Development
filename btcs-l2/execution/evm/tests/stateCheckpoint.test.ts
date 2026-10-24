import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ClassicLevel } from 'classic-level'
import { MerklePatriciaTrie } from '@ethereumjs/mpt'
import { MerkleStateManager } from '@ethereumjs/statemanager'
import {
  Address,
  bytesToHex,
  createAccount,
  hexToBytes,
  ValueEncoding,
} from '@ethereumjs/util'
import type { BatchDBOp, DB, EncodingOpts } from '@ethereumjs/util'
import { createHarnessCommon } from '../src/config.js'
import { createStateCheckpoint, openStateCheckpoint } from '../src/stateCheckpoint.js'

class ClassicLevelAdapter implements DB<string, Uint8Array> {
  constructor(private readonly level: ClassicLevel<string, Uint8Array>) {}

  async get(key: string, _opts?: EncodingOpts): Promise<Uint8Array | undefined> {
    try {
      return await this.level.get(key, {
        keyEncoding: 'utf8',
        valueEncoding: 'view',
      })
    } catch (error) {
      if ((error as { code?: string }).code === 'LEVEL_NOT_FOUND') return undefined
      throw error
    }
  }

  async put(key: string, value: Uint8Array, _opts?: EncodingOpts): Promise<void> {
    await this.level.put(key, value, {
      keyEncoding: 'utf8',
      valueEncoding: 'view',
    })
  }

  async del(key: string, _opts?: EncodingOpts): Promise<void> {
    await this.level.del(key, { keyEncoding: 'utf8' })
  }

  async batch(ops: BatchDBOp<string, Uint8Array>[]): Promise<void> {
    await this.level.batch(
      ops.map((op) =>
        op.type === 'put'
          ? {
              type: 'put' as const,
              key: op.key,
              value: op.value,
              keyEncoding: 'utf8',
              valueEncoding: 'view',
            }
          : { type: 'del' as const, key: op.key, keyEncoding: 'utf8' },
      ) as never,
    )
  }

  shallowCopy(): DB<string, Uint8Array> {
    return new ClassicLevelAdapter(this.level)
  }

  async open(): Promise<void> {
    if (this.level.status !== 'open') await this.level.open()
  }
}

test('checkpoint restores durable EVM state and validates its manifest', async () => {
  const rootDir = await mkdtemp(join(tmpdir(), 'btcs-l2-checkpoint-'))
  const sourcePath = join(rootDir, 'source-db')
  const checkpointPath = join(rootDir, 'checkpoint')
  const accountAddress = new Address(hexToBytes(`0x${'10'.repeat(20)}`))
  const contractAddress = new Address(hexToBytes(`0x${'20'.repeat(20)}`))
  const storageKey = hexToBytes(`0x${'00'.repeat(31)}01`)
  const storageValue = hexToBytes(`0x${'00'.repeat(31)}2a`)
  const contractCode = hexToBytes('0x6001600055')

  try {
    let stateRoot: string

    const source = new ClassicLevel<string, Uint8Array>(sourcePath, {
      valueEncoding: 'view',
    })
    await source.open()

    try {
      const trie = new MerklePatriciaTrie({
        db: new ClassicLevelAdapter(source),
        useKeyHashing: true,
        valueEncoding: ValueEncoding.Bytes,
      })
      const state = new MerkleStateManager({
        common: createHarnessCommon(),
        trie,
      })

      await state.putAccount(
        accountAddress,
        createAccount({ balance: 123456789n, nonce: 3n }),
      )
      await state.putAccount(contractAddress, createAccount({ balance: 0n, nonce: 0n }))
      await state.putCode(contractAddress, contractCode)
      await state.putStorage(contractAddress, storageKey, storageValue)
      stateRoot = bytesToHex(await state.getStateRoot())
    } finally {
      await source.close()
    }

    const manifest = await createStateCheckpoint(sourcePath, checkpointPath, {
      profileId: 'btcs-l2-local-v0.11-osaka',
      blockHeight: '7',
      blockHash: `0x${'ab'.repeat(32)}`,
      stateRoot: stateRoot!,
      trustedAnchor: {
        type: 'test-reference-only',
        reference: 'not-a-settlement-proof',
      },
    })

    assert.equal(manifest.blockHeight, '7')
    assert.equal(manifest.stateRoot, stateRoot)

    const restored = await openStateCheckpoint(checkpointPath)
    try {
      assert.equal(restored.manifest.profileId, 'btcs-l2-local-v0.11-osaka')
      assert.equal(
        bytesToHex(await restored.stateManager.getStateRoot()),
        stateRoot!,
      )

      const account = await restored.stateManager.getAccount(accountAddress)
      assert.ok(account)
      assert.equal(account.balance, 123456789n)
      assert.equal(account.nonce, 3n)

      assert.deepEqual(
        new Uint8Array(await restored.stateManager.getCode(contractAddress)),
        contractCode,
      )
      assert.deepEqual(
        new Uint8Array(await restored.stateManager.getStorage(contractAddress, storageKey)),
        new Uint8Array([0x2a]),
      )
    } finally {
      await restored.close()
    }

    const manifestPath = join(checkpointPath, 'checkpoint.json')
    const validManifest = await readFile(manifestPath, 'utf8')
    const parsedManifest = JSON.parse(validManifest)

    // Unsupported manifest versions must never be accepted.
    await writeFile(
      manifestPath,
      JSON.stringify({ ...parsedManifest, formatVersion: 999 }),
    )
    await assert.rejects(
      openStateCheckpoint(checkpointPath),
      /Invalid checkpoint manifest/,
    )

    // Restore the version, then verify malformed roots are rejected too.
    await writeFile(manifestPath, validManifest)
    await writeFile(
      manifestPath,
      JSON.stringify({ ...parsedManifest, stateRoot: 'not-a-root' }),
    )
    await assert.rejects(
      openStateCheckpoint(checkpointPath),
      /Invalid checkpoint manifest/,
    )

    // A valid manifest must not make a checkpoint with missing trie data acceptable.
    await writeFile(manifestPath, validManifest)
    const damagedStateDb = new ClassicLevel<string, Uint8Array>(
      join(checkpointPath, 'state-db'),
      { valueEncoding: 'view' },
    )
    await damagedStateDb.open()
    try {
      await damagedStateDb.clear()
    } finally {
      await damagedStateDb.close()
    }

    await assert.rejects(
      openStateCheckpoint(checkpointPath),
      /missing the manifest state root/,
    )
  } finally {
    await rm(rootDir, { recursive: true, force: true })
  }
})
