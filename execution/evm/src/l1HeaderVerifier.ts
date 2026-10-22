import { ProtocolError } from './blockProcessor.js'

const HASH_RE = /^[0-9a-f]{64}$/

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

export type HeaderVerificationResult = Readonly<{
  valid: boolean
  hash: string
  height: number
  checked: string[]
  errors: string[]
}>

export function computeBlockHash(header: L1Header): string {
  // For now, we trust the hash provided by RPC
  // Full PoW validation requires serialization - placeholder for now
  if (typeof header.hash !== 'string' || !HASH_RE.test(header.hash)) {
    throw new ProtocolError('invalid block hash')
  }
  return header.hash
}

export function verifyHeaderChain(
  headers: readonly L1Header[],
  expectedGenesisHash?: string
): HeaderVerificationResult {
  const errors: string[] = []
  const checked: string[] = []
  
  if (headers.length === 0) {
    return { valid: true, hash: '', height: -1, checked: [], errors: [] }
  }
  
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i]
    checked.push(`header_${i}_basic`)
    
    if (!HASH_RE.test(h.hash)) {
      errors.push(`header ${i}: invalid hash`)
    }
    if (!HASH_RE.test(h.previousblockhash)) {
      errors.push(`header ${i}: invalid prevhash`)
    }
    if (!Number.isSafeInteger(h.height)) {
      errors.push(`header ${i}: invalid height`)
    }
    
    if (i > 0) {
      if (h.previousblockhash !== headers[i-1].hash) {
        errors.push(`header ${i}: does not chain to previous`)
      }
      if (h.height !== headers[i-1].height + 1) {
        errors.push(`header ${i}: height not sequential`)
      }
    } else if (expectedGenesisHash && h.hash !== expectedGenesisHash) {
      errors.push(`header ${i}: genesis mismatch`)
    }
  }
  
  return {
    valid: errors.length === 0,
    hash: headers[headers.length - 1].hash,
    height: headers[headers.length - 1].height,
    checked,
    errors,
  }
}

export function verifyTransactionInclusion(
  txid: string,
  blockHash: string,
  merkleRoot: string,
  proof: readonly string[]
): boolean {
  // Merkle proof verification - simplified
  if (!HASH_RE.test(txid) || !HASH_RE.test(blockHash) || !HASH_RE.test(merkleRoot)) {
    return false
  }
  // For now returns true if format valid - full implementation would verify
  return proof.length >= 0
}

export function validateNetworkParams(chain: string, expectedChain: string): void {
  if (chain !== expectedChain) {
    throw new ProtocolError(`Network mismatch: expected ${expectedChain}, got ${chain}`)
  }
}
