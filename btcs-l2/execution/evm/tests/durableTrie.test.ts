import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ClassicLevel } from 'classic-level'
import { MerklePatriciaTrie } from '@ethereumjs/mpt'
import { ValueEncoding } from '@ethereumjs/util'
import type { BatchDBOp, DB, EncodingOpts } from '@ethereumjs/util'

class ClassicLevelAdapter implements DB<string, Uint8Array> {
  constructor(private readonly level: ClassicLevel<string, Uint8Array>) {}

  async get(key: string, opts?: EncodingOpts): Promise<Uint8Array | undefined> {
    try {
      return await this.level.get(key, { keyEncoding: 'utf8', valueEncoding: 'view' })
    } catch (error) {
      if ((error as { code?: string }).code === 'LEVEL_NOT_FOUND') return undefined
      throw error
    }
  }

  async put(key: string, value: Uint8Array, opts?: EncodingOpts): Promise<void> {
    await this.level.put(key, value, { keyEncoding: 'utf8', valueEncoding: 'view' })
  }

  async del(key: string, opts?: EncodingOpts): Promise<void> {
    await this.level.del(key, { keyEncoding: 'utf8' })
  }

  async batch(ops: BatchDBOp<string, Uint8Array>[]): Promise<void> {
    await this.level.batch(
      ops.map((op) =>
        op.type === 'put'
          ? { type: 'put' as const, key: op.key, value: op.value, keyEncoding: 'utf8', valueEncoding: 'view' }
          : { type: 'del' as const, key: op.key, keyEncoding: 'utf8' },
      ) as never,
    )
  }

  shallowCopy(): DB<string, Uint8Array> {
    return new ClassicLevelAdapter(this.level)
  }

  async open(): Promise<void> {
    await this.level.open()
  }
}

test('secure trie data and root survive closing and reopening LevelDB', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-durable-trie-'))
  const key = new TextEncoder().encode('btcs-l2-checkpoint-test-key')
  const value = new TextEncoder().encode('durable-trie-value-v1')
  let savedRoot: Uint8Array

  try {
    const db1 = new ClassicLevel<string, Uint8Array>(directory, {
      valueEncoding: 'view',
    })

    try {
      await db1.open()
      const trie1 = new MerklePatriciaTrie({
        db: new ClassicLevelAdapter(db1),
        useKeyHashing: true,
        valueEncoding: ValueEncoding.Bytes,
      })

      await trie1.put(key, value)
      savedRoot = trie1.root().slice()

      assert.equal(
        new TextDecoder().decode((await trie1.get(key))!),
        'durable-trie-value-v1',
      )
    } finally {
      await db1.close()
    }

    const db2 = new ClassicLevel<string, Uint8Array>(directory, {
      valueEncoding: 'view',
    })

    try {
      await db2.open()
      const trie2 = new MerklePatriciaTrie({
        db: new ClassicLevelAdapter(db2),
        root: savedRoot!,
        useKeyHashing: true,
        valueEncoding: ValueEncoding.Bytes,
      })

      assert.deepEqual(trie2.root(), savedRoot!)
      assert.equal(await trie2.checkRoot(savedRoot!), true)
      assert.equal(
        new TextDecoder().decode((await trie2.get(key))!),
        'durable-trie-value-v1',
      )
    } finally {
      await db2.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
