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
import { ProtocolError } from './blockProcessor.js'
import type { BtcsL1DepositReport } from './btcsL1Deposit.js'

export const BTCS_L1_DEPOSIT_RECORD_FORMAT = 'btcs-l2-btcs-l1-deposit-record'
export const BTCS_L1_DEPOSIT_RECORD_VERSION = 1
export const BTCS_L1_DEPOSIT_STORE_FORMAT = 'btcs-l2-btcs-l1-deposit-store'
export const BTCS_L1_DEPOSIT_STORE_VERSION = 1
export const BTCS_L1_DEPOSIT_STORE_FILE = 'deposits.json'

const MAX_STORE_BYTES = 8 * 1024 * 1024
const MAX_RECORDS = 10_000
const HASH_RE = /^[0-9a-f]{64}$/
const DEPOSIT_ID_RE = /^([0-9a-f]{64}):(0|[1-9][0-9]*)$/
const ADDRESS_RE = /^0x[0-9a-f]{40}$/
const SATOSHI_AMOUNT_RE = /^[1-9][0-9]*$/

export type BtcsL1DepositState = 'confirmed' | 'invalidated'

export type BtcsL1DepositRecord = Readonly<{
  format: typeof BTCS_L1_DEPOSIT_RECORD_FORMAT
  version: typeof BTCS_L1_DEPOSIT_RECORD_VERSION
  /** Stable replay-protection key: transaction ID plus the deposit output index. */
  depositId: string
  txid: string
  depositOutputIndex: number
  recipientAddress: string
  amountSats: string
  requiredConfirmations: number
  state: BtcsL1DepositState
  /** Present only while this inclusion has been verified on the active chain. */
  blockHash?: string
  blockHeight?: number
  confirmations?: number
  /** Audit marker for the most recent invalidated inclusion. */
  lastInvalidatedBlockHash?: string
}>

type StoreSnapshot = Readonly<{
  format: typeof BTCS_L1_DEPOSIT_STORE_FORMAT
  version: typeof BTCS_L1_DEPOSIT_STORE_VERSION
  records: readonly BtcsL1DepositRecord[]
}>

export type BtcsL1DepositStorePersistenceStage =
  | 'temp-opened'
  | 'file-synced'
  | 'before-rename'
  | 'renamed'
  | 'directory-synced'

export type BtcsL1DepositStoreOptions = Readonly<{
  /** Fault injection for persistence tests; omit in normal use. */
  persistenceTestHook?: (
    stage: BtcsL1DepositStorePersistenceStage,
  ) => void | Promise<void>
}>

class AtomicWriteFailure extends Error {
  constructor(cause: unknown, readonly destinationReplaced: boolean) {
    const detail = cause instanceof Error ? cause.message : String(cause)
    super(`deposit store write failed: ${detail}`)
    this.name = 'AtomicWriteFailure'
  }
}

function cloneRecord(record: BtcsL1DepositRecord): BtcsL1DepositRecord {
  return JSON.parse(JSON.stringify(record)) as BtcsL1DepositRecord
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function validateDepositId(depositId: string): void {
  if (typeof depositId !== 'string') {
    throw new ProtocolError('deposit ID must be a transaction ID and output index')
  }
  const match = DEPOSIT_ID_RE.exec(depositId)
  if (!match || !Number.isSafeInteger(Number(match[2]))) {
    throw new ProtocolError('deposit ID must be a transaction ID and safe output index')
  }
}

function validateReport(
  reportValue: unknown,
  requiredConfirmations: number,
): BtcsL1DepositRecord {
  const report = asRecord(reportValue, 'verified deposit report')
  if (
    report.format !== 'btcs-l2-btcs-l1-deposit-verification' ||
    report.version !== 1 ||
    (report.verificationModel !== 'trusted-btcs-core-rpc' &&
      report.verificationModel !== 'trusted-btcs-core-rpc+local-inclusion-proof') ||
    report.activeChain !== true ||
    report.depositVerified !== true
  ) {
    throw new ProtocolError('deposit report is not a successful trusted-Core verification')
  }
  if (!Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new ProtocolError('required confirmations must be a positive safe integer')
  }
  if (
    typeof report.txid !== 'string' || !HASH_RE.test(report.txid) ||
    typeof report.blockHash !== 'string' || !HASH_RE.test(report.blockHash)
  ) {
    throw new ProtocolError('verified deposit report has invalid transaction or block hash')
  }
  if (
    !Number.isSafeInteger(report.depositOutputIndex) ||
    (report.depositOutputIndex as number) < 0
  ) {
    throw new ProtocolError('verified deposit report has an invalid output index')
  }
  const expectedId = `${report.txid}:${report.depositOutputIndex}`
  if (report.depositId !== expectedId) {
    throw new ProtocolError('verified deposit report has an inconsistent deposit ID')
  }
  if (
    typeof report.recipientAddress !== 'string' ||
    !ADDRESS_RE.test(report.recipientAddress) ||
    report.recipientAddress !== report.recipientAddress.toLowerCase()
  ) {
    throw new ProtocolError('verified deposit report has an invalid recipient address')
  }
  if (typeof report.amountSats !== 'string' || !SATOSHI_AMOUNT_RE.test(report.amountSats)) {
    throw new ProtocolError('verified deposit report has an invalid satoshi amount')
  }
  if (
    !Number.isSafeInteger(report.blockHeight) || (report.blockHeight as number) < 0 ||
    !Number.isSafeInteger(report.confirmations) ||
    (report.confirmations as number) < requiredConfirmations
  ) {
    throw new ProtocolError('verified deposit report does not meet its confirmation requirement')
  }

  const record: BtcsL1DepositRecord = {
    format: BTCS_L1_DEPOSIT_RECORD_FORMAT,
    version: BTCS_L1_DEPOSIT_RECORD_VERSION,
    depositId: expectedId,
    txid: report.txid,
    depositOutputIndex: report.depositOutputIndex as number,
    recipientAddress: report.recipientAddress,
    amountSats: report.amountSats,
    requiredConfirmations,
    state: 'confirmed',
    blockHash: report.blockHash,
    blockHeight: report.blockHeight as number,
    confirmations: report.confirmations as number,
  }
  return validateDepositRecord(record)
}

function validateDepositRecord(value: unknown): BtcsL1DepositRecord {
  const record = asRecord(value, 'deposit record')
  const requiredKeys = [
    'format', 'version', 'depositId', 'txid', 'depositOutputIndex',
    'recipientAddress', 'amountSats', 'requiredConfirmations', 'state',
  ]
  const optionalKeys = [
    'blockHash', 'blockHeight', 'confirmations', 'lastInvalidatedBlockHash',
  ]
  if (
    !requiredKeys.every((key) => Object.hasOwn(record, key)) ||
    Object.keys(record).some((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key))
  ) {
    throw new ProtocolError('deposit record has missing or unsupported fields')
  }
  if (
    record.format !== BTCS_L1_DEPOSIT_RECORD_FORMAT ||
    record.version !== BTCS_L1_DEPOSIT_RECORD_VERSION
  ) {
    throw new ProtocolError('unsupported deposit record format or version')
  }
  if (typeof record.txid !== 'string' || !HASH_RE.test(record.txid)) {
    throw new ProtocolError('deposit record has an invalid transaction ID')
  }
  if (
    !Number.isSafeInteger(record.depositOutputIndex) ||
    (record.depositOutputIndex as number) < 0 ||
    record.depositId !== `${record.txid}:${record.depositOutputIndex}`
  ) {
    throw new ProtocolError('deposit record has an inconsistent deposit ID')
  }
  validateDepositId(record.depositId as string)
  if (
    typeof record.recipientAddress !== 'string' ||
    !ADDRESS_RE.test(record.recipientAddress) ||
    record.recipientAddress !== record.recipientAddress.toLowerCase()
  ) {
    throw new ProtocolError('deposit record has an invalid recipient address')
  }
  if (typeof record.amountSats !== 'string' || !SATOSHI_AMOUNT_RE.test(record.amountSats)) {
    throw new ProtocolError('deposit record has an invalid satoshi amount')
  }
  if (!Number.isSafeInteger(record.requiredConfirmations) || (record.requiredConfirmations as number) < 1) {
    throw new ProtocolError('deposit record has an invalid confirmation requirement')
  }
  if (record.state !== 'confirmed' && record.state !== 'invalidated') {
    throw new ProtocolError('deposit record has an invalid state')
  }

  const inclusionKeys = ['blockHash', 'blockHeight', 'confirmations']
  const inclusionPresent = inclusionKeys.filter((key) => Object.hasOwn(record, key)).length
  if (record.state === 'confirmed' && inclusionPresent !== inclusionKeys.length) {
    throw new ProtocolError('confirmed deposit record is missing inclusion data')
  }
  if (record.state === 'invalidated' && inclusionPresent !== 0) {
    throw new ProtocolError('invalidated deposit record must not retain active inclusion data')
  }
  if (record.state === 'confirmed') {
    if (typeof record.blockHash !== 'string' || !HASH_RE.test(record.blockHash)) {
      throw new ProtocolError('deposit record has an invalid block hash')
    }
    if (!Number.isSafeInteger(record.blockHeight) || (record.blockHeight as number) < 0) {
      throw new ProtocolError('deposit record has an invalid block height')
    }
    if (
      !Number.isSafeInteger(record.confirmations) ||
      (record.confirmations as number) < (record.requiredConfirmations as number)
    ) {
      throw new ProtocolError('deposit record has insufficient confirmations')
    }
  }
  if (Object.hasOwn(record, 'lastInvalidatedBlockHash')) {
    if (typeof record.lastInvalidatedBlockHash !== 'string' || !HASH_RE.test(record.lastInvalidatedBlockHash)) {
      throw new ProtocolError('deposit record has an invalid last-invalidated block hash')
    }
  } else if (record.state === 'invalidated') {
    throw new ProtocolError('invalidated deposit record must retain its invalidated block hash')
  }

  return cloneRecord(record as unknown as BtcsL1DepositRecord)
}

function validateSnapshot(value: unknown): Map<string, BtcsL1DepositRecord> {
  const snapshot = asRecord(value, 'deposit store')
  const expectedKeys = ['format', 'version', 'records']
  if (
    Object.keys(snapshot).length !== expectedKeys.length ||
    !expectedKeys.every((key) => Object.hasOwn(snapshot, key))
  ) {
    throw new ProtocolError('deposit store has missing or unsupported fields')
  }
  if (
    snapshot.format !== BTCS_L1_DEPOSIT_STORE_FORMAT ||
    snapshot.version !== BTCS_L1_DEPOSIT_STORE_VERSION
  ) {
    throw new ProtocolError('unsupported deposit store format or version')
  }
  if (!Array.isArray(snapshot.records) || snapshot.records.length > MAX_RECORDS) {
    throw new ProtocolError('deposit store records are invalid or exceed the record limit')
  }

  const records = new Map<string, BtcsL1DepositRecord>()
  for (const value of snapshot.records) {
    const record = validateDepositRecord(value)
    if (records.has(record.depositId)) {
      throw new ProtocolError('deposit store contains duplicate deposit IDs')
    }
    records.set(record.depositId, record)
  }
  return records
}

function encodeSnapshot(records: ReadonlyMap<string, BtcsL1DepositRecord>): Uint8Array {
  const snapshot: StoreSnapshot = {
    format: BTCS_L1_DEPOSIT_STORE_FORMAT,
    version: BTCS_L1_DEPOSIT_STORE_VERSION,
    records: [...records.values()]
      .sort((a, b) => (a.depositId < b.depositId ? -1 : a.depositId > b.depositId ? 1 : 0))
      .map(cloneRecord),
  }
  if (snapshot.records.length > MAX_RECORDS) {
    throw new ProtocolError('deposit store exceeds the record limit')
  }
  const bytes = Buffer.from(`${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  if (bytes.byteLength > MAX_STORE_BYTES) {
    throw new ProtocolError('deposit store exceeds the file-size limit')
  }
  return bytes
}

async function atomicWrite(
  directory: string,
  path: string,
  contents: Uint8Array,
  persistenceTestHook?: BtcsL1DepositStoreOptions['persistenceTestHook'],
): Promise<void> {
  const temporaryPath = join(directory, `.deposits.${randomUUID()}.tmp`)
  let handle: Awaited<ReturnType<typeof open>> | undefined
  let renamed = false
  const inject = async (stage: BtcsL1DepositStorePersistenceStage): Promise<void> => {
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
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new ProtocolError('deposit store path must be a real directory')
  }
  return resolved
}

async function readSnapshot(directory: string): Promise<Map<string, BtcsL1DepositRecord>> {
  const path = join(directory, BTCS_L1_DEPOSIT_STORE_FILE)
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new ProtocolError('deposit store snapshot must be a regular file')
  }
  if (info.size > MAX_STORE_BYTES) {
    throw new ProtocolError('deposit store exceeds the file-size limit')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProtocolError('deposit store contains invalid JSON')
    }
    throw error
  }
  return validateSnapshot(parsed)
}

function assertSameDeposit(
  current: BtcsL1DepositRecord,
  next: BtcsL1DepositRecord,
): void {
  if (
    current.depositId !== next.depositId ||
    current.txid !== next.txid ||
    current.depositOutputIndex !== next.depositOutputIndex ||
    current.recipientAddress !== next.recipientAddress ||
    current.amountSats !== next.amountSats
  ) {
    throw new ProtocolError('verified deposit does not match the stored deposit identity and amount')
  }
}

export class BtcsL1DepositStore {
  private records: Map<string, BtcsL1DepositRecord>
  private readonly directory: string
  private readonly persistenceTestHook?: BtcsL1DepositStoreOptions['persistenceTestHook']
  private mutationQueue: Promise<void> = Promise.resolve()
  private persistenceUncertain = false

  private constructor(
    directory: string,
    records: Map<string, BtcsL1DepositRecord>,
    options: BtcsL1DepositStoreOptions = {},
  ) {
    this.directory = directory
    this.records = records
    this.persistenceTestHook = options.persistenceTestHook
  }

  static async create(
    directory: string,
    options: BtcsL1DepositStoreOptions = {},
  ): Promise<BtcsL1DepositStore> {
    await mkdir(resolve(directory), { recursive: true, mode: 0o700 })
    const resolved = await assertDirectory(directory)
    const path = join(resolved, BTCS_L1_DEPOSIT_STORE_FILE)
    try {
      await lstat(path)
      throw new ProtocolError('deposit store already exists; refusing to overwrite it')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const records = new Map<string, BtcsL1DepositRecord>()
    await atomicWrite(resolved, path, encodeSnapshot(records), options.persistenceTestHook)
    return new BtcsL1DepositStore(resolved, records, options)
  }

  static async open(
    directory: string,
    options: BtcsL1DepositStoreOptions = {},
  ): Promise<BtcsL1DepositStore> {
    const resolved = await assertDirectory(directory)
    const records = await readSnapshot(resolved)
    return new BtcsL1DepositStore(resolved, records, options)
  }

  /** Directory containing the durable store, for coordinating cooperating watchers. */
  get directoryPath(): string {
    return this.directory
  }

  get(depositId: string): BtcsL1DepositRecord | undefined {
    this.assertUsable()
    validateDepositId(depositId)
    const record = this.records.get(depositId)
    return record === undefined ? undefined : cloneRecord(record)
  }

  list(): readonly BtcsL1DepositRecord[] {
    this.assertUsable()
    return [...this.records.values()]
      .sort((a, b) => (a.depositId < b.depositId ? -1 : a.depositId > b.depositId ? 1 : 0))
      .map(cloneRecord)
  }

  /** Record a deposit only from a successful confirmation-verifier report. */
  recordVerifiedDeposit(
    report: BtcsL1DepositReport,
    requiredConfirmations: number,
  ): Promise<BtcsL1DepositRecord> {
    const record = validateReport(report, requiredConfirmations)
    return this.enqueue(async () => {
      this.assertUsable()
      if (this.records.has(record.depositId)) {
        throw new ProtocolError('deposit already exists for this transaction output')
      }
      const next = new Map(this.records)
      next.set(record.depositId, record)
      await this.persist(next)
      this.records = next
      return cloneRecord(record)
    })
  }

  /** Advance confirmations only from a fresh verifier report for the same inclusion. */
  updateConfirmations(report: BtcsL1DepositReport): Promise<BtcsL1DepositRecord> {
    return this.enqueue(async () => {
      this.assertUsable()
      const current = this.records.get(report?.depositId)
      if (current === undefined) {
        throw new ProtocolError('deposit does not exist for this transaction output')
      }
      const verified = validateReport(report, current.requiredConfirmations)
      assertSameDeposit(current, verified)
      if (current.state !== 'confirmed') {
        throw new ProtocolError('invalidated deposit must be re-observed, not confirmation-updated')
      }
      if (verified.blockHash !== current.blockHash || verified.blockHeight !== current.blockHeight) {
        throw new ProtocolError('deposit inclusion changed; invalidate and re-observe it')
      }
      if ((verified.confirmations as number) < (current.confirmations as number)) {
        throw new ProtocolError('deposit confirmation count cannot regress')
      }
      const next = new Map(this.records)
      const updated = current.lastInvalidatedBlockHash === undefined
        ? verified
        : validateDepositRecord({ ...verified, lastInvalidatedBlockHash: current.lastInvalidatedBlockHash })
      next.set(current.depositId, updated)
      await this.persist(next)
      this.records = next
      return cloneRecord(next.get(current.depositId)!)
    })
  }

  /**
   * Persist invalidation only after the caller independently establishes a
   * canonical-chain reorg. Do not call this because an RPC is unavailable.
   */
  invalidate(depositId: string, expectedBlockHash: string): Promise<BtcsL1DepositRecord> {
    validateDepositId(depositId)
    if (typeof expectedBlockHash !== 'string' || !HASH_RE.test(expectedBlockHash)) {
      throw new ProtocolError('expected block hash must be 64 lowercase hex characters')
    }
    return this.enqueue(async () => {
      this.assertUsable()
      const current = this.records.get(depositId)
      if (current === undefined) {
        throw new ProtocolError('deposit does not exist for this transaction output')
      }
      if (current.state !== 'confirmed' || current.blockHash !== expectedBlockHash) {
        throw new ProtocolError('deposit inclusion changed before invalidation')
      }
      const invalidated: BtcsL1DepositRecord = {
        format: BTCS_L1_DEPOSIT_RECORD_FORMAT,
        version: BTCS_L1_DEPOSIT_RECORD_VERSION,
        depositId: current.depositId,
        txid: current.txid,
        depositOutputIndex: current.depositOutputIndex,
        recipientAddress: current.recipientAddress,
        amountSats: current.amountSats,
        requiredConfirmations: current.requiredConfirmations,
        state: 'invalidated',
        lastInvalidatedBlockHash: expectedBlockHash,
      }
      const next = new Map(this.records)
      next.set(depositId, validateDepositRecord(invalidated))
      await this.persist(next)
      this.records = next
      return cloneRecord(next.get(depositId)!)
    })
  }

  /** Re-observe an invalidated deposit from a new successful verifier report. */
  reobserve(report: BtcsL1DepositReport): Promise<BtcsL1DepositRecord> {
    return this.enqueue(async () => {
      this.assertUsable()
      const current = this.records.get(report?.depositId)
      if (current === undefined) {
        throw new ProtocolError('deposit does not exist for this transaction output')
      }
      if (current.state !== 'invalidated') {
        throw new ProtocolError('deposit must be invalidated before re-observation')
      }
      const verified = validateReport(report, current.requiredConfirmations)
      assertSameDeposit(current, verified)
      const recovered = validateDepositRecord({
        ...verified,
        lastInvalidatedBlockHash: current.lastInvalidatedBlockHash,
      })
      const next = new Map(this.records)
      next.set(current.depositId, recovered)
      await this.persist(next)
      this.records = next
      return cloneRecord(recovered)
    })
  }

  private assertUsable(): void {
    if (this.persistenceUncertain) {
      throw new ProtocolError(
        'deposit store persistence outcome is uncertain; reopen the store before continuing',
      )
    }
  }

  private async persist(records: ReadonlyMap<string, BtcsL1DepositRecord>): Promise<void> {
    const bytes = encodeSnapshot(records)
    try {
      await atomicWrite(
        this.directory,
        join(this.directory, BTCS_L1_DEPOSIT_STORE_FILE),
        bytes,
        this.persistenceTestHook,
      )
    } catch (error) {
      if (error instanceof AtomicWriteFailure && error.destinationReplaced) {
        this.persistenceUncertain = true
      }
      throw error
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}
