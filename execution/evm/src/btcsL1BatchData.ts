import { ProtocolError } from './blockProcessor.js'
import {
  verifyEvmSettlementBatch,
  type EvmSettlementBatch,
} from './settlementBatch.js'
import type { SettlementBatchAnchors } from './settlementBatchFile.js'

export const BTCS_L1_BATCH_DATA_FORMAT = 'btcs-l2-l1-batch-data-fragment'
export const BTCS_L1_BATCH_DATA_VERSION = 1
export const BTCS_L1_BATCH_DATA_MAGIC_HEX = '42544344' // BTCD
export const BTCS_L1_BATCH_DATA_CHUNK_BYTES = 35
export const MAX_BTCS_L1_BATCH_DATA_BYTES = 16 * 1024
export const MAX_BTCS_L1_BATCH_DATA_FRAGMENTS = Math.ceil(
  MAX_BTCS_L1_BATCH_DATA_BYTES / BTCS_L1_BATCH_DATA_CHUNK_BYTES,
)
export const MAX_BTCS_L1_BATCH_DATA_SCAN_BLOCKS = 10_000
export const MAX_BTCS_L1_BATCH_DATA_SCAN_OUTPUTS = 100_000

// magic(4) + version(1) + batch hash(32) + index(2) + count(2) + total bytes(4)
const HEADER_BYTES = 45
const MAX_OP_RETURN_SCRIPT_BYTES = 83
const HASH_RE = /^[0-9a-f]{64}$/

export type BtcsL1BatchDataFragment = Readonly<{
  format: typeof BTCS_L1_BATCH_DATA_FORMAT
  version: typeof BTCS_L1_BATCH_DATA_VERSION
  batchHash: string
  index: number
  count: number
  totalBytes: number
  chunkHex: string
  /** Payload bytes suitable for `createrawtransaction`'s `data` output. */
  dataHex: string
  scriptPubKeyHex: string
}>

export type EncodedBtcsL1BatchData = Readonly<{
  batchHash: string
  serializedBatch: Buffer
  fragments: readonly BtcsL1BatchDataFragment[]
}>

export type ReconstructedBtcsL1BatchData = Readonly<{
  batch: EvmSettlementBatch
  serializedBatch: Buffer
  fragmentCount: number
}>

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(label + ' must be an object')
  }
  return value as Record<string, unknown>
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (typeof value !== 'object' || value === null) return value
  const object = value as Record<string, unknown>
  return Object.fromEntries(
    Object.keys(object).sort().map((key) => [key, stableJsonValue(object[key])]),
  )
}

function serializeCanonicalBatch(batch: EvmSettlementBatch): Buffer {
  return Buffer.from(JSON.stringify(stableJsonValue(batch)), 'utf8')
}

function encodeOpReturnScript(payload: Buffer): string {
  if (payload.byteLength < 1 || payload.byteLength > 80) {
    throw new ProtocolError('batch data fragment payload must fit the 80-byte Core data-carrier limit')
  }
  const lengthHex = payload.byteLength.toString(16).padStart(2, '0')
  const push = payload.byteLength <= 75 ? lengthHex : '4c' + lengthHex
  const script = '6a' + push + payload.toString('hex')
  if (script.length / 2 > MAX_OP_RETURN_SCRIPT_BYTES) {
    throw new ProtocolError('batch data fragment exceeds the standard OP_RETURN script limit')
  }
  return script
}

function makeFragment(
  batchHash: string,
  index: number,
  count: number,
  totalBytes: number,
  chunk: Buffer,
): BtcsL1BatchDataFragment {
  const header = Buffer.alloc(HEADER_BYTES)
  Buffer.from(BTCS_L1_BATCH_DATA_MAGIC_HEX, 'hex').copy(header, 0)
  header.writeUInt8(BTCS_L1_BATCH_DATA_VERSION, 4)
  Buffer.from(batchHash, 'hex').copy(header, 5)
  header.writeUInt16BE(index, 37)
  header.writeUInt16BE(count, 39)
  header.writeUInt32BE(totalBytes, 41)
  const payload = Buffer.concat([header, chunk])
  return {
    format: BTCS_L1_BATCH_DATA_FORMAT,
    version: BTCS_L1_BATCH_DATA_VERSION,
    batchHash,
    index,
    count,
    totalBytes,
    chunkHex: chunk.toString('hex'),
    dataHex: payload.toString('hex'),
    scriptPubKeyHex: encodeOpReturnScript(payload),
  }
}

/**
 * Verify a settlement batch and encode its deterministic JSON as bounded
 * OP_RETURN fragments. The existing batch hash is repeated in every fragment.
 * This prepares data outputs only; it does not sign or broadcast transactions.
 */
export function encodeBtcsL1BatchData(
  batchValue: unknown,
  anchors: SettlementBatchAnchors,
): EncodedBtcsL1BatchData {
  const batch = verifyEvmSettlementBatch(
    batchValue,
    anchors.previousCommitment,
    anchors.parentHash,
    anchors.startHeight,
  )
  const serializedBatch = serializeCanonicalBatch(batch)
  if (serializedBatch.byteLength === 0 || serializedBatch.byteLength > MAX_BTCS_L1_BATCH_DATA_BYTES) {
    throw new ProtocolError(
      `serialized settlement batch must be between 1 and ${MAX_BTCS_L1_BATCH_DATA_BYTES} bytes for L1 publication`,
    )
  }
  const count = Math.ceil(serializedBatch.byteLength / BTCS_L1_BATCH_DATA_CHUNK_BYTES)
  if (count > MAX_BTCS_L1_BATCH_DATA_FRAGMENTS || count > 0xffff) {
    throw new ProtocolError('settlement batch requires too many L1 data fragments')
  }
  const fragments: BtcsL1BatchDataFragment[] = []
  for (let index = 0; index < count; index += 1) {
    const start = index * BTCS_L1_BATCH_DATA_CHUNK_BYTES
    const chunk = serializedBatch.subarray(start, start + BTCS_L1_BATCH_DATA_CHUNK_BYTES)
    fragments.push(makeFragment(batch.batchHash, index, count, serializedBatch.byteLength, chunk))
  }
  return { batchHash: batch.batchHash, serializedBatch, fragments }
}

function readOpReturnPayload(scriptPubKeyHex: string): Buffer | undefined {
  if (
    typeof scriptPubKeyHex !== 'string' ||
    !/^(?:[0-9a-f]{2})+$/.test(scriptPubKeyHex) ||
    !scriptPubKeyHex.startsWith('6a')
  ) {
    return undefined
  }
  const opcode = Number.parseInt(scriptPubKeyHex.slice(2, 4), 16)
  let length: number
  let dataStart: number
  if (opcode === 0x4c) {
    if (scriptPubKeyHex.length < 8) return undefined
    length = Number.parseInt(scriptPubKeyHex.slice(4, 6), 16)
    if (length <= 75) return undefined
    dataStart = 6
  } else if (opcode <= 75) {
    length = opcode
    if (length === 0) return undefined
    dataStart = 4
  } else {
    return undefined
  }
  if (length > 80 || scriptPubKeyHex.length !== (dataStart + length * 2)) {
    return undefined
  }
  const scriptBytes = Buffer.from(scriptPubKeyHex, 'hex')
  if (scriptBytes.byteLength > MAX_OP_RETURN_SCRIPT_BYTES) return undefined
  return Buffer.from(scriptPubKeyHex.slice(dataStart), 'hex')
}

/** Return undefined for unrelated OP_RETURN outputs; reject malformed fragments for this format. */
export function decodeBtcsL1BatchDataScript(
  scriptPubKeyHex: string,
): BtcsL1BatchDataFragment | undefined {
  const payload = readOpReturnPayload(scriptPubKeyHex)
  if (payload === undefined || payload.length < 4 || payload.subarray(0, 4).toString('hex') !== BTCS_L1_BATCH_DATA_MAGIC_HEX) {
    return undefined
  }
  if (payload.length < HEADER_BYTES) {
    throw new ProtocolError('BTCS L1 batch data fragment header is truncated')
  }
  const version = payload.readUInt8(4)
  const batchHash = payload.subarray(5, 37).toString('hex')
  const index = payload.readUInt16BE(37)
  const count = payload.readUInt16BE(39)
  const totalBytes = payload.readUInt32BE(41)
  const chunk = payload.subarray(HEADER_BYTES)
  if (version !== BTCS_L1_BATCH_DATA_VERSION) {
    throw new ProtocolError('unsupported BTCS L1 batch data fragment version')
  }
  if (!HASH_RE.test(batchHash)) {
    throw new ProtocolError('BTCS L1 batch data fragment has an invalid batch hash')
  }
  if (
    totalBytes < 1 || totalBytes > MAX_BTCS_L1_BATCH_DATA_BYTES ||
    count < 1 || count !== Math.ceil(totalBytes / BTCS_L1_BATCH_DATA_CHUNK_BYTES) ||
    index >= count
  ) {
    throw new ProtocolError('BTCS L1 batch data fragment has invalid bounds')
  }
  const expectedChunkBytes = index + 1 < count
    ? BTCS_L1_BATCH_DATA_CHUNK_BYTES
    : totalBytes - index * BTCS_L1_BATCH_DATA_CHUNK_BYTES
  if (chunk.byteLength !== expectedChunkBytes) {
    throw new ProtocolError('BTCS L1 batch data fragment has an invalid chunk length')
  }
  return {
    format: BTCS_L1_BATCH_DATA_FORMAT,
    version: BTCS_L1_BATCH_DATA_VERSION,
    batchHash,
    index,
    count,
    totalBytes,
    chunkHex: chunk.toString('hex'),
    dataHex: payload.toString('hex'),
    scriptPubKeyHex,
  }
}

/**
 * Reassemble fragments collected from active-chain Core blocks and independently
 * verify both canonical bytes and the settlement batch hash against trusted
 * starting anchors. Unconfirmed/off-chain fragments must not be passed here.
 */
export function reconstructEvmSettlementBatchFromScripts(
  scripts: readonly string[],
  expectedBatchHash: string,
  anchors: SettlementBatchAnchors,
): ReconstructedBtcsL1BatchData {
  if (!HASH_RE.test(expectedBatchHash)) {
    throw new ProtocolError('expected batch hash must be 64 lowercase hex characters')
  }
  if (scripts.length > MAX_BTCS_L1_BATCH_DATA_SCAN_OUTPUTS) {
    throw new ProtocolError('batch data reconstruction input exceeds the output scan limit')
  }

  let expectedCount: number | undefined
  let expectedBytes: number | undefined
  const chunks = new Map<number, Buffer>()
  for (const script of scripts) {
    const fragment = decodeBtcsL1BatchDataScript(script)
    if (fragment === undefined || fragment.batchHash !== expectedBatchHash) continue
    if (
      (expectedCount !== undefined && fragment.count !== expectedCount) ||
      (expectedBytes !== undefined && fragment.totalBytes !== expectedBytes)
    ) {
      throw new ProtocolError('batch data fragments disagree on batch length or fragment count')
    }
    expectedCount = fragment.count
    expectedBytes = fragment.totalBytes
    if (chunks.has(fragment.index)) {
      throw new ProtocolError('duplicate BTCS L1 batch data fragment index')
    }
    chunks.set(fragment.index, Buffer.from(fragment.chunkHex, 'hex'))
  }
  if (expectedCount === undefined || expectedBytes === undefined) {
    throw new ProtocolError('no matching confirmed BTCS L1 batch data fragments were found')
  }
  if (chunks.size !== expectedCount) {
    throw new ProtocolError('BTCS L1 batch data is incomplete')
  }

  const orderedChunks: Buffer[] = []
  for (let index = 0; index < expectedCount; index += 1) {
    const chunk = chunks.get(index)
    if (chunk === undefined) throw new ProtocolError('BTCS L1 batch data is missing a fragment index')
    orderedChunks.push(chunk)
  }
  const serializedBatch = Buffer.concat(orderedChunks)
  if (serializedBatch.byteLength !== expectedBytes) {
    throw new ProtocolError('reconstructed BTCS L1 batch data has the wrong byte length')
  }

  let parsed: unknown
  let contents: string
  try {
    contents = serializedBatch.toString('utf8')
    parsed = JSON.parse(contents) as unknown
  } catch {
    throw new ProtocolError('reconstructed BTCS L1 batch data is not valid UTF-8 JSON')
  }
  if (canonicalJson(parsed) !== contents) {
    throw new ProtocolError('reconstructed BTCS L1 batch data is not canonical JSON')
  }
  const batch = verifyEvmSettlementBatch(
    parsed,
    anchors.previousCommitment,
    anchors.parentHash,
    anchors.startHeight,
  )
  if (batch.batchHash !== expectedBatchHash) {
    throw new ProtocolError('reconstructed settlement batch does not match its L1 commitment')
  }
  return { batch, serializedBatch, fragmentCount: expectedCount }
}

function canonicalJson(value: unknown): string {
  try {
    return JSON.stringify(stableJsonValue(value))
  } catch {
    throw new ProtocolError('reconstructed BTCS L1 batch data cannot be canonicalized')
  }
}

/** Extract OP_RETURN outputs from verbosity-2 Core blocks returned by getblock. */
export function extractBtcsL1BatchDataScriptsFromCoreBlocks(
  blocks: readonly unknown[],
): readonly string[] {
  if (blocks.length > MAX_BTCS_L1_BATCH_DATA_SCAN_BLOCKS) {
    throw new ProtocolError('batch data block scan exceeds its height limit')
  }
  const scripts: string[] = []
  let outputCount = 0
  for (const blockValue of blocks) {
    const block = asRecord(blockValue, 'Core block')
    if (!Array.isArray(block.tx)) throw new ProtocolError('Core block has no transaction array')
    for (const transactionValue of block.tx) {
      const transaction = asRecord(transactionValue, 'Core block transaction')
      if (!Array.isArray(transaction.vout)) {
        throw new ProtocolError('Core block transaction has no output array')
      }
      for (const outputValue of transaction.vout) {
        outputCount += 1
        if (outputCount > MAX_BTCS_L1_BATCH_DATA_SCAN_OUTPUTS) {
          throw new ProtocolError('batch data block scan exceeds its output limit')
        }
        const output = asRecord(outputValue, 'Core transaction output')
        const script = asRecord(output.scriptPubKey, 'Core output script')
        if (typeof script.hex === 'string' && script.hex.startsWith('6a')) {
          scripts.push(script.hex)
        }
      }
    }
  }
  return scripts
}

/** Reconstruct only after the caller fetched blocks by active-chain hash and confirmation policy. */
export function reconstructEvmSettlementBatchFromCoreBlocks(
  blocks: readonly unknown[],
  expectedBatchHash: string,
  anchors: SettlementBatchAnchors,
): ReconstructedBtcsL1BatchData {
  return reconstructEvmSettlementBatchFromScripts(
    extractBtcsL1BatchDataScriptsFromCoreBlocks(blocks),
    expectedBatchHash,
    anchors,
  )
}
