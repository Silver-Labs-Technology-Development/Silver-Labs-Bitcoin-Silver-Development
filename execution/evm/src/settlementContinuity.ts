import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  ProtocolError,
  type CanonicalReadView,
} from './blockProcessor.js'
import { ZERO_COMMITMENT } from './settlementEnvelope.js'
import {
  verifyEvmSettlementBatch,
  type EvmSettlementBatch,
} from './settlementBatch.js'
import {
  verifyEvmSettlementBatchExecution,
  verifyEvmSettlementBatchExecutionFromCheckpoint,
  type EvmSettlementReplayReport,
} from './settlementBatchReplay.js'

export const BTCS_L2_SETTLEMENT_CONTINUITY_FORMAT =
  'btcs-l2-settlement-continuity'
export const BTCS_L2_SETTLEMENT_CONTINUITY_VERSION = 1
export const BTCS_L2_SETTLEMENT_CONTINUITY_FILE =
  'settlement-continuity.json'
export const ZERO_SETTLEMENT_PARENT_HASH = `0x${'0'.repeat(64)}`

const MAX_STORE_BYTES = 64 * 1024
const HASH_RE = /^[0-9a-f]{64}$/
const BLOCK_HASH_RE = /^0x[0-9a-f]{64}$/
const HEIGHT_RE = /^(0|[1-9][0-9]*)$/

export type SettlementContinuityCursor = Readonly<{
  batchHash: string
  startHeight: string
  endHeight: string
  previousCommitment: string
  terminalCommitment: string
  parentHash: string
  blockHash: string
}>

export type SettlementContinuityCheckpoint = Readonly<{
  checkpointDirectory: string
  canonicalView: CanonicalReadView
}>

/** Replay result that has not yet been persisted. */
export type PreparedSettlementBatch = Readonly<{
  previousCursor: SettlementContinuityCursor | null
  nextCursor: SettlementContinuityCursor
}>

type Snapshot = Readonly<{
  format: typeof BTCS_L2_SETTLEMENT_CONTINUITY_FORMAT
  version: typeof BTCS_L2_SETTLEMENT_CONTINUITY_VERSION
  cursor: SettlementContinuityCursor | null
}>

const CURSOR_KEYS = [
  'batchHash',
  'startHeight',
  'endHeight',
  'previousCommitment',
  'terminalCommitment',
  'parentHash',
  'blockHash',
] as const

class AtomicCursorWriteFailure extends Error {
  constructor(
    cause: unknown,
    readonly destinationReplaced: boolean,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`settlement continuity write failed: ${detail}`)
    this.name = 'AtomicCursorWriteFailure'
  }
}

function cloneCursor(
  cursor: SettlementContinuityCursor | null,
): SettlementContinuityCursor | null {
  return cursor === null ? null : { ...cursor }
}

function validateHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw new ProtocolError(`${label} must be 64 lowercase hex characters`)
  }
}

function validateBlockHash(
  value: unknown,
  label: string,
): asserts value is string {
  if (typeof value !== 'string' || !BLOCK_HASH_RE.test(value)) {
    throw new ProtocolError(`${label} must be a 32-byte 0x-prefixed hex hash`)
  }
}

function validateHeight(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !HEIGHT_RE.test(value)) {
    throw new ProtocolError(`${label} must be a canonical decimal integer`)
  }
}

function validateCursor(value: unknown): SettlementContinuityCursor {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('settlement continuity cursor must be an object')
  }
  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== CURSOR_KEYS.length ||
    CURSOR_KEYS.some((key) => !Object.hasOwn(record, key))
  ) {
    throw new ProtocolError(
      'settlement continuity cursor has missing or unsupported fields',
    )
  }

  validateHash(record.batchHash, 'cursor batch hash')
  validateHeight(record.startHeight, 'cursor start height')
  validateHeight(record.endHeight, 'cursor end height')
  validateHash(record.previousCommitment, 'cursor previous commitment')
  validateHash(record.terminalCommitment, 'cursor terminal commitment')
  validateBlockHash(record.parentHash, 'cursor parent hash')
  validateBlockHash(record.blockHash, 'cursor block hash')

  if (BigInt(record.startHeight) > BigInt(record.endHeight)) {
    throw new ProtocolError('cursor start height cannot exceed its end height')
  }

  return record as unknown as SettlementContinuityCursor
}

function validateSnapshot(value: unknown): Snapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('settlement continuity store must be a JSON object')
  }
  const snapshot = value as Record<string, unknown>
  const keys = Object.keys(snapshot)
  if (
    keys.length !== 3 ||
    !['format', 'version', 'cursor'].every((key) => Object.hasOwn(snapshot, key))
  ) {
    throw new ProtocolError(
      'settlement continuity store has missing or unsupported fields',
    )
  }
  if (
    snapshot.format !== BTCS_L2_SETTLEMENT_CONTINUITY_FORMAT ||
    snapshot.version !== BTCS_L2_SETTLEMENT_CONTINUITY_VERSION
  ) {
    throw new ProtocolError(
      'unsupported settlement continuity store format or version',
    )
  }

  return {
    format: BTCS_L2_SETTLEMENT_CONTINUITY_FORMAT,
    version: BTCS_L2_SETTLEMENT_CONTINUITY_VERSION,
    cursor:
      snapshot.cursor === null ? null : cloneCursor(validateCursor(snapshot.cursor)),
  }
}

function encodeSnapshot(cursor: SettlementContinuityCursor | null): Uint8Array {
  const snapshot: Snapshot = {
    format: BTCS_L2_SETTLEMENT_CONTINUITY_FORMAT,
    version: BTCS_L2_SETTLEMENT_CONTINUITY_VERSION,
    cursor: cloneCursor(cursor),
  }
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  if (bytes.byteLength > MAX_STORE_BYTES) {
    throw new ProtocolError('settlement continuity store exceeds the size limit')
  }
  return bytes
}

async function atomicWrite(
  directory: string,
  path: string,
  contents: Uint8Array,
): Promise<void> {
  const temporaryPath = join(directory, `.continuity.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let renamed = false

  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(contents)
    await handle.sync()
    await handle.close()
    handle = undefined

    await rename(temporaryPath, path)
    renamed = true

    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    if (!renamed) await unlink(temporaryPath).catch(() => undefined)
    throw new AtomicCursorWriteFailure(error, renamed)
  }
}

async function assertDirectory(directory: string): Promise<string> {
  const resolved = resolve(directory)
  const info = await lstat(resolved)
  if (!info.isDirectory()) {
    throw new ProtocolError('settlement continuity path must be a real directory')
  }
  return resolved
}

async function readSnapshot(directory: string): Promise<Snapshot> {
  const path = join(directory, BTCS_L2_SETTLEMENT_CONTINUITY_FILE)
  let info
  try {
    info = await lstat(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new ProtocolError(
        'settlement continuity file is missing; refusing to initialize or repair it',
      )
    }
    throw error
  }

  if (!info.isFile() || info.size > MAX_STORE_BYTES) {
    throw new ProtocolError(
      'settlement continuity store is not a regular file or exceeds the size limit',
    )
  }

  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_STORE_BYTES) {
    throw new ProtocolError('settlement continuity store exceeds the size limit')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(bytes.toString('utf8'))
  } catch {
    throw new ProtocolError('settlement continuity store contains invalid JSON')
  }
  return validateSnapshot(parsed)
}

function batchCursor(batch: EvmSettlementBatch): SettlementContinuityCursor {
  const first = batch.envelopes[0]
  const last = batch.envelopes[batch.envelopes.length - 1]
  if (first === undefined || last === undefined) {
    throw new ProtocolError('settlement batch is empty')
  }
  return {
    batchHash: batch.batchHash,
    startHeight: batch.startHeight,
    endHeight: batch.endHeight,
    previousCommitment: batch.previousCommitment,
    terminalCommitment: batch.terminalCommitment,
    parentHash: first.parentHash,
    blockHash: last.blockHash,
  }
}

function cursorMatchesBatch(
  cursor: SettlementContinuityCursor,
  batch: EvmSettlementBatch,
): boolean {
  const candidate = batchCursor(batch)
  return CURSOR_KEYS.every((key) => cursor[key] === candidate[key])
}

function cursorsEqual(
  left: SettlementContinuityCursor | null,
  right: SettlementContinuityCursor | null,
): boolean {
  if (left === null || right === null) return left === right
  return CURSOR_KEYS.every((key) => left[key] === right[key])
}

function assertReportMatchesBatch(
  report: EvmSettlementReplayReport,
  batch: EvmSettlementBatch,
): void {
  if (
    report.format !== 'btcs-l2-evm-settlement-replay-report' ||
    report.version !== 'v1' ||
    report.executionVerified !== true ||
    report.batchHash !== batch.batchHash ||
    report.startHeight !== batch.startHeight ||
    report.endHeight !== batch.endHeight ||
    !Number.isSafeInteger(report.blocksVerified) ||
    report.blocksVerified !== batch.envelopes.length ||
    !Number.isSafeInteger(report.childBlocksReexecuted) ||
    report.childBlocksReexecuted < 0
  ) {
    throw new ProtocolError(
      'settlement replay report does not match the batch being accepted',
    )
  }
}

/**
 * Durable, single-writer cursor for settlement batch continuity.
 *
 * A batch can advance the cursor only when its start height is exactly one
 * after the cursor's end height, its previous commitment equals the cursor's
 * terminal commitment, and its first block's parent hash equals the cursor's
 * last block hash. Every advancing batch is independently re-executed.
 *
 * A genesis cursor starts from the fixed zero commitment and zero parent hash
 * at height 0. Re-accepting the exact current batch is idempotent. Earlier,
 * overlapping, gapped, duplicate, or forked batches fail closed.
 *
 * This store does not prove BTCS L1 publication or finality. Callers should
 * advance it only after the corresponding L1 publication is confirmed.
 */
export class SettlementContinuityStore {
  private cursor: SettlementContinuityCursor | null
  private mutationQueue: Promise<void> = Promise.resolve()
  private persistenceUncertain = false

  private constructor(
    private readonly directory: string,
    cursor: SettlementContinuityCursor | null,
  ) {
    this.cursor = cursor
  }

  static async create(directory: string): Promise<SettlementContinuityStore> {
    await mkdir(resolve(directory), { recursive: true, mode: 0o700 })
    const resolved = await assertDirectory(directory)
    const path = join(resolved, BTCS_L2_SETTLEMENT_CONTINUITY_FILE)

    try {
      await lstat(path)
      throw new ProtocolError(
        'settlement continuity store already exists; refusing to overwrite it',
      )
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    await atomicWrite(resolved, path, encodeSnapshot(null))
    return new SettlementContinuityStore(resolved, null)
  }

  static async open(directory: string): Promise<SettlementContinuityStore> {
    const resolved = await assertDirectory(directory)
    const snapshot = await readSnapshot(resolved)
    return new SettlementContinuityStore(resolved, snapshot.cursor)
  }

  getCursor(): SettlementContinuityCursor | null {
    this.assertUsable()
    return cloneCursor(this.cursor)
  }

  /**
   * Resolved directory that identifies this durable continuity history.
   *
   * Publication stores persist this identity so they cannot silently reopen
   * against a fresh continuity cursor.
   */
  getDirectory(): string {
    return this.directory
  }

  /**
   * Re-execute and durably accept the next batch.
   *
   * A non-genesis batch requires a checkpoint at exactly the cursor's current
   * end height. The checkpoint's block hash is bound through the expected
   * parent hash and is rechecked by the checkpoint replay verifier.
   */
  acceptBatch(
    value: unknown,
    checkpoint?: SettlementContinuityCheckpoint,
  ): Promise<SettlementContinuityCursor> {
    return this.enqueue(async () => {
      this.assertUsable()
      const prepared = await this.prepareUnlocked(value, checkpoint)
      return this.persistCursor(prepared.nextCursor)
    })
  }

  /**
   * Replay and validate a batch without mutating the cursor.
   *
   * The returned token can be committed later only if the cursor has not
   * changed in the meantime. This allows a publication workflow to reject an
   * invalid settlement batch before persisting L1 confirmation.
   */
  prepareBatch(
    value: unknown,
    checkpoint?: SettlementContinuityCheckpoint,
  ): Promise<PreparedSettlementBatch> {
    return this.enqueue(async () => {
      this.assertUsable()
      return this.prepareUnlocked(value, checkpoint)
    })
  }

  /** Persist a prepared batch if the continuity cursor is still unchanged. */
  commitPreparedBatch(
    prepared: PreparedSettlementBatch,
  ): Promise<SettlementContinuityCursor> {
    return this.enqueue(async () => {
      this.assertUsable()
      const current = this.cursor
      if (!cursorsEqual(current, prepared.previousCursor)) {
        throw new ProtocolError(
          'settlement continuity cursor changed after the batch was prepared',
        )
      }
      return this.persistCursor(prepared.nextCursor)
    })
  }

  private async prepareUnlocked(
    value: unknown,
    checkpoint?: SettlementContinuityCheckpoint,
  ): Promise<PreparedSettlementBatch> {
    const current = this.cursor
    if (current === null) {
      const batch = verifyEvmSettlementBatch(
        value,
        ZERO_COMMITMENT,
        ZERO_SETTLEMENT_PARENT_HASH,
        '0',
      )
      const report = await verifyEvmSettlementBatchExecution(
        batch,
        ZERO_COMMITMENT,
        ZERO_SETTLEMENT_PARENT_HASH,
        '0',
      )
      assertReportMatchesBatch(report, batch)
      return { previousCursor: null, nextCursor: batchCursor(batch) }
    }

    const candidateBatchHash =
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>).batchHash
        : undefined
    if (candidateBatchHash === current.batchHash) {
      const repeated = verifyEvmSettlementBatch(
        value,
        current.previousCommitment,
        current.parentHash,
        current.startHeight,
      )
      if (!cursorMatchesBatch(current, repeated)) {
        throw new ProtocolError(
          'repeated batch hash does not match the persisted continuity cursor',
        )
      }
      return {
        previousCursor: cloneCursor(current),
        nextCursor: cloneCursor(current) as SettlementContinuityCursor,
      }
    }

    const nextStartHeight = (BigInt(current.endHeight) + 1n).toString()
    const batch = verifyEvmSettlementBatch(
      value,
      current.terminalCommitment,
      current.blockHash,
      nextStartHeight,
    )

    if (checkpoint === undefined) {
      throw new ProtocolError(
        'a non-genesis settlement batch requires a checkpoint at the continuity cursor',
      )
    }

    const report = await verifyEvmSettlementBatchExecutionFromCheckpoint(
      batch,
      current.terminalCommitment,
      current.blockHash,
      nextStartHeight,
      checkpoint.checkpointDirectory,
      checkpoint.canonicalView,
    )
    assertReportMatchesBatch(report, batch)
    if (
      !('checkpointHeight' in report) ||
      report.checkpointHeight !== current.endHeight
    ) {
      throw new ProtocolError(
        'settlement checkpoint must be exactly at the continuity cursor height',
      )
    }

    return {
      previousCursor: cloneCursor(current),
      nextCursor: batchCursor(batch),
    }
  }

  private async persistCursor(
    cursor: SettlementContinuityCursor,
  ): Promise<SettlementContinuityCursor> {
    try {
      await atomicWrite(
        this.directory,
        join(this.directory, BTCS_L2_SETTLEMENT_CONTINUITY_FILE),
        encodeSnapshot(cursor),
      )
    } catch (error) {
      if (
        error instanceof AtomicCursorWriteFailure &&
        error.destinationReplaced
      ) {
        this.persistenceUncertain = true
      }
      throw error
    }

    this.cursor = cloneCursor(cursor)
    return cloneCursor(cursor) as SettlementContinuityCursor
  }

  private assertUsable(): void {
    if (this.persistenceUncertain) {
      throw new ProtocolError(
        'settlement continuity persistence outcome is uncertain; reopen the store before continuing',
      )
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
