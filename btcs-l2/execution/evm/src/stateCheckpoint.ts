import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ClassicLevel } from 'classic-level'
import { MerklePatriciaTrie } from '@ethereumjs/mpt'
import { MerkleStateManager } from '@ethereumjs/statemanager'
import {
  bytesToHex,
  hexToBytes,
  ValueEncoding,
} from '@ethereumjs/util'
import type { BatchDBOp, DB, EncodingOpts } from '@ethereumjs/util'
import { createHarnessCommon } from './config.js'

const MANIFEST_FILE = 'checkpoint.json'
const DATABASE_DIRECTORY = 'state-db'

export type TrustedAnchorReference = {
  type: string
  reference: string
}

export type StateCheckpointManifest = {
  formatVersion: 1
  profileId: string
  blockHeight: string
  blockHash: string
  stateRoot: string
  trustedAnchor?: TrustedAnchorReference
}

export type StateCheckpointInput = Omit<StateCheckpointManifest, 'formatVersion'>

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

function validateManifest(value: unknown): StateCheckpointManifest {
  if (value === null || typeof value !== 'object') {
    throw new Error('Invalid checkpoint manifest: expected an object')
  }

  const manifest = value as Partial<StateCheckpointManifest>
  if (
    manifest.formatVersion !== 1 ||
    typeof manifest.profileId !== 'string' ||
    manifest.profileId.length === 0 ||
    typeof manifest.blockHeight !== 'string' ||
    !/^(0|[1-9][0-9]*)$/.test(manifest.blockHeight) ||
    typeof manifest.blockHash !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(manifest.blockHash) ||
    typeof manifest.stateRoot !== 'string' ||
    !/^0x[0-9a-fA-F]{64}$/.test(manifest.stateRoot)
  ) {
    throw new Error('Invalid checkpoint manifest: unsupported or malformed fields')
  }

  if (
    manifest.trustedAnchor !== undefined &&
    (
      manifest.trustedAnchor === null ||
      typeof manifest.trustedAnchor !== 'object' ||
      typeof manifest.trustedAnchor.type !== 'string' ||
      typeof manifest.trustedAnchor.reference !== 'string'
    )
  ) {
    throw new Error('Invalid checkpoint manifest: malformed trusted anchor reference')
  }

  return manifest as StateCheckpointManifest
}

async function makeStateManager(
  db: ClassicLevel<string, Uint8Array>,
  root?: Uint8Array,
): Promise<MerkleStateManager> {
  const common = createHarnessCommon()
  const trie = new MerklePatriciaTrie({
    db: new ClassicLevelAdapter(db),
    common,
    ...(root === undefined ? {} : { root }),
    useKeyHashing: true,
    valueEncoding: ValueEncoding.Bytes,
  })

  if (root !== undefined && !(await trie.checkRoot(root))) {
    throw new Error('Checkpoint trie database is missing the manifest state root')
  }

  return new MerkleStateManager({
    common,
    trie,
  })
}

/**
 * Open a fresh durable state database for a dedicated canonical replay.
 * The caller must close it before passing its path to createStateCheckpoint.
 */
export async function openDurableStateManager(databasePath: string): Promise<{
  stateManager: MerkleStateManager
  close: () => Promise<void>
}> {
  const db = new ClassicLevel<string, Uint8Array>(databasePath, {
    valueEncoding: "view",
  })

  try {
    await db.open()
    return {
      stateManager: await makeStateManager(db),
      close: async () => {
        if (db.status === "open") await db.close()
      },
    }
  } catch (error) {
    if (db.status === "open") await db.close()
    throw error
  }
}

/**
 * Copy a CLOSED durable state database into a new checkpoint directory.
 * The caller must supply the block identity and state root obtained from
 * its own canonical execution context.
 *
 * A trustedAnchor is recorded as a reference only; it is not verified here.
 */
export async function createStateCheckpoint(
  sourceDatabasePath: string,
  checkpointDirectory: string,
  input: StateCheckpointInput,
): Promise<StateCheckpointManifest> {
  const manifest = validateManifest({ formatVersion: 1, ...input })

  // A new directory prevents accidentally merging with an older checkpoint.
  await mkdir(checkpointDirectory)
  const targetPath = join(checkpointDirectory, DATABASE_DIRECTORY)
  const source = new ClassicLevel<string, Uint8Array>(sourceDatabasePath, {
    valueEncoding: 'view',
  })
  const target = new ClassicLevel<string, Uint8Array>(targetPath, {
    valueEncoding: 'view',
  })

  try {
    await source.open()
    await target.open()

    for await (const [key, value] of source.iterator({
      keyEncoding: 'utf8',
      valueEncoding: 'view',
    })) {
      await target.put(key, value, {
        keyEncoding: 'utf8',
        valueEncoding: 'view',
      })
    }
  } finally {
    if (source.status === 'open') await source.close()
    if (target.status === 'open') await target.close()
  }

  await writeFile(
    join(checkpointDirectory, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: 'wx' },
  )

  // Reopen the completed artifact and verify its persisted root.
  const restored = await openStateCheckpoint(checkpointDirectory)
  try {
    const restoredRoot = bytesToHex(await restored.stateManager.getStateRoot())
    if (restoredRoot.toLowerCase() !== manifest.stateRoot.toLowerCase()) {
      throw new Error(
        `Checkpoint state-root mismatch: expected ${manifest.stateRoot}, got ${restoredRoot}`,
      )
    }
  } finally {
    await restored.close()
  }

  return manifest
}

export async function openStateCheckpoint(checkpointDirectory: string): Promise<{
  manifest: StateCheckpointManifest
  stateManager: MerkleStateManager
  close: () => Promise<void>
}> {
  const manifestPath = join(checkpointDirectory, MANIFEST_FILE)
  const parsed: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
  const manifest = validateManifest(parsed)

  const db = new ClassicLevel<string, Uint8Array>(
    join(checkpointDirectory, DATABASE_DIRECTORY),
    { valueEncoding: 'view' },
  )

  try {
    await db.open()
    const stateManager = await makeStateManager(db, hexToBytes(manifest.stateRoot as `0x${string}`))
    const actualRoot = bytesToHex(await stateManager.getStateRoot())

    if (actualRoot.toLowerCase() !== manifest.stateRoot.toLowerCase()) {
      throw new Error(
        `Checkpoint state-root mismatch: expected ${manifest.stateRoot}, got ${actualRoot}`,
      )
    }

    return {
      manifest,
      stateManager,
      close: () => db.close(),
    }
  } catch (error) {
    if (db.status === 'open') await db.close()
    throw error
  }
}
