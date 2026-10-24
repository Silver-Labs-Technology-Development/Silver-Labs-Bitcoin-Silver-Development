import { createHash } from 'node:crypto'
import { ProtocolError } from './blockProcessor.js'
import type { BtcsL1DepositRecord } from './btcsL1DepositStore.js'

export const EVM_DEPOSIT_OPERATION_FORMAT = 'btcs-l2-evm-deposit-operation'
export const EVM_DEPOSIT_OPERATION_VERSION = 1
export const MAX_DEPOSIT_OPERATIONS_PER_BLOCK = 256

const HASH_RE = /^[0-9a-f]{64}$/
const ADDRESS_RE = /^0x[0-9a-f]{40}$/
const UINT_RE = /^(0|[1-9][0-9]*)$/
const POSITIVE_UINT_RE = /^[1-9][0-9]*$/
/** 1 L1 satoshi credits this many L2 native wei. 1 BTCS = 10^8 satoshis = 10^18 wei. */
export const SATOSHI_TO_WEI = 10n ** 10n
const MAX_UINT256 = (1n << 256n) - 1n
const MAX_SAFE_HEIGHT = BigInt(Number.MAX_SAFE_INTEGER)

export type EvmDepositOperation = Readonly<{
  format: typeof EVM_DEPOSIT_OPERATION_FORMAT
  version: typeof EVM_DEPOSIT_OPERATION_VERSION
  depositId: string
  txid: string
  outputIndex: number
  sourceBlockHash: string
  sourceBlockHeight: string
  recipientAddress: string
  amountSats: string
  amountWei: string
}>

const OPERATION_KEYS = [
  'format',
  'version',
  'depositId',
  'txid',
  'outputIndex',
  'sourceBlockHash',
  'sourceBlockHeight',
  'recipientAddress',
  'amountSats',
  'amountWei',
] as const

/**
 * Create the canonical operation from a currently confirmed deposit record.
 * The record is produced by the trusted-Core-RPC prototype workflow; this
 * function does not itself provide a cryptographic L1 inclusion proof.
 */
export function createEvmDepositOperation(
  record: BtcsL1DepositRecord,
): EvmDepositOperation {
  if (
    record.state !== 'confirmed' ||
    record.blockHash === undefined ||
    record.blockHeight === undefined ||
    record.confirmations === undefined ||
    record.confirmations < record.requiredConfirmations
  ) {
    throw new ProtocolError('only a sufficiently confirmed deposit can become an L2 operation')
  }

  return normalizeEvmDepositOperations([{
    format: EVM_DEPOSIT_OPERATION_FORMAT,
    version: EVM_DEPOSIT_OPERATION_VERSION,
    depositId: record.depositId,
    txid: record.txid,
    outputIndex: record.depositOutputIndex,
    sourceBlockHash: record.blockHash,
    sourceBlockHeight: String(record.blockHeight),
    recipientAddress: record.recipientAddress,
    amountSats: record.amountSats,
    amountWei: (BigInt(record.amountSats) * SATOSHI_TO_WEI).toString(10),
  }])[0]!
}

/**
 * Validate the exact operation schema and enforce canonical ascending
 * depositId order. Callers must not silently sort data during verification.
 */
export function normalizeEvmDepositOperations(
  value: unknown,
): readonly EvmDepositOperation[] {
  if (!Array.isArray(value) || value.length > MAX_DEPOSIT_OPERATIONS_PER_BLOCK) {
    throw new ProtocolError('deposit operations must be an array within the per-block limit')
  }

  const operations: EvmDepositOperation[] = []
  let previousDepositId: string | undefined

  for (const item of value) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ProtocolError('deposit operation must be an object')
    }

    const candidate = item as Record<string, unknown>
    const keys = Object.keys(candidate)
    if (
      keys.length !== OPERATION_KEYS.length ||
      OPERATION_KEYS.some((key) => !Object.hasOwn(candidate, key)) ||
      keys.some((key) => !(OPERATION_KEYS as readonly string[]).includes(key))
    ) {
      throw new ProtocolError('deposit operation has missing or unsupported fields')
    }

    if (
      candidate.format !== EVM_DEPOSIT_OPERATION_FORMAT ||
      candidate.version !== EVM_DEPOSIT_OPERATION_VERSION
    ) {
      throw new ProtocolError('unsupported deposit operation format or version')
    }

    if (
      typeof candidate.txid !== 'string' ||
      !HASH_RE.test(candidate.txid) ||
      typeof candidate.sourceBlockHash !== 'string' ||
      !HASH_RE.test(candidate.sourceBlockHash)
    ) {
      throw new ProtocolError('deposit operation has an invalid L1 transaction or block hash')
    }

    if (
      !Number.isSafeInteger(candidate.outputIndex) ||
      (candidate.outputIndex as number) < 0
    ) {
      throw new ProtocolError('deposit operation has an invalid output index')
    }

    const depositId = `${candidate.txid}:${candidate.outputIndex}`
    if (candidate.depositId !== depositId) {
      throw new ProtocolError('deposit operation ID does not match its transaction output')
    }
    if (
      previousDepositId !== undefined &&
      depositId <= previousDepositId
    ) {
      throw new ProtocolError('deposit operations must be uniquely ordered by deposit ID')
    }
    previousDepositId = depositId

    if (
      typeof candidate.sourceBlockHeight !== 'string' ||
      !UINT_RE.test(candidate.sourceBlockHeight) ||
      BigInt(candidate.sourceBlockHeight) > MAX_SAFE_HEIGHT
    ) {
      throw new ProtocolError('deposit operation has an invalid L1 block height')
    }

    if (
      typeof candidate.recipientAddress !== 'string' ||
      !ADDRESS_RE.test(candidate.recipientAddress) ||
      candidate.recipientAddress !== candidate.recipientAddress.toLowerCase()
    ) {
      throw new ProtocolError('deposit operation recipient must be a lowercase EVM address')
    }

    if (
      typeof candidate.amountSats !== 'string' ||
      !POSITIVE_UINT_RE.test(candidate.amountSats) ||
      candidate.amountSats.length > 78
    ) {
      throw new ProtocolError('deposit operation has an invalid satoshi amount')
    }

    const expectedWei = BigInt(candidate.amountSats) * SATOSHI_TO_WEI
    if (expectedWei > MAX_UINT256) {
      throw new ProtocolError('deposit amount exceeds the EVM uint256 balance range')
    }
    if (
      typeof candidate.amountWei !== 'string' ||
      !POSITIVE_UINT_RE.test(candidate.amountWei) ||
      candidate.amountWei !== expectedWei.toString(10)
    ) {
      throw new ProtocolError('deposit operation satoshi-to-wei conversion is incorrect')
    }

    operations.push({
      format: EVM_DEPOSIT_OPERATION_FORMAT,
      version: EVM_DEPOSIT_OPERATION_VERSION,
      depositId,
      txid: candidate.txid,
      outputIndex: candidate.outputIndex as number,
      sourceBlockHash: candidate.sourceBlockHash,
      sourceBlockHeight: candidate.sourceBlockHeight,
      recipientAddress: candidate.recipientAddress,
      amountSats: candidate.amountSats,
      amountWei: candidate.amountWei,
    })
  }

  return operations
}

function canonicalOperation(operation: EvmDepositOperation): string {
  return [
    `deposit_id=${operation.depositId}`,
    `txid=${operation.txid}`,
    `output_index=${operation.outputIndex}`,
    `source_block_hash=${operation.sourceBlockHash}`,
    `source_block_height=${operation.sourceBlockHeight}`,
    `recipient=${operation.recipientAddress}`,
    `amount_sats=${operation.amountSats}`,
    `amount_wei=${operation.amountWei}`,
  ].join('\n')
}

/** Returns undefined for an empty prelude, otherwise a lowercase SHA-256 digest. */
export function calculateEvmDepositPreludeCommitment(value: unknown): string | undefined {
  const operations = normalizeEvmDepositOperations(value)
  if (operations.length === 0) return undefined

  const canonical = [
    'BTCSL2-DEPOSIT-PRELUDE|v1',
    ...operations.map(canonicalOperation),
  ].join('\n--\n')

  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

/**
 * Ethereum header extraData is empty when there are no deposits, or contains
 * exactly the 32-byte SHA-256 commitment when a deposit prelude is present.
 */
export function encodeEvmDepositPreludeExtraData(value: unknown): Uint8Array {
  const commitment = calculateEvmDepositPreludeCommitment(value)
  return commitment === undefined
    ? new Uint8Array()
    : new Uint8Array(Buffer.from(commitment, 'hex'))
}

/** Verify the operation data against the block-header extraData commitment. */
export function verifyEvmDepositPrelude(
  value: unknown,
  extraData: Uint8Array,
): readonly EvmDepositOperation[] {
  if (!(extraData instanceof Uint8Array)) {
    throw new ProtocolError('block extraData must be bytes')
  }

  const operations = normalizeEvmDepositOperations(value)
  const expected = calculateEvmDepositPreludeCommitment(operations)

  if (expected === undefined) {
    if (extraData.length !== 0) {
      throw new ProtocolError('block has deposit commitment data but no deposit operations')
    }
    return operations
  }

  if (extraData.length !== 32) {
    throw new ProtocolError('deposit prelude requires a 32-byte block-header commitment')
  }

  const actual = Buffer.from(extraData).toString('hex')
  if (actual !== expected) {
    throw new ProtocolError('deposit operations do not match the block-header commitment')
  }

  return operations
}
