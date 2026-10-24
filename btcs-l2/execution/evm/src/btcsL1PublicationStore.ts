import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { ProtocolError } from './blockProcessor.js'
import {
  createBtcsL1Publication as createRecord,
  invalidateBtcsL1Publication,
  markBtcsL1PublicationSubmitted,
  observeBtcsL1Publication,
  reobserveBtcsL1Publication,
  validateBtcsL1PublicationRecord,
  type BtcsL1PublicationRecord,
} from './btcsL1Publication.js'
import {
  type SettlementContinuityCheckpoint,
  type SettlementContinuityCursor,
  SettlementContinuityStore,
} from './settlementContinuity.js'

export const BTCS_L1_PUBLICATION_STORE_FORMAT =
  'btcs-l2-btcs-l1-publication-store'
export const BTCS_L1_PUBLICATION_STORE_VERSION = 1
export const BTCS_L1_PUBLICATION_STORE_FILE = 'publications.json'
export const BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE =
  'continuity-binding.json'

const BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FORMAT =
  'btcs-l2-publication-continuity-binding'
const BTCS_L1_PUBLICATION_CONTINUITY_BINDING_VERSION = 1
const MAX_STORE_BYTES = 8 * 1024 * 1024
const MAX_BINDING_BYTES = 4 * 1024
const MAX_RECORDS = 10_000
const HASH_RE = /^[0-9a-f]{64}$/

type StoreSnapshot = Readonly<{
  format: typeof BTCS_L1_PUBLICATION_STORE_FORMAT
  version: typeof BTCS_L1_PUBLICATION_STORE_VERSION
  records: readonly BtcsL1PublicationRecord[]
}>

type ContinuityBinding = Readonly<{
  format: typeof BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FORMAT
  version: typeof BTCS_L1_PUBLICATION_CONTINUITY_BINDING_VERSION
  continuityDirectory: string
}>

function encodeContinuityBinding(continuityDirectory: string): Uint8Array {
  const binding: ContinuityBinding = {
    format: BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FORMAT,
    version: BTCS_L1_PUBLICATION_CONTINUITY_BINDING_VERSION,
    continuityDirectory,
  }
  return Buffer.from(`${JSON.stringify(binding, null, 2)}\n`, 'utf8')
}

async function readContinuityBindingIfExists(
  directory: string,
): Promise<string | null> {
  const path = join(directory, BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE)
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }

  if (!info.isFile() || info.size > MAX_BINDING_BYTES) {
    throw new ProtocolError(
      'publication continuity binding is not a regular file or exceeds the size limit',
    )
  }

  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_BINDING_BYTES) {
    throw new ProtocolError(
      'publication continuity binding exceeds the size limit',
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ProtocolError(
      'publication continuity binding contains invalid JSON',
    )
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ProtocolError('publication continuity binding must be an object')
  }
  const binding = parsed as Record<string, unknown>
  const keys = ['format', 'version', 'continuityDirectory']
  if (
    Object.keys(binding).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(binding, key)) ||
    binding.format !== BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FORMAT ||
    binding.version !== BTCS_L1_PUBLICATION_CONTINUITY_BINDING_VERSION ||
    typeof binding.continuityDirectory !== 'string' ||
    !isAbsolute(binding.continuityDirectory)
  ) {
    throw new ProtocolError(
      'publication continuity binding has missing or unsupported fields',
    )
  }
  return resolve(binding.continuityDirectory)
}

function assertContinuityBinding(
  boundDirectory: string,
  continuity: SettlementContinuityStore,
): void {
  if (boundDirectory !== resolve(continuity.getDirectory())) {
    throw new ProtocolError(
      'publication store is bound to a different settlement continuity store',
    )
  }
}


export type BtcsL1PublicationStorePersistenceStage =
  | 'temp-opened'
  | 'file-synced'
  | 'before-rename'
  | 'renamed'
  | 'directory-synced'

export type BtcsL1PublicationStoreOptions = Readonly<{
  /** Fault injection for persistence tests; omit in normal use. */
  persistenceTestHook?: (
    stage: BtcsL1PublicationStorePersistenceStage,
  ) => void | Promise<void>
}>

class AtomicWriteFailure extends Error {
  constructor(
    cause: unknown,
    readonly destinationReplaced: boolean,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`publication store write failed: ${detail}`)
    this.name = 'AtomicWriteFailure'
  }
}

function cloneRecord(
  record: BtcsL1PublicationRecord,
): BtcsL1PublicationRecord {
  return JSON.parse(JSON.stringify(record)) as BtcsL1PublicationRecord
}

function validateBatchHash(batchHash: string): void {
  if (typeof batchHash !== 'string' || !HASH_RE.test(batchHash)) {
    throw new ProtocolError('batch hash must be 64 lowercase hex characters')
  }
}

function assertBatchValueMatches(
  value: unknown,
  batchHash: string,
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(
      'continuity guard requires the settlement batch value',
    )
  }
  const candidate = (value as Record<string, unknown>).batchHash
  validateBatchHash(candidate as string)
  if (candidate !== batchHash) {
    throw new ProtocolError(
      'settlement batch value does not match the publication batch hash',
    )
  }
}

function validateSnapshot(value: unknown): Map<string, BtcsL1PublicationRecord> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('publication store must be a JSON object')
  }

  const snapshot = value as Record<string, unknown>
  const expectedKeys = ['format', 'version', 'records']

  if (
    Object.keys(snapshot).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(snapshot, key))
  ) {
    throw new ProtocolError('publication store has missing or unsupported fields')
  }

  if (
    snapshot.format !== BTCS_L1_PUBLICATION_STORE_FORMAT ||
    snapshot.version !== BTCS_L1_PUBLICATION_STORE_VERSION
  ) {
    throw new ProtocolError('unsupported publication store format or version')
  }

  if (!Array.isArray(snapshot.records) || snapshot.records.length > MAX_RECORDS) {
    throw new ProtocolError('publication store records are invalid or exceed the record limit')
  }

  const records = new Map<string, BtcsL1PublicationRecord>()
  for (const value of snapshot.records) {
    const record = validateBtcsL1PublicationRecord(value)
    if (records.has(record.batchHash)) {
      throw new ProtocolError('publication store contains duplicate batch hashes')
    }
    records.set(record.batchHash, cloneRecord(record))
  }

  return records
}

function encodeSnapshot(
  records: ReadonlyMap<string, BtcsL1PublicationRecord>,
): Uint8Array {
  const snapshot: StoreSnapshot = {
    format: BTCS_L1_PUBLICATION_STORE_FORMAT,
    version: BTCS_L1_PUBLICATION_STORE_VERSION,
    records: [...records.values()]
      .sort((a, b) => (a.batchHash < b.batchHash ? -1 : a.batchHash > b.batchHash ? 1 : 0))
      .map(cloneRecord),
  }

  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  if (bytes.byteLength > MAX_STORE_BYTES) {
    throw new ProtocolError('publication store exceeds the file-size limit')
  }
  if (snapshot.records.length > MAX_RECORDS) {
    throw new ProtocolError('publication store exceeds the record limit')
  }
  return bytes
}

async function atomicWrite(
  directory: string,
  path: string,
  contents: Uint8Array,
  persistenceTestHook?: BtcsL1PublicationStoreOptions['persistenceTestHook'],
): Promise<void> {
  const temporaryPath = join(directory, `.publications.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let renamed = false

  const inject = async (
    stage: BtcsL1PublicationStorePersistenceStage,
  ): Promise<void> => {
    await persistenceTestHook?.(stage)
  }

  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await inject('temp-opened')
    await handle.writeFile(contents)
    await handle.sync()
    await inject('file-synced')
    await handle.close()
    handle = undefined

    await inject('before-rename')
    await rename(temporaryPath, path)
    renamed = true
    await inject('renamed')

    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
    await inject('directory-synced')
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    if (!renamed) await unlink(temporaryPath).catch(() => undefined)
    throw new AtomicWriteFailure(error, renamed)
  }
}

async function assertDirectory(directory: string): Promise<string> {
  const resolved = resolve(directory)
  const info = await lstat(resolved)
  if (!info.isDirectory()) {
    throw new ProtocolError('publication store path must be a real directory')
  }
  return resolved
}

async function readSnapshot(
  directory: string,
): Promise<Map<string, BtcsL1PublicationRecord>> {
  const path = join(directory, BTCS_L1_PUBLICATION_STORE_FILE)
  let info

  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProtocolError('publication store file is missing; refusing to initialize or repair it')
    }
    throw error
  }

  if (!info.isFile() || info.size > MAX_STORE_BYTES) {
    throw new ProtocolError('publication store is not a regular file or exceeds the size limit')
  }

  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_STORE_BYTES) {
    throw new ProtocolError('publication store exceeds the file-size limit')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ProtocolError('publication store contains invalid JSON')
  }

  return validateSnapshot(parsed)
}

/**
 * Explicitly bind an existing, already-created publication store to a
 * continuity store when upgrading a legacy directory that predates the binding
 * sidecar. This never rewrites publication records and refuses to rebind a
 * store that already has a different binding.
 */
export async function bindExistingBtcsL1PublicationStore(
  directory: string,
  continuity: SettlementContinuityStore,
): Promise<void> {
  const resolved = await assertDirectory(directory)
  await readSnapshot(resolved)
  const existing = await readContinuityBindingIfExists(resolved)
  if (existing !== null) {
    assertContinuityBinding(existing, continuity)
    return
  }

  await atomicWrite(
    resolved,
    join(resolved, BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE),
    encodeContinuityBinding(resolve(continuity.getDirectory())),
  )
}

/**
 * Durable local publication lifecycle storage.
 *
 * Use one store instance as the single writer for a directory. Mutations on
 * that instance are serialized. This version does not coordinate multiple
 * processes or multiple independently opened writer instances.
 *
 * Each store is durably bound to one settlement-continuity directory. A store
 * cannot be opened with a different continuity instance, and a legacy store
 * without a binding must be bound explicitly with
 * `bindExistingBtcsL1PublicationStore`.
 *
 * Missing, corrupt, unsupported, or oversized stores fail closed on open.
 */
export class BtcsL1PublicationStore {
  private records: Map<string, BtcsL1PublicationRecord>
  private mutationQueue: Promise<void> = Promise.resolve()
  private persistenceUncertain = false

  private constructor(
    private readonly directory: string,
    private readonly continuity: SettlementContinuityStore,
    records: Map<string, BtcsL1PublicationRecord>,
    private readonly persistenceTestHook?: BtcsL1PublicationStoreOptions['persistenceTestHook'],
  ) {
    this.records = records
  }

  static async create(
    directory: string,
    continuity: SettlementContinuityStore,
    options: BtcsL1PublicationStoreOptions = {},
  ): Promise<BtcsL1PublicationStore> {
    await mkdir(resolve(directory), { recursive: true, mode: 0o700 })
    const resolved = await assertDirectory(directory)
    const path = join(resolved, BTCS_L1_PUBLICATION_STORE_FILE)

    try {
      await lstat(path)
      throw new ProtocolError('publication store already exists; refusing to overwrite it')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    const expectedBinding = resolve(continuity.getDirectory())
    const existingBinding = await readContinuityBindingIfExists(resolved)
    if (existingBinding === null) {
      await atomicWrite(
        resolved,
        join(resolved, BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE),
        encodeContinuityBinding(expectedBinding),
      )
    } else {
      assertContinuityBinding(existingBinding, continuity)
    }

    const records = new Map<string, BtcsL1PublicationRecord>()
    await atomicWrite(resolved, path, encodeSnapshot(records), options.persistenceTestHook)
    return new BtcsL1PublicationStore(
      resolved,
      continuity,
      records,
      options.persistenceTestHook,
    )
  }

  static async open(
    directory: string,
    continuity: SettlementContinuityStore,
    options: BtcsL1PublicationStoreOptions = {},
  ): Promise<BtcsL1PublicationStore> {
    const resolved = await assertDirectory(directory)
    const records = await readSnapshot(resolved)
    const boundDirectory = await readContinuityBindingIfExists(resolved)
    if (boundDirectory === null) {
      throw new ProtocolError(
        'publication continuity binding is missing; refusing to bind an existing store implicitly',
      )
    }
    assertContinuityBinding(boundDirectory, continuity)
    return new BtcsL1PublicationStore(
      resolved,
      continuity,
      records,
      options.persistenceTestHook,
    )
  }

  get(batchHash: string): BtcsL1PublicationRecord | undefined {
    this.assertUsable()
    validateBatchHash(batchHash)
    const record = this.records.get(batchHash)
    return record === undefined ? undefined : cloneRecord(record)
  }

  list(): readonly BtcsL1PublicationRecord[] {
    this.assertUsable()
    return [...this.records.values()]
      .sort((a, b) => (a.batchHash < b.batchHash ? -1 : a.batchHash > b.batchHash ? 1 : 0))
      .map(cloneRecord)
  }

  createPublication(
    batchHash: string,
    requiredConfirmations: number,
  ): Promise<BtcsL1PublicationRecord> {
    return this.enqueue(async () => {
      this.assertUsable()
      if (this.records.has(batchHash)) {
        throw new ProtocolError('publication already exists for this batch hash')
      }

      const record = createRecord(batchHash, requiredConfirmations)
      const next = new Map(this.records)
      next.set(record.batchHash, record)
      await this.persist(next)
      this.records = next
      return cloneRecord(record)
    })
  }

  markSubmitted(
    batchHash: string,
    txid: string,
  ): Promise<BtcsL1PublicationRecord> {
    return this.update(batchHash, (current) =>
      markBtcsL1PublicationSubmitted(current, txid),
    )
  }

  /**
   * Advance a publication to observed/confirmed only through the bound
   * settlement-continuity store.
   *
   * The batch value is required even below the confirmation threshold so the
   * caller cannot park a publication on a batch that is not the exact next
   * continuity transition. Confirmation commits the continuity cursor before
   * the confirmed publication record is persisted, so a rejected or failed
   * continuity transition can never leave a confirmed publication behind.
   */
  async observe(
    batchHash: string,
    blockHash: string,
    blockHeight: number,
    confirmations: number,
    batchValue: unknown,
    checkpoint?: SettlementContinuityCheckpoint,
  ): Promise<BtcsL1PublicationRecord> {
    assertBatchValueMatches(batchValue, batchHash)
    return this.updateWithContinuity(
      batchHash,
      batchValue,
      checkpoint,
      (current) =>
        observeBtcsL1Publication(current, blockHash, blockHeight, confirmations),
    )
  }

  /** Re-observe an invalidated publication through the same continuity guard. */
  async reobserve(
    batchHash: string,
    blockHash: string,
    blockHeight: number,
    confirmations: number,
    batchValue: unknown,
    checkpoint?: SettlementContinuityCheckpoint,
  ): Promise<BtcsL1PublicationRecord> {
    assertBatchValueMatches(batchValue, batchHash)
    return this.updateWithContinuity(
      batchHash,
      batchValue,
      checkpoint,
      (current) =>
        reobserveBtcsL1Publication(
          current,
          blockHash,
          blockHeight,
          confirmations,
        ),
    )
  }

  /** Read-only continuity cursor associated with this publication store. */
  getContinuityCursor(): SettlementContinuityCursor | null {
    return this.continuity.getCursor()
  }

  invalidate(
    batchHash: string,
    expectedBlockHash?: string,
  ): Promise<BtcsL1PublicationRecord> {
    if (expectedBlockHash !== undefined) {
      validateBatchHash(expectedBlockHash)
    }

    return this.update(batchHash, (current) => {
      if (
        expectedBlockHash !== undefined &&
        current.blockHash !== expectedBlockHash
      ) {
        throw new ProtocolError(
          'publication inclusion changed before invalidation',
        )
      }
      return invalidateBtcsL1Publication(current)
    })
  }

  private async update(
    batchHash: string,
    transition: (record: BtcsL1PublicationRecord) => BtcsL1PublicationRecord,
  ): Promise<BtcsL1PublicationRecord> {
    validateBatchHash(batchHash)
    return this.enqueue(async () => {
      this.assertUsable()
      const current = this.records.get(batchHash)
      if (current === undefined) {
        throw new ProtocolError('publication does not exist for this batch hash')
      }

      const nextRecord = transition(current)
      if (nextRecord.batchHash !== batchHash) {
        throw new ProtocolError('publication transition changed the batch hash')
      }

      const next = new Map(this.records)
      next.set(batchHash, nextRecord)
      await this.persist(next)
      this.records = next
      return cloneRecord(nextRecord)
    })
  }

  private async updateWithContinuity(
    batchHash: string,
    batchValue: unknown,
    checkpoint: SettlementContinuityCheckpoint | undefined,
    transition: (record: BtcsL1PublicationRecord) => BtcsL1PublicationRecord,
  ): Promise<BtcsL1PublicationRecord> {
    validateBatchHash(batchHash)
    assertBatchValueMatches(batchValue, batchHash)

    return this.enqueue(async () => {
      this.assertUsable()
      const current = this.records.get(batchHash)
      if (current === undefined) {
        throw new ProtocolError('publication does not exist for this batch hash')
      }

      const nextRecord = transition(current)
      if (nextRecord.batchHash !== batchHash) {
        throw new ProtocolError('publication transition changed the batch hash')
      }

      // Replay and validate the exact batch before touching either durable
      // store. This rejects gaps, overlaps, forks, stale anchors, and missing
      // checkpoints without changing the publication record.
      const prepared = await this.continuity.prepareBatch(
        batchValue,
        checkpoint,
      )

      if (nextRecord.state === 'confirmed') {
        if (prepared.nextCursor.batchHash !== batchHash) {
          throw new ProtocolError(
            'settlement continuity cursor does not match the confirmed publication',
          )
        }
        // Commit the settlement cursor first. If the publication write then
        // fails, no confirmed record exists and retrying the same batch is
        // idempotent. The opposite order could leave a confirmed publication
        // without the continuity guarantee.
        await this.continuity.commitPreparedBatch(prepared)
      }

      const next = new Map(this.records)
      next.set(batchHash, nextRecord)
      await this.persist(next)
      this.records = next
      return cloneRecord(nextRecord)
    })
  }

  private assertUsable(): void {
    if (this.persistenceUncertain) {
      throw new ProtocolError(
        'publication store persistence outcome is uncertain; reopen the store before continuing',
      )
    }
  }

  private async persist(
    records: ReadonlyMap<string, BtcsL1PublicationRecord>,
  ): Promise<void> {
    const bytes = encodeSnapshot(records)
    try {
      await atomicWrite(
        this.directory,
        join(this.directory, BTCS_L1_PUBLICATION_STORE_FILE),
        bytes,
        this.persistenceTestHook,
      )
    } catch (error) {
      if (error instanceof AtomicWriteFailure && error.destinationReplaced) {
        // The path now refers to the new snapshot, but its directory entry
        // may not be durable. Do not read or write again with stale memory.
        this.persistenceUncertain = true
      }
      throw error
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }
}
