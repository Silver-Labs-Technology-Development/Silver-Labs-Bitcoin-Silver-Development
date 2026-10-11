import { ProtocolError } from './blockProcessor.js'

const HASH_RE = /^[0-9a-f]{64}$/
const STATES = new Set<BtcsL1PublicationState>([
  'prepared',
  'submitted',
  'observed',
  'confirmed',
  'invalidated',
])

export type BtcsL1PublicationState =
  | 'prepared'
  | 'submitted'
  | 'observed'
  | 'confirmed'
  | 'invalidated'

export type BtcsL1PublicationRecord = Readonly<{
  format: 'btcs-l2-btcs-l1-publication'
  version: 1
  batchHash: string
  state: BtcsL1PublicationState
  txid?: string
  blockHash?: string
  blockHeight?: number
  confirmations?: number
  requiredConfirmations: number
}>

function validateHash(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw new ProtocolError(`${label} must be 64 lowercase hex characters`)
  }
}

function validateNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProtocolError(`${label} must be a non-negative safe integer`)
  }
}

export function validateBtcsL1PublicationRecord(value: unknown): BtcsL1PublicationRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('publication record must be an object')
  }

  const record = value as unknown as Record<string, unknown>
  const allowed = new Set([
    'format', 'version', 'batchHash', 'state', 'txid',
    'blockHash', 'blockHeight', 'confirmations', 'requiredConfirmations',
  ])

  if (Object.keys(record).some((key) => !allowed.has(key))) {
    throw new ProtocolError('publication record contains unknown fields')
  }
  if (record.format !== 'btcs-l2-btcs-l1-publication' || record.version !== 1) {
    throw new ProtocolError('unsupported publication record format or version')
  }

  validateHash(record.batchHash, 'batch hash')
  if (typeof record.state !== 'string' || !STATES.has(record.state as BtcsL1PublicationState)) {
    throw new ProtocolError('publication state is invalid')
  }
  if (
    typeof record.requiredConfirmations !== 'number' ||
    !Number.isSafeInteger(record.requiredConfirmations) ||
    record.requiredConfirmations < 1
  ) {
    throw new ProtocolError('required confirmations must be a positive safe integer')
  }

  const hasTxid = record.txid !== undefined
  const hasBlockHash = record.blockHash !== undefined
  const hasBlockHeight = record.blockHeight !== undefined
  const hasConfirmations = record.confirmations !== undefined

  if (hasTxid) validateHash(record.txid, 'transaction ID')
  if (hasBlockHash) validateHash(record.blockHash, 'block hash')
  if (hasBlockHeight) validateNonNegativeInteger(record.blockHeight, 'block height')
  if (hasConfirmations) validateNonNegativeInteger(record.confirmations, 'confirmation count')

  switch (record.state) {
    case 'prepared':
      if (hasTxid || hasBlockHash || hasBlockHeight || hasConfirmations) {
        throw new ProtocolError('prepared publication cannot contain transaction inclusion data')
      }
      break
    case 'submitted':
      if (!hasTxid || hasBlockHash || hasBlockHeight || hasConfirmations) {
        throw new ProtocolError('submitted publication must have only a transaction ID')
      }
      break
    case 'observed':
    case 'confirmed':
      if (!hasTxid || !hasBlockHash || !hasBlockHeight || !hasConfirmations) {
        throw new ProtocolError('observed publication requires complete transaction inclusion data')
      }
      if ((record.confirmations as number) < 1) {
        throw new ProtocolError('observed publication must have at least one confirmation')
      }
      if (
        record.state === 'confirmed' &&
        (record.confirmations as number) < (record.requiredConfirmations as number)
      ) {
        throw new ProtocolError('confirmed publication is below its confirmation threshold')
      }
      break
    case 'invalidated':
      if (!hasTxid || hasBlockHash || hasBlockHeight || hasConfirmations) {
        throw new ProtocolError('invalidated publication must retain only its transaction ID')
      }
      break
  }
  return value as BtcsL1PublicationRecord
}

export function createBtcsL1Publication(
  batchHash: string,
  requiredConfirmations: number,
): BtcsL1PublicationRecord {
  validateHash(batchHash, 'batch hash')
  if (!Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new ProtocolError('required confirmations must be a positive safe integer')
  }

  return {
    format: 'btcs-l2-btcs-l1-publication',
    version: 1,
    batchHash,
    state: 'prepared',
    requiredConfirmations,
  }
}

export function markBtcsL1PublicationSubmitted(
  record: BtcsL1PublicationRecord,
  txid: string,
): BtcsL1PublicationRecord {
  validateBtcsL1PublicationRecord(record)
  if (record.state !== 'prepared') {
    throw new ProtocolError('only a prepared publication can be submitted')
  }
  validateHash(txid, 'transaction ID')

  return { ...record, state: 'submitted', txid }
}

export function observeBtcsL1Publication(
  record: BtcsL1PublicationRecord,
  blockHash: string,
  blockHeight: number,
  confirmations: number,
): BtcsL1PublicationRecord {
  validateBtcsL1PublicationRecord(record)
  if (
    record.state !== 'submitted' &&
    record.state !== 'observed' &&
    record.state !== 'confirmed'
  ) {
    throw new ProtocolError(
      'only a submitted, observed, or confirmed publication can be observed',
    )
  }

  validateHash(blockHash, 'block hash')
  validateNonNegativeInteger(blockHeight, 'block height')
  validateNonNegativeInteger(confirmations, 'confirmation count')

  if (confirmations < 1) {
    throw new ProtocolError('an observed publication must have at least one confirmation')
  }
  if (
    (record.state === 'observed' || record.state === 'confirmed') &&
    (record.blockHash !== blockHash || record.blockHeight !== blockHeight)
  ) {
    throw new ProtocolError(
      'publication inclusion changed; invalidate it before observing a new block',
    )
  }
  if (
    (record.state === 'observed' || record.state === 'confirmed') &&
    confirmations < (record.confirmations ?? 0)
  ) {
    throw new ProtocolError(
      'confirmation count cannot decrease without explicit invalidation',
    )
  }

  const next: BtcsL1PublicationRecord = {
    ...record,
    state: confirmations >= record.requiredConfirmations ? 'confirmed' : 'observed',
    blockHash,
    blockHeight,
    confirmations,
  }
  validateBtcsL1PublicationRecord(next)
  return next
}

export function reobserveBtcsL1Publication(
  record: BtcsL1PublicationRecord,
  blockHash: string,
  blockHeight: number,
  confirmations: number,
): BtcsL1PublicationRecord {
  validateBtcsL1PublicationRecord(record)
  if (record.state !== 'invalidated') {
    throw new ProtocolError('only an invalidated publication can be re-observed')
  }

  validateHash(blockHash, 'block hash')
  validateNonNegativeInteger(blockHeight, 'block height')
  validateNonNegativeInteger(confirmations, 'confirmation count')
  if (confirmations < 1) {
    throw new ProtocolError('a re-observed publication must have at least one confirmation')
  }

  const next: BtcsL1PublicationRecord = {
    ...record,
    state: confirmations >= record.requiredConfirmations ? 'confirmed' : 'observed',
    blockHash,
    blockHeight,
    confirmations,
  }
  validateBtcsL1PublicationRecord(next)
  return next
}

export function invalidateBtcsL1Publication(
  record: BtcsL1PublicationRecord,
): BtcsL1PublicationRecord {
  validateBtcsL1PublicationRecord(record)
  if (record.state !== 'observed' && record.state !== 'confirmed') {
    throw new ProtocolError('only an observed or confirmed publication can be invalidated')
  }

  const { blockHash: _blockHash, blockHeight: _blockHeight, confirmations: _confirmations, ...base } = record
  const next: BtcsL1PublicationRecord = { ...base, state: 'invalidated' }
  validateBtcsL1PublicationRecord(next)
  return next
}
