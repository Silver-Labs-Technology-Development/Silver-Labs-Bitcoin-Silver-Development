import { createHash } from 'node:crypto'
import {
  EvmSettlementEnvelope,
  ZERO_COMMITMENT,
  verifyEvmSettlementEnvelope,
} from './settlementEnvelope.js'
import { ProtocolError } from './blockProcessor.js'

export const EVM_SETTLEMENT_BATCH_FORMAT = 'btcs-l2-evm-settlement-batch'
export const EVM_SETTLEMENT_BATCH_VERSION = 'v2'
export const MAX_BATCH_BLOCKS = 1024

export type EvmSettlementBatch = Readonly<{
  format: typeof EVM_SETTLEMENT_BATCH_FORMAT
  version: typeof EVM_SETTLEMENT_BATCH_VERSION
  chainId: string
  profileId: string
  hardfork: string
  startHeight: string
  endHeight: string
  previousCommitment: string
  terminalCommitment: string
  envelopes: readonly EvmSettlementEnvelope[]
  batchHash: string
}>

const BATCH_KEYS = [
  'format',
  'version',
  'chainId',
  'profileId',
  'hardfork',
  'startHeight',
  'endHeight',
  'previousCommitment',
  'terminalCommitment',
  'envelopes',
  'batchHash',
] as const

const COMMITMENT_RE = /^[0-9a-f]{64}$/
const HASH_RE = /^0x[0-9a-f]{64}$/

function hashBatchFields(
  batch: Omit<EvmSettlementBatch, 'batchHash'>,
): string {
  // Each envelope commitment binds its canonical block RLP and header fields.
  const canonical = [
    'BTCSL2-EVM-SETTLEMENT-BATCH|v2',
    `format=${batch.format}`,
    `version=${batch.version}`,
    `chain_id=${batch.chainId}`,
    `profile_id=${batch.profileId}`,
    `hardfork=${batch.hardfork}`,
    `start_height=${batch.startHeight}`,
    `end_height=${batch.endHeight}`,
    `previous_commitment=${batch.previousCommitment}`,
    `terminal_commitment=${batch.terminalCommitment}`,
    `envelope_commitments=${batch.envelopes.map((item) => item.commitmentHash).join(',')}`,
  ].join('\n')

  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

function checkEnvelopeSequence(
  envelopes: readonly EvmSettlementEnvelope[],
  expectedPreviousCommitment: string,
  expectedParentHash: string,
): EvmSettlementEnvelope[] {
  if (envelopes.length === 0 || envelopes.length > MAX_BATCH_BLOCKS) {
    throw new ProtocolError(
      `batch must contain between 1 and ${MAX_BATCH_BLOCKS} blocks`,
    )
  }
  if (!COMMITMENT_RE.test(expectedPreviousCommitment)) {
    throw new ProtocolError('expected starting commitment is malformed')
  }
  if (!HASH_RE.test(expectedParentHash)) {
    throw new ProtocolError('expected starting parent hash is malformed')
  }

  let previousCommitment = expectedPreviousCommitment
  let parentHash = expectedParentHash
  let previousHeight: bigint | undefined
  const verified: EvmSettlementEnvelope[] = []
  const seenDepositIds = new Set<string>()

  for (const candidate of envelopes) {
    const envelope = verifyEvmSettlementEnvelope(
      candidate,
      previousCommitment,
      parentHash,
    )
    for (const operation of envelope.depositOperations) {
      if (seenDepositIds.has(operation.depositId)) {
        throw new ProtocolError(
          `settlement batch repeats deposit claim ${operation.depositId}`,
        )
      }
      seenDepositIds.add(operation.depositId)
    }

    const height = BigInt(envelope.height)

    if (previousHeight !== undefined && height !== previousHeight + 1n) {
      throw new ProtocolError('batch block heights must be consecutive')
    }

    verified.push(envelope)
    previousHeight = height
    previousCommitment = envelope.commitmentHash
    parentHash = envelope.blockHash
  }

  return verified
}

/**
 * Builds a deterministic batch from an already ordered envelope sequence.
 * External verifiers must still supply trusted starting anchors.
 */
export function createEvmSettlementBatch(
  envelopes: readonly EvmSettlementEnvelope[],
): EvmSettlementBatch {
  if (envelopes.length === 0 || envelopes.length > MAX_BATCH_BLOCKS) {
    throw new ProtocolError(
      `batch must contain between 1 and ${MAX_BATCH_BLOCKS} blocks`,
    )
  }

  const first = envelopes[0]
  const last = envelopes[envelopes.length - 1]
  if (first === undefined || last === undefined) {
    throw new ProtocolError('batch is empty')
  }

  const verified = checkEnvelopeSequence(
    envelopes,
    first.previousCommitment,
    first.parentHash,
  )

  if (
    verified[0]!.height === '0' &&
    verified[0]!.previousCommitment !== ZERO_COMMITMENT
  ) {
    throw new ProtocolError('genesis batch must use the zero previous commitment')
  }

  const fields: Omit<EvmSettlementBatch, 'batchHash'> = {
    format: EVM_SETTLEMENT_BATCH_FORMAT,
    version: EVM_SETTLEMENT_BATCH_VERSION,
    chainId: first.chainId,
    profileId: first.profileId,
    hardfork: first.hardfork,
    startHeight: verified[0]!.height,
    endHeight: verified[verified.length - 1]!.height,
    previousCommitment: first.previousCommitment,
    terminalCommitment: last.commitmentHash,
    envelopes: verified,
  }

  return { ...fields, batchHash: hashBatchFields(fields) }
}

/**
 * Verifies batch structure, every envelope, sequential heights, parent hashes,
 * commitment links, and the deterministic batch hash.
 *
 * This does not re-execute EVM transactions or prove BTCS L1 publication,
 * settlement, or finality.
 */
export function verifyEvmSettlementBatch(
  value: unknown,
  expectedPreviousCommitment: string,
  expectedParentHash: string,
  expectedStartHeight: string,
): EvmSettlementBatch {
  if (!/^(0|[1-9][0-9]*)$/.test(expectedStartHeight)) {
    throw new ProtocolError('expected starting height must be a canonical decimal integer')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('settlement batch must be an object')
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== BATCH_KEYS.length ||
    BATCH_KEYS.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !(BATCH_KEYS as readonly string[]).includes(key))
  ) {
    throw new ProtocolError('settlement batch has missing or unknown fields')
  }

  for (const key of BATCH_KEYS) {
    if (key === 'envelopes') continue
    if (typeof record[key] !== 'string') {
      throw new ProtocolError(`settlement batch field ${key} must be a string`)
    }
  }

  const batch = record as unknown as EvmSettlementBatch
  if (
    batch.format !== EVM_SETTLEMENT_BATCH_FORMAT ||
    batch.version !== EVM_SETTLEMENT_BATCH_VERSION
  ) {
    throw new ProtocolError('unsupported settlement batch format or version')
  }
  if (!Array.isArray(batch.envelopes)) {
    throw new ProtocolError('settlement batch envelopes must be an array')
  }
  if (
    batch.envelopes.length === 0 ||
    batch.envelopes.length > MAX_BATCH_BLOCKS
  ) {
    throw new ProtocolError(
      `batch must contain between 1 and ${MAX_BATCH_BLOCKS} blocks`,
    )
  }

  const verified = checkEnvelopeSequence(
    batch.envelopes,
    expectedPreviousCommitment,
    expectedParentHash,
  )
  const first = verified[0]!
  const last = verified[verified.length - 1]!

  if (first.height === '0' && first.previousCommitment !== ZERO_COMMITMENT) {
    throw new ProtocolError('genesis batch must use the zero previous commitment')
  }
  if (first.height !== expectedStartHeight) {
    throw new ProtocolError('batch start height does not match the expected starting height')
  }
  if (
    batch.chainId !== first.chainId ||
    batch.profileId !== first.profileId ||
    batch.hardfork !== first.hardfork
  ) {
    throw new ProtocolError('batch chain or profile metadata does not match its blocks')
  }
  if (
    batch.startHeight !== first.height ||
    batch.endHeight !== last.height ||
    batch.previousCommitment !== expectedPreviousCommitment ||
    batch.terminalCommitment !== last.commitmentHash
  ) {
    throw new ProtocolError('batch range or commitment metadata does not match its blocks')
  }
  if (!COMMITMENT_RE.test(batch.batchHash)) {
    throw new ProtocolError('batch hash is malformed')
  }

  const fields: Omit<EvmSettlementBatch, 'batchHash'> = {
    format: batch.format,
    version: batch.version,
    chainId: batch.chainId,
    profileId: batch.profileId,
    hardfork: batch.hardfork,
    startHeight: batch.startHeight,
    endHeight: batch.endHeight,
    previousCommitment: batch.previousCommitment,
    terminalCommitment: batch.terminalCommitment,
    envelopes: verified,
  }
  if (hashBatchFields(fields) !== batch.batchHash) {
    throw new ProtocolError('settlement batch hash mismatch')
  }

  return batch
}
