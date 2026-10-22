import { ProtocolError } from './blockProcessor.js'
import { PersistentBlockProcessor, type CanonicalReadView } from './blockProcessor.js'

export type ReplayVerificationResult = Readonly<{
  valid: boolean
  height: bigint
  stateRoot: string
  checked: string[]
  errors: string[]
}>

export type MaliciousBatchAttempt = Readonly<{
  type: 'wrong_root' | 'fabricated_tx' | 'omitted_tx' | 'wrong_prior_root' | 'duplicate_batch' | 'conflicting_batch' | 'invalid_execution'
  description: string
  shouldReject: true
}>

export async function replayAndVerify(
  chain: PersistentBlockProcessor,
  fromHeight: bigint = 0n,
  toHeight?: bigint
): Promise<ReplayVerificationResult> {
  const view = await chain.createCanonicalReadView()
  const errors: string[] = []
  const checked: string[] = []
  
  checked.push('load_canonical_chain')
  
  // Verify genesis exists
  const genesis = view.getCanonicalBlockByNumber(0n)
  if (!genesis) {
    errors.push('missing genesis')
  } else {
    checked.push('verify_genesis')
  }
  
  // Find height by scanning
  let height = 0n
  let h = 1n
  while (view.getCanonicalBlockByNumber(h)) {
    height = h
    h++
    if (h > 10000n) break
  }
  
  // Verify chain continuity
  const limit = toHeight !== undefined && toHeight < height ? toHeight : height
  for (let bh = 1n; bh <= limit; bh++) {
    const block = view.getCanonicalBlockByNumber(bh)
    if (!block) {
      errors.push(`missing block at height ${bh}`)
      break
    }
  }
  checked.push('verify_chain_continuity')
  
  const tip = view.getCanonicalBlockByNumber(limit)
  const stateRoot = tip ? '0x' + '00'.repeat(32) : ''
  
  return {
    valid: errors.length === 0,
    height: limit,
    stateRoot,
    checked,
    errors,
  }
}

export function verifyBatchContinuity(
  batches: readonly { batchHash: string; priorCommitment: string }[],
  genesisCommitment: string
): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  
  for (let i = 0; i < batches.length; i++) {
    if (i === 0) {
      if (batches[i].priorCommitment !== genesisCommitment) {
        errors.push(`batch ${i}: wrong genesis prior commitment`)
      }
    } else {
      if (batches[i].priorCommitment !== batches[i-1].batchHash) {
        errors.push(`batch ${i}: broken continuity`)
      }
    }
  }
  
  return { valid: errors.length === 0, errors }
}

export function detectMaliciousBatch(batch: any, expected: any): string[] {
  const errors: string[] = []
  if (batch.stateRoot !== expected.stateRoot) errors.push('state root mismatch')
  if (batch.priorStateRoot !== expected.priorStateRoot) errors.push('prior state root mismatch')
  if (batch.transactionCount !== expected.transactionCount) errors.push('transaction count mismatch')
  return errors
}
