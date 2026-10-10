import { createHash } from 'node:crypto'
import { createBlockFromRLP } from '@ethereumjs/block'
import { bytesToHex, equalsBytes, hexToBytes } from '@ethereumjs/util'
import { EVM_CHAIN_ID, EVM_HARDFORK, createHarnessCommon } from './config.js'
import {
  LOCAL_CHAIN_PROFILE,
  MAX_SERIALIZED_BLOCK_BYTES,
  ProtocolError,
} from './blockProcessor.js'

export const EVM_SETTLEMENT_FORMAT = 'btcs-l2-evm-settlement'
export const EVM_SETTLEMENT_VERSION = 'v1'
export const ZERO_COMMITMENT = '0'.repeat(64)

export type EvmSettlementEnvelope = Readonly<{
  format: typeof EVM_SETTLEMENT_FORMAT
  version: typeof EVM_SETTLEMENT_VERSION
  chainId: string
  profileId: string
  hardfork: string
  height: string
  blockRlpHex: string
  blockHash: string
  parentHash: string
  stateRoot: string
  transactionsRoot: string
  receiptsRoot: string
  previousCommitment: string
  commitmentHash: string
}>

const ENVELOPE_KEYS = [
  'format', 'version', 'chainId', 'profileId', 'hardfork', 'height',
  'blockRlpHex', 'blockHash', 'parentHash', 'stateRoot',
  'transactionsRoot', 'receiptsRoot', 'previousCommitment', 'commitmentHash',
] as const

const HASH_RE = /^0x[0-9a-f]{64}$/
const COMMITMENT_RE = /^[0-9a-f]{64}$/
const BLOCK_HEX_RE = /^0x(?:[0-9a-f]{2})+$/

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalFields(
  envelope: Omit<EvmSettlementEnvelope, 'commitmentHash'>,
): string {
  return [
    'BTCSL2-EVM-SETTLEMENT|v1',
    `chain_id=${envelope.chainId}`,
    `profile_id=${envelope.profileId}`,
    `hardfork=${envelope.hardfork}`,
    `height=${envelope.height}`,
    `block_rlp_hex=${envelope.blockRlpHex}`,
    `block_hash=${envelope.blockHash}`,
    `parent_hash=${envelope.parentHash}`,
    `state_root=${envelope.stateRoot}`,
    `transactions_root=${envelope.transactionsRoot}`,
    `receipts_root=${envelope.receiptsRoot}`,
    `previous_commitment=${envelope.previousCommitment}`,
  ].join('\n')
}

function calculateCommitment(
  envelope: Omit<EvmSettlementEnvelope, 'commitmentHash'>,
): string {
  return sha256Hex(canonicalFields(envelope))
}

function parseCanonicalBlock(blockRlpHex: string) {
  if (
    !BLOCK_HEX_RE.test(blockRlpHex) ||
    (blockRlpHex.length - 2) / 2 > MAX_SERIALIZED_BLOCK_BYTES
  ) {
    throw new ProtocolError('block RLP hex is malformed or exceeds the size limit')
  }

  const raw = hexToBytes(blockRlpHex as `0x${string}`)
  let block
  try {
    block = createBlockFromRLP(raw, { common: createHarnessCommon() })
  } catch (error) {
    throw new ProtocolError(
      `block RLP cannot be decoded for the configured EVM profile: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (!equalsBytes(block.serialize(), raw)) {
    throw new ProtocolError('block RLP is not canonical')
  }
  return block
}

function deriveEnvelopeFields(
  blockRlpHex: string,
  previousCommitment: string,
): Omit<EvmSettlementEnvelope, 'commitmentHash'> {
  if (!COMMITMENT_RE.test(previousCommitment)) {
    throw new ProtocolError('previous commitment must be 64 lowercase hex characters')
  }

  const block = parseCanonicalBlock(blockRlpHex)
  const header = block.header
  return {
    format: EVM_SETTLEMENT_FORMAT,
    version: EVM_SETTLEMENT_VERSION,
    chainId: EVM_CHAIN_ID.toString(10),
    profileId: LOCAL_CHAIN_PROFILE,
    hardfork: String(EVM_HARDFORK),
    height: header.number.toString(10),
    blockRlpHex,
    blockHash: bytesToHex(block.hash()),
    parentHash: bytesToHex(header.parentHash),
    stateRoot: bytesToHex(header.stateRoot),
    transactionsRoot: bytesToHex(header.transactionsTrie),
    receiptsRoot: bytesToHex(header.receiptTrie),
    previousCommitment,
  }
}

export function createEvmSettlementEnvelope(
  blockRlpHex: string,
  previousCommitment = ZERO_COMMITMENT,
): EvmSettlementEnvelope {
  const fields = deriveEnvelopeFields(blockRlpHex, previousCommitment)
  return { ...fields, commitmentHash: calculateCommitment(fields) }
}

/**
 * Checks envelope integrity and caller-supplied chain linkage.
 * This is not an independent execution proof or BTCS L1 settlement proof.
 */
export function verifyEvmSettlementEnvelope(
  value: unknown,
  expectedPreviousCommitment: string,
  expectedParentHash: string,
): EvmSettlementEnvelope {
  if (!COMMITMENT_RE.test(expectedPreviousCommitment)) {
    throw new ProtocolError('expected previous commitment is malformed')
  }
  if (!HASH_RE.test(expectedParentHash)) {
    throw new ProtocolError('expected parent hash must be a 32-byte lowercase 0x-prefixed hash')
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('settlement envelope must be an object')
  }

  const record = value as Record<string, unknown>
  const keys = Object.keys(record)
  if (
    keys.length !== ENVELOPE_KEYS.length ||
    ENVELOPE_KEYS.some((key) => !Object.hasOwn(record, key)) ||
    keys.some((key) => !(ENVELOPE_KEYS as readonly string[]).includes(key))
  ) {
    throw new ProtocolError('settlement envelope has missing or unknown fields')
  }

  for (const key of ENVELOPE_KEYS) {
    if (typeof record[key] !== 'string') {
      throw new ProtocolError(`settlement envelope field ${key} must be a string`)
    }
  }

  const envelope = record as unknown as EvmSettlementEnvelope
  if (
    envelope.format !== EVM_SETTLEMENT_FORMAT ||
    envelope.version !== EVM_SETTLEMENT_VERSION
  ) {
    throw new ProtocolError('unsupported EVM settlement format or version')
  }
  if (
    envelope.chainId !== EVM_CHAIN_ID.toString(10) ||
    envelope.profileId !== LOCAL_CHAIN_PROFILE ||
    envelope.hardfork !== String(EVM_HARDFORK)
  ) {
    throw new ProtocolError('settlement envelope uses the wrong chain or EVM profile')
  }
  if (!/^(0|[1-9][0-9]*)$/.test(envelope.height)) {
    throw new ProtocolError('block height is not a canonical decimal integer')
  }

  for (const key of [
    'blockHash', 'parentHash', 'stateRoot', 'transactionsRoot', 'receiptsRoot',
  ] as const) {
    if (!HASH_RE.test(envelope[key])) {
      throw new ProtocolError(`${key} must be a 32-byte lowercase 0x-prefixed hash`)
    }
  }
  if (!COMMITMENT_RE.test(envelope.previousCommitment)) {
    throw new ProtocolError('previous commitment is malformed')
  }
  if (envelope.previousCommitment !== expectedPreviousCommitment) {
    throw new ProtocolError('previous settlement commitment does not match')
  }
  if (envelope.parentHash !== expectedParentHash) {
    throw new ProtocolError('block parent hash does not match expected ancestry')
  }

  const derived = deriveEnvelopeFields(
    envelope.blockRlpHex,
    envelope.previousCommitment,
  )
  for (const key of [
    'height', 'blockHash', 'parentHash', 'stateRoot', 'transactionsRoot', 'receiptsRoot',
  ] as const) {
    if (envelope[key] !== derived[key]) {
      throw new ProtocolError(`envelope ${key} does not match canonical block data`)
    }
  }
  if (!COMMITMENT_RE.test(envelope.commitmentHash)) {
    throw new ProtocolError('commitment hash is malformed')
  }
  if (calculateCommitment(derived) !== envelope.commitmentHash) {
    throw new ProtocolError('settlement commitment hash mismatch')
  }
  return envelope
}
