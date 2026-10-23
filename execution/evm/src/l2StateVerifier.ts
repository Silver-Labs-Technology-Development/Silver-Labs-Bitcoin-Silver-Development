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

/**
 * Replays and independently re-executes the full canonical chain through the
 * block processor, which validates headers, transactions, receipts, execution
 * outcomes, and state roots. This does not prove BTCS L1 publication, data
 * availability, finality, or settlement.
 */
export async function replayAndVerify(
  chain: PersistentBlockProcessor,
  fromHeight: bigint = 0n,
  toHeight?: bigint
): Promise<ReplayVerificationResult> {
  const errors: string[] = []
  const checked: string[] = [
    'load_canonical_chain',
    'verify_genesis',
    'reexecute_canonical_blocks',
    'verify_receipts_and_state_roots',
  ]

  try {
    if (fromHeight < 0n || (toHeight !== undefined && toHeight < fromHeight)) {
      throw new ProtocolError('invalid replay height range')
    }
    const report = await chain.replay()
    const tip = report.tip
    if (fromHeight > tip.number) {
      throw new ProtocolError('replay start height is above the canonical tip')
    }
    const requestedEnd = toHeight === undefined || toHeight > tip.number
      ? tip.number
      : toHeight
    if (requestedEnd > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ProtocolError('replay height exceeds the supported range')
    }
    const summary = report.blocks[Number(requestedEnd)]
    if (summary === undefined) {
      throw new ProtocolError('replay did not produce the requested block summary')
    }
    return {
      valid: true,
      height: requestedEnd,
      stateRoot: summary.stateRoot,
      checked,
      errors,
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error))
    return {
      valid: false,
      height: 0n,
      stateRoot: '',
      checked,
      errors,
    }
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
