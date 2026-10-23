import { createHash } from 'node:crypto'
import { ProtocolError } from './blockProcessor.js'

const HASH_RE = /^[0-9a-f]{64}$/
const HEX_RE = /^[0-9a-f]*$/
const MAX_PROOF_BYTES = 4 * 1024 * 1024
const MAX_TRANSACTIONS = 1_000_000
const MAX_TREE_HEIGHT = 32

export type L1Header = Readonly<{
  hash: string
  version?: number
  previousblockhash: string
  merkle_root?: string
  merkleroot?: string
  time?: number
  bits?: string
  nonce?: number
  height: number
  confirmations?: number
}>

export type HeaderVerificationOptions = Readonly<{
  /**
   * Derive the header hash from its serialized fields and enforce proof of
   * work. The default structural mode is retained for callers that only have
   * chain-link metadata.
   */
  strict?: boolean
}>

export type HeaderVerificationResult = Readonly<{
  valid: boolean
  hash: string
  height: number
  checked: string[]
  errors: string[]
}>

export type BtcsL1TxOutProofReport = Readonly<{
  format: 'btcs-l2-btcs-l1-txoutproof'
  version: 1
  verificationModel: 'pow-merkle-proof'
  blockHash: string
  previousBlockHash: string
  merkleRoot: string
  transactionCount: number
  matchedTxids: readonly string[]
  proofVerified: true
}>

function sha256d(data: Uint8Array): Buffer {
  return createHash('sha256')
    .update(createHash('sha256').update(data).digest())
    .digest()
}

function reverseHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).reverse().toString('hex')
}

function hexToInternalHash(value: string, label: string): Buffer {
  if (!HASH_RE.test(value)) {
    throw new ProtocolError(`${label} must be 64 lowercase hex characters`)
  }
  return Buffer.from(value, 'hex').reverse()
}

/**
 * Serialize a BTCS L1 (Bitcoin-style 80-byte) header and derive its hash
 * locally. This never returns an RPC-supplied hash as if it were computed.
 */
export function computeBlockHash(header: L1Header): string {
  if (
    !Number.isSafeInteger(header.version) ||
    (header.version as number) < -0x80000000 ||
    (header.version as number) > 0x7fffffff
  ) {
    throw new ProtocolError('header has an invalid version')
  }
  const merkle = header.merkleroot ?? header.merkle_root
  if (typeof merkle !== 'string') {
    throw new ProtocolError('header has no merkle root')
  }
  if (
    !Number.isSafeInteger(header.time) ||
    (header.time as number) < 0 ||
    (header.time as number) > 0xffffffff ||
    !Number.isSafeInteger(header.nonce) ||
    (header.nonce as number) < 0 ||
    (header.nonce as number) > 0xffffffff
  ) {
    throw new ProtocolError('header has an invalid time or nonce')
  }
  if (typeof header.bits !== 'string' || !/^[0-9a-f]{8}$/.test(header.bits)) {
    throw new ProtocolError('header has invalid compact difficulty bits')
  }

  const raw = Buffer.alloc(80)
  raw.writeInt32LE(header.version as number, 0)
  hexToInternalHash(header.previousblockhash, 'previous block hash').copy(raw, 4)
  hexToInternalHash(merkle, 'merkle root').copy(raw, 36)
  raw.writeUInt32LE(header.time as number, 68)
  raw.writeUInt32LE(Number.parseInt(header.bits, 16), 72)
  raw.writeUInt32LE(header.nonce as number, 76)
  return reverseHex(sha256d(raw))
}

function compactToTarget(bits: number): bigint {
  const exponent = (bits >>> 24) & 0xff
  const mantissa = bits & 0x007fffff
  if ((bits & 0x00800000) !== 0 || mantissa === 0) {
    throw new ProtocolError('compact difficulty encodes a negative or zero target')
  }
  if (exponent > 34) {
    throw new ProtocolError('compact difficulty exponent is out of range')
  }
  if (exponent <= 3) {
    return BigInt(mantissa) >> BigInt(8 * (3 - exponent))
  }
  return BigInt(mantissa) << BigInt(8 * (exponent - 3))
}

function verifyProofOfWork(hash: string, bits: string): void {
  const numericHash = BigInt(`0x${hash}`)
  const target = compactToTarget(Number.parseInt(bits, 16))
  if (numericHash > target) {
    throw new ProtocolError('header hash does not satisfy its proof-of-work target')
  }
}

export function verifyHeaderChain(
  headers: readonly L1Header[],
  expectedGenesisHash?: string,
  options: HeaderVerificationOptions = {},
): HeaderVerificationResult {
  const errors: string[] = []
  const checked: string[] = []
  const strict = options.strict === true

  if (headers.length === 0) {
    return { valid: true, hash: '', height: -1, checked: [], errors: [] }
  }

  let previousComputedHash: string | undefined
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]
    checked.push(`header_${i}_basic`)

    if (!HASH_RE.test(header.hash)) {
      errors.push(`header ${i}: invalid hash`)
    }
    if (!HASH_RE.test(header.previousblockhash)) {
      errors.push(`header ${i}: invalid prevhash`)
    }
    if (!Number.isSafeInteger(header.height)) {
      errors.push(`header ${i}: invalid height`)
    }

    let computedHash: string | undefined
    if (strict) {
      checked.push(`header_${i}_serialized_hash`)
      try {
        computedHash = computeBlockHash(header)
        if (computedHash !== header.hash) {
          errors.push(`header ${i}: hash does not match serialized header fields`)
        }
        verifyProofOfWork(computedHash, header.bits as string)
        checked.push(`header_${i}_proof_of_work`)
      } catch (error) {
        errors.push(
          `header ${i}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    if (i > 0) {
      const previousHash = previousComputedHash ?? headers[i - 1].hash
      if (header.previousblockhash !== previousHash) {
        errors.push(`header ${i}: does not chain to previous`)
      }
      if (header.height !== headers[i - 1].height + 1) {
        errors.push(`header ${i}: height not sequential`)
      }
    } else if (expectedGenesisHash && header.hash !== expectedGenesisHash) {
      errors.push(`header ${i}: genesis mismatch`)
    }
    previousComputedHash = computedHash
  }

  return {
    valid: errors.length === 0,
    hash: headers[headers.length - 1].hash,
    height: headers[headers.length - 1].height,
    checked,
    errors,
  }
}

type PartialHeader = Readonly<{
  raw: Buffer
  previousBlockHash: string
  merkleRootInternal: Buffer
  merkleRoot: string
  bits: string
  blockHash: string
}>

function parseHeader(raw: Buffer): PartialHeader {
  if (raw.byteLength !== 80) {
    throw new ProtocolError('transaction proof header must be exactly 80 bytes')
  }
  const blockHash = reverseHex(sha256d(raw))
  const bits = raw.readUInt32LE(72).toString(16).padStart(8, '0')
  verifyProofOfWork(blockHash, bits)
  return {
    raw,
    previousBlockHash: reverseHex(raw.subarray(4, 36)),
    merkleRootInternal: Buffer.from(raw.subarray(36, 68)),
    merkleRoot: reverseHex(raw.subarray(36, 68)),
    bits,
    blockHash,
  }
}

function readCompactSize(buffer: Buffer, offset: number): readonly [number, number] {
  if (offset >= buffer.length) {
    throw new ProtocolError('transaction proof is truncated')
  }
  const first = buffer[offset]
  if (first < 0xfd) {
    return [first, offset + 1]
  }
  if (first === 0xfd) {
    if (offset + 3 > buffer.length) {
      throw new ProtocolError('transaction proof is truncated')
    }
    return [buffer.readUInt16LE(offset + 1), offset + 3]
  }
  if (first === 0xfe) {
    if (offset + 5 > buffer.length) {
      throw new ProtocolError('transaction proof is truncated')
    }
    return [buffer.readUInt32LE(offset + 1), offset + 5]
  }
  if (offset + 9 > buffer.length) {
    throw new ProtocolError('transaction proof is truncated')
  }
  const large = buffer.readBigUInt64LE(offset + 1)
  if (large > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new ProtocolError('transaction proof contains an oversized length')
  }
  return [Number(large), offset + 9]
}

function calcTreeWidth(transactionCount: number, height: number): number {
  return Math.floor((transactionCount + 2 ** height - 1) / 2 ** height)
}

function bytesToBits(bytes: Buffer): boolean[] {
  const bits: boolean[] = []
  for (const byte of bytes) {
    for (let bit = 0; bit < 8; bit++) {
      bits.push((byte & (1 << bit)) !== 0)
    }
  }
  return bits
}

/**
 * Verify a BTCS Core `gettxoutproof` response without trusting the RPC's
 * boolean. The proof commits to the block header and a partial Merkle tree.
 * This verifies the header hash, proof of work, Merkle root, and requested
 * txid. It does not by itself establish that the header is on the most-work
 * chain or that the block is final (SG-01 residual).
 */
export function verifyBtcsL1TxOutProof(
  proofHex: unknown,
  expectedBlockHash: string,
  expectedTxid: string,
): BtcsL1TxOutProofReport {
  if (typeof proofHex !== 'string' || proofHex.length === 0 || !HEX_RE.test(proofHex)) {
    throw new ProtocolError('transaction proof must be non-empty lowercase hex')
  }
  if (proofHex.length % 2 !== 0) {
    throw new ProtocolError('transaction proof has an odd number of hex digits')
  }
  if (!HASH_RE.test(expectedBlockHash) || !HASH_RE.test(expectedTxid)) {
    throw new ProtocolError('expected block hash and txid must be 64 lowercase hex characters')
  }

  const buffer = Buffer.from(proofHex, 'hex')
  if (buffer.byteLength > MAX_PROOF_BYTES) {
    throw new ProtocolError('transaction proof exceeds the size limit')
  }
  if (buffer.byteLength < 80 + 4 + 2) {
    throw new ProtocolError('transaction proof is too short')
  }

  const header = parseHeader(buffer.subarray(0, 80))
  if (header.blockHash !== expectedBlockHash) {
    throw new ProtocolError('transaction proof header does not match the expected block hash')
  }

  let offset = 80
  const transactionCount = buffer.readUInt32LE(offset)
  offset += 4
  if (transactionCount === 0 || transactionCount > MAX_TRANSACTIONS) {
    throw new ProtocolError('transaction proof has an invalid transaction count')
  }

  let hashCount: number
  ;[hashCount, offset] = readCompactSize(buffer, offset)
  if (hashCount === 0 || hashCount > transactionCount || hashCount > 100_000) {
    throw new ProtocolError('transaction proof has an invalid hash count')
  }
  if (offset + hashCount * 32 > buffer.length) {
    throw new ProtocolError('transaction proof is truncated in its hashes')
  }
  const hashes: Buffer[] = []
  for (let i = 0; i < hashCount; i++) {
    hashes.push(Buffer.from(buffer.subarray(offset, offset + 32)))
    offset += 32
  }

  let flagsLength: number
  ;[flagsLength, offset] = readCompactSize(buffer, offset)
  if (flagsLength === 0 || flagsLength > MAX_PROOF_BYTES || offset + flagsLength > buffer.length) {
    throw new ProtocolError('transaction proof has invalid or truncated flags')
  }
  const bits = bytesToBits(buffer.subarray(offset, offset + flagsLength))
  offset += flagsLength
  if (offset !== buffer.length) {
    throw new ProtocolError('transaction proof has trailing bytes')
  }

  let bitsUsed = 0
  let hashesUsed = 0
  const matched: string[] = []
  let bad = false

  const hashPair = (left: Buffer, right: Buffer): Buffer =>
    sha256d(Buffer.concat([left, right]))

  const extract = (height: number, position: number): Buffer => {
    if (height > MAX_TREE_HEIGHT) {
      bad = true
      return Buffer.alloc(32)
    }
    if (bitsUsed >= bits.length) {
      bad = true
      return Buffer.alloc(32)
    }
    const parentOfMatch = bits[bitsUsed++]
    if (height === 0 || !parentOfMatch) {
      if (hashesUsed >= hashes.length) {
        bad = true
        return Buffer.alloc(32)
      }
      const hash = hashes[hashesUsed++]
      if (height === 0 && parentOfMatch) {
        matched.push(reverseHex(hash))
      }
      return hash
    }

    const left = extract(height - 1, position * 2)
    let right: Buffer
    if (position * 2 + 1 < calcTreeWidth(transactionCount, height - 1)) {
      right = extract(height - 1, position * 2 + 1)
      if (right.equals(left)) {
        bad = true
      }
    } else {
      right = left
    }
    return hashPair(left, right)
  }

  let height = 0
  while (calcTreeWidth(transactionCount, height) > 1) {
    height++
    if (height > MAX_TREE_HEIGHT) {
      throw new ProtocolError('transaction proof tree is too deep')
    }
  }

  const root = extract(height, 0)
  if (bad) {
    throw new ProtocolError('transaction proof contains an invalid partial Merkle tree')
  }
  if (Math.ceil(bitsUsed / 8) !== flagsLength) {
    throw new ProtocolError('transaction proof did not consume all flag bits')
  }
  if (hashesUsed !== hashes.length) {
    throw new ProtocolError('transaction proof did not consume all hashes')
  }
  if (!root.equals(header.merkleRootInternal)) {
    throw new ProtocolError('transaction proof Merkle root does not match the header')
  }
  if (!matched.includes(expectedTxid)) {
    throw new ProtocolError('transaction proof does not commit to the expected txid')
  }

  return {
    format: 'btcs-l2-btcs-l1-txoutproof',
    version: 1,
    verificationModel: 'pow-merkle-proof',
    blockHash: header.blockHash,
    previousBlockHash: header.previousBlockHash,
    merkleRoot: header.merkleRoot,
    transactionCount,
    matchedTxids: Object.freeze([...matched]),
    proofVerified: true,
  }
}

/**
 * Deprecated format-only helper. It cannot verify a Merkle branch without the
 * leaf index and header, so it fails closed. Use `verifyBtcsL1TxOutProof`.
 */
export function verifyTransactionInclusion(
  txid: string,
  blockHash: string,
  merkleRoot: string,
  proof: readonly string[],
): boolean {
  if (!HASH_RE.test(txid) || !HASH_RE.test(blockHash) || !HASH_RE.test(merkleRoot)) {
    return false
  }
  throw new ProtocolError(
    'BTCS transaction inclusion verification requires a header and partial Merkle proof; use verifyBtcsL1TxOutProof',
  )
}

export function validateNetworkParams(chain: string, expectedChain: string): void {
  if (chain !== expectedChain) {
    throw new ProtocolError(`Network mismatch: expected ${expectedChain}, got ${chain}`)
  }
}

/*============================================================================
  BTCS L1 best-chain selection — independent local chain selection
============================================================================*/

export type ChainConsensusParams = Readonly<{
  network: string
  powLimit: bigint
  retargetInterval: number
  targetTimespan: number
  targetSpacing: number
  maxRetargetFactor: number
  maxFutureTime: number
}>

export const DEFAULT_CHAIN_PARAMS: ChainConsensusParams = Object.freeze({
  network: 'regtest',
  powLimit: BigInt(0x7fffff) << BigInt(232),
  retargetInterval: 2016,
  targetTimespan: 14 * 24 * 60 * 60,
  targetSpacing: 600,
  maxRetargetFactor: 4,
  maxFutureTime: 2 * 60 * 60,
})

export type Checkpoint = Readonly<{
  network: string
  height: number
  hash: string
  bits: string
  time: number
  chainwork: bigint
}>

export type HeaderChainEntry = Readonly<{
  header: L1Header
  target: bigint
  chainwork: bigint
}>

export type BestChainTip = Readonly<{
  entry: HeaderChainEntry
  height: number
  chainwork: bigint
}>

export type ChainSelectionResult = Readonly<{
  tip: HeaderChainEntry | null
  height: number
  chainwork: bigint
  complete: boolean
  errors: string[]
}>

export type LocalVerificationModel =
  | 'local-best-chain+local-inclusion-proof'
  | 'local-best-chain-only'
  | 'incomplete'

export function computeChainwork(target: bigint): bigint {
  if (target < 0n) {
    throw new ProtocolError('proof-of-work target must be non-negative')
  }
  const twoPow256 = BigInt(1) << BigInt(256)
  return twoPow256 / (target + 1n)
}

export function encodeCompact(target: bigint): string {
  if (target <= 0n) {
    throw new ProtocolError('target must be positive for compact encoding')
  }
  const hex = target.toString(16)
  const padded = hex.length % 2 === 1 ? `0${hex}` : hex
  const bytes = Buffer.from(padded, 'hex')
  let start = 0
  while (start < bytes.length - 1 && bytes[start] === 0) start++
  const magnitude = bytes.subarray(start)
  const size = magnitude.length

  if (size <= 3) {
    const mantissa = Buffer.alloc(3, 0)
    magnitude.copy(mantissa, 3 - magnitude.length)
    const bits = (3 << 24) | (mantissa[0] << 16) | (mantissa[1] << 8) | mantissa[2]
    return bits.toString(16).padStart(8, '0')
  }
  const exponent = size
  const mantissa = Buffer.from([magnitude[0], magnitude[1], magnitude[2]])
  const bits =
    (exponent << 24) |
    (mantissa[0] << 16) |
    (mantissa[1] << 8) |
    mantissa[2]
  return bits.toString(16).padStart(8, '0')
}

export function computeNextTarget(
  prevTarget: bigint,
  prevTime: number,
  firstTime: number,
  params: ChainConsensusParams,
): bigint | null {
  const actualTimespan = BigInt(prevTime - firstTime)
  let targetTimespan = BigInt(params.targetTimespan)
  const lowerBound = targetTimespan / BigInt(params.maxRetargetFactor)
  const upperBound = targetTimespan * BigInt(params.maxRetargetFactor)
  let adjustedTimespan = actualTimespan
  if (adjustedTimespan < lowerBound) adjustedTimespan = lowerBound
  if (adjustedTimespan > upperBound) adjustedTimespan = upperBound
  const newTarget = (prevTarget * adjustedTimespan) / targetTimespan
  if (newTarget > params.powLimit) {
    return params.powLimit
  }
  return newTarget
}

export function medianTimePast(timestamps: readonly number[]): number | null {
  if (timestamps.length < 11) {
    return null
  }
  const sorted = [...timestamps].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

export function validateCheckpoint(
  checkpoint: Checkpoint,
  params: ChainConsensusParams,
): void {
  if (!HASH_RE.test(checkpoint.hash)) {
    throw new ProtocolError('checkpoint hash must be 64 lowercase hex characters')
  }
  if (!Number.isSafeInteger(checkpoint.height) || checkpoint.height < 0) {
    throw new ProtocolError('checkpoint height must be a non-negative safe integer')
  }
  if (
    !Number.isSafeInteger(checkpoint.time) ||
    checkpoint.time < 0 ||
    checkpoint.time > 0xffffffff
  ) {
    throw new ProtocolError('checkpoint time must be a valid Unix timestamp')
  }
  if (typeof checkpoint.bits !== 'string' || !/^[0-9a-f]{8}$/.test(checkpoint.bits)) {
    throw new ProtocolError('checkpoint has invalid compact difficulty bits')
  }
  if (checkpoint.chainwork <= 0n) {
    throw new ProtocolError('checkpoint chainwork must be positive')
  }
  if (checkpoint.network !== params.network) {
    throw new ProtocolError(
      `Checkpoint network '${checkpoint.network}' does not match configured network '${params.network}'`,
    )
  }
  const target = compactToTarget(Number.parseInt(checkpoint.bits, 16))
  if (target > params.powLimit) {
    throw new ProtocolError('checkpoint target exceeds the proof-of-work limit')
  }
}

export class BestChainSelector {
  private readonly params: ChainConsensusParams
  private readonly checkpoint: Checkpoint
  private readonly headersByHash: Map<string, HeaderChainEntry> = new Map()
  private readonly childrenByHash: Map<string, string[]> = new Map()
  private bestTip: HeaderChainEntry | null = null
  private incomplete = false

  constructor(checkpoint: Checkpoint, params: ChainConsensusParams = DEFAULT_CHAIN_PARAMS) {
    validateCheckpoint(checkpoint, params)
    this.checkpoint = checkpoint
    this.params = params

    const checkpointTarget = compactToTarget(Number.parseInt(checkpoint.bits, 16))
    const checkpointEntry: HeaderChainEntry = {
      header: {
        hash: checkpoint.hash,
        previousblockhash: '0'.repeat(64),
        merkleroot: '0'.repeat(64),
        time: checkpoint.time,
        bits: checkpoint.bits,
        nonce: 0,
        height: checkpoint.height,
      },
      target: checkpointTarget,
      chainwork: checkpoint.chainwork,
    }
    this.headersByHash.set(checkpoint.hash, checkpointEntry)
    this.bestTip = checkpointEntry
  }

  addHeader(header: L1Header): boolean {
    const hash = header.hash
    if (!HASH_RE.test(hash)) {
      throw new ProtocolError('candidate header has an invalid hash')
    }
    if (this.headersByHash.has(hash)) {
      return true
    }

    const parentHash = header.previousblockhash
    if (!HASH_RE.test(parentHash)) {
      throw new ProtocolError('candidate header has an invalid previous block hash')
    }
    if (!Number.isSafeInteger(header.height) || header.height < 0) {
      throw new ProtocolError('candidate header has an invalid height')
    }
    if (
      typeof header.time !== 'number' ||
      !Number.isSafeInteger(header.time) ||
      header.time < 0 ||
      header.time > 0xffffffff
    ) {
      throw new ProtocolError('candidate header has an invalid time')
    }
    if (
      typeof header.bits !== 'string' ||
      !/^[0-9a-f]{8}$/.test(header.bits)
    ) {
      throw new ProtocolError('candidate header has invalid compact difficulty bits')
    }

    if (hash === this.checkpoint.hash) {
      return true
    }

    const parentEntry = this.headersByHash.get(parentHash)
    if (parentEntry === undefined) {
      throw new ProtocolError(
        `candidate header ${hash} does not connect to a validated ancestor`,
      )
    }

    if (header.height !== parentEntry.header.height + 1) {
      throw new ProtocolError(
        `candidate header ${hash} height ${header.height} does not follow parent height ${parentEntry.header.height}`,
      )
    }

    let computedHash: string
    try {
      computedHash = computeBlockHash(header)
    } catch (error) {
      throw new ProtocolError(
        `candidate header ${hash} failed serialization: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    if (computedHash !== hash) {
      throw new ProtocolError(
        `candidate header ${hash} hash does not match serialized fields`,
      )
    }

    const target = compactToTarget(Number.parseInt(header.bits, 16))
    if (target <= 0n) {
      throw new ProtocolError('candidate header target is zero or negative')
    }
    if (target > this.params.powLimit) {
      throw new ProtocolError('candidate header target exceeds proof-of-work limit')
    }

    const numericHash = BigInt(`0x${hash}`)
    if (numericHash > target) {
      throw new ProtocolError('candidate header hash does not satisfy its proof-of-work target')
    }

    let expectedTarget: bigint | null = null
    const height = header.height
    const isRetargetPoint = height % this.params.retargetInterval === 0

    if (isRetargetPoint) {
      const ancestor = this.getAncestorAt(header, height - this.params.retargetInterval)
      if (ancestor !== null) {
        const firstOfPeriod = this.getAncestorAt(header, height - this.params.retargetInterval + 1)
        expectedTarget = computeNextTarget(
          ancestor.target,
          ancestor.header.time as number,
          (firstOfPeriod?.header.time ?? ancestor.header.time) as number,
          this.params,
        )
      } else {
        this.incomplete = true
      }
    } else {
      expectedTarget = parentEntry.target
    }

    if (expectedTarget !== null && target !== expectedTarget) {
      throw new ProtocolError(
        `candidate header ${hash} nBits ${header.bits} does not match expected difficulty target`,
      )
    }

    if (height >= 10) {
      const timestamps = this.getAncestorTimestamps(header, 11)
      if (timestamps.length === 11) {
        const mtp = medianTimePast(timestamps)
        if (mtp !== null && (header.time as number) <= mtp) {
          throw new ProtocolError(
            `candidate header ${hash} time ${header.time} is not greater than median-time-past ${mtp}`,
          )
        }
      } else {
        this.incomplete = true
      }
    }

    const now = Math.floor(Date.now() / 1000)
    if ((header.time as number) > now + this.params.maxFutureTime) {
      throw new ProtocolError(
        `candidate header ${hash} time is more than ${this.params.maxFutureTime} seconds in the future`,
      )
    }

    const headerWork = computeChainwork(target)
    const chainwork = parentEntry.chainwork + headerWork

    const entry: HeaderChainEntry = { header, target, chainwork }
    this.headersByHash.set(hash, entry)

    const children = this.childrenByHash.get(parentHash) ?? []
    if (!children.includes(hash)) {
      children.push(hash)
      this.childrenByHash.set(parentHash, children)
    }

    if (this.bestTip === null || chainwork > this.bestTip.chainwork) {
      this.bestTip = entry
    } else if (chainwork === this.bestTip.chainwork) {
      if (hash < this.bestTip.header.hash) {
        this.bestTip = entry
      }
    }

    return true
  }

  getSelectedTip(): HeaderChainEntry | null {
    return this.bestTip
  }

  getChainHeight(): number {
    return this.bestTip?.header.height ?? this.checkpoint.height
  }

  getChainwork(): bigint {
    return this.bestTip?.chainwork ?? this.checkpoint.chainwork
  }

  isOnSelectedChain(blockHash: string): boolean {
    if (!HASH_RE.test(blockHash)) {
      return false
    }
    const entry = this.headersByHash.get(blockHash)
    if (entry === undefined) {
      return false
    }
    return this.isAncestorOfTip(entry)
  }

  isComplete(): boolean {
    return !this.incomplete
  }

  private isAncestorOfTip(entry: HeaderChainEntry): boolean {
    let current: HeaderChainEntry | null = this.bestTip
    const visited = new Set<string>()
    while (current !== null && !visited.has(current.header.hash)) {
      visited.add(current.header.hash)
      if (current.header.hash === entry.header.hash) {
        return true
      }
      const parent = this.headersByHash.get(current.header.previousblockhash)
      current = parent ?? null
    }
    return false
  }

  private getAncestorAt(
    header: L1Header,
    targetHeight: number,
  ): HeaderChainEntry | null {
    if (targetHeight < this.checkpoint.height) {
      return null
    }
    let current: HeaderChainEntry | undefined = this.headersByHash.get(
      header.hash,
    )
    while (current !== undefined && current.header.height > targetHeight) {
      current = this.headersByHash.get(current.header.previousblockhash)
    }
    return current !== undefined && current.header.height === targetHeight
      ? current
      : null
  }

  private getAncestorTimestamps(
    header: L1Header,
    count: number,
  ): number[] {
    const timestamps: number[] = []
    let current: HeaderChainEntry | undefined = this.headersByHash.get(
      header.hash,
    )
    while (current !== undefined && timestamps.length < count) {
      timestamps.push(current.header.time as number)
      current = this.headersByHash.get(current.header.previousblockhash)
    }
    return timestamps.reverse()
  }
}

/**
 * Create a checkpoint from a validated L1 header.
 *
 * @param header - validated checkpoint header
 * @param chainwork - accumulated chainwork at this checkpoint
 * @param params - consensus parameters
 * @returns a Checkpoint object
 */
export function createCheckpoint(
  header: L1Header,
  chainwork: bigint,
  params: ChainConsensusParams,
): Checkpoint {
  if (chainwork <= 0n) {
    throw new ProtocolError('checkpoint chainwork must be positive')
  }
  if (!HASH_RE.test(header.hash)) {
    throw new ProtocolError('checkpoint header hash must be 64 lowercase hex characters')
  }
  if (typeof header.bits !== 'string' || !/^[0-9a-f]{8}$/.test(header.bits)) {
    throw new ProtocolError('checkpoint header has invalid compact difficulty bits')
  }
  if (typeof header.time !== 'number') {
    throw new ProtocolError('checkpoint header has an invalid time')
  }
  const target = compactToTarget(Number.parseInt(header.bits, 16))
  if (target > params.powLimit) {
    throw new ProtocolError('checkpoint target exceeds the proof-of-work limit')
  }
  return {
    network: params.network,
    height: header.height,
    hash: header.hash,
    bits: header.bits,
    time: header.time,
    chainwork,
  }
}
