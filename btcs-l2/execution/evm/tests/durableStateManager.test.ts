import { strict as assert } from 'node:assert'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ClassicLevel } from 'classic-level'
import { MerklePatriciaTrie } from '@ethereumjs/mpt'
import { MerkleStateManager } from '@ethereumjs/statemanager'
import {
  Address,
  createAccount,
  hexToBytes,
  ValueEncoding,
} from '@ethereumjs/util'
import type { BatchDBOp, DB, EncodingOpts } from '@ethereumjs/util'
import { createHarnessCommon } from '../src/config.js'

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
    await this.level.open()
  }
}

function makeStateManager(db: ClassicLevel<string, Uint8Array>, root?: Uint8Array) {
  const trie = new MerklePatriciaTrie({
    db: new ClassicLevelAdapter(db),
    useKeyHashing: true,
    valueEncoding: ValueEncoding.Bytes,
  })
  const stateManager = new MerkleStateManager({
    common: createHarnessCommon(),
    trie,
  })
  return { stateManager, root }
}

test('EVM account, code, storage and state root survive database restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-state-manager-'))
  const accountAddress = new Address(hexToBytes('0x1000000000000000000000000000000000000001'))
  const contractAddress = new Address(hexToBytes('0x2000000000000000000000000000000000000002'))
  const storageKey = hexToBytes(('0x' + '00'.repeat(31) + '01') as `0x${string}`)
  const storageValue = hexToBytes(('0x' + '00'.repeat(31) + '2a') as `0x${string}`)
  const contractCode = hexToBytes('0x6001600055')
  let savedRoot: Uint8Array

  try {
    const db1 = new ClassicLevel<string, Uint8Array>(directory, {
      valueEncoding: 'view',
    })

    try {
      await db1.open()
      const { stateManager } = makeStateManager(db1)

      await stateManager.putAccount(
        accountAddress,
        createAccount({ balance: 123456789n, nonce: 3n }),
      )
      await stateManager.putAccount(contractAddress, createAccount({ balance: 0n, nonce: 0n }))
      await stateManager.putCode(contractAddress, contractCode)
      await stateManager.putStorage(contractAddress, storageKey, storageValue)

      savedRoot = await stateManager.getStateRoot()
      assert.ok(savedRoot.length > 0)
    } finally {
      await db1.close()
    }

    const db2 = new ClassicLevel<string, Uint8Array>(directory, {
      valueEncoding: 'view',
    })

    try {
      await db2.open()
      const { stateManager } = makeStateManager(db2)
      await stateManager.setStateRoot(savedRoot!)

      const restoredAccount = await stateManager.getAccount(accountAddress)
      assert.ok(restoredAccount)
      assert.equal(restoredAccount.balance, 123456789n)
      assert.equal(restoredAccount.nonce, 3n)

      assert.deepEqual(new Uint8Array(await stateManager.getCode(contractAddress)), contractCode)
      assert.deepEqual(
        new Uint8Array(await stateManager.getStorage(contractAddress, storageKey)),
        new Uint8Array([0x2a]),
      )
      assert.deepEqual(await stateManager.getStateRoot(), savedRoot!)
    } finally {
      await db2.close()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
