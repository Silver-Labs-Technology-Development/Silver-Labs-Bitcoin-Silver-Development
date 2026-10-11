import { ProtocolError } from './blockProcessor.js'
import {
  verifyBtcsL1Deposit,
  type BtcsL1DepositRequest,
  type BtcsL1DepositRpc,
} from './btcsL1Deposit.js'
import {
  BtcsL1DepositStore,
  type BtcsL1DepositRecord,
} from './btcsL1DepositStore.js'

/**
 * Verify a candidate L1 deposit with the trusted Core RPC and durably record
 * its state. Repeated calls are safe for an unchanged confirmed inclusion.
 *
 * This workflow does not credit EVM balances. Deposit crediting must be tied
 * to deterministic L2 state transitions and a separate reorg/reconciliation
 * design; a registry entry alone is not proof of a safe bridge.
 */
export async function verifyAndRecordBtcsL1Deposit(
  rpc: BtcsL1DepositRpc,
  store: BtcsL1DepositStore,
  request: BtcsL1DepositRequest,
): Promise<BtcsL1DepositRecord> {
  const report = await verifyBtcsL1Deposit(rpc, request)
  let current = store.get(report.depositId)

  if (current === undefined) {
    try {
      return await store.recordVerifiedDeposit(report, request.requiredConfirmations)
    } catch (error) {
      // Two callers may verify the same deposit concurrently. If another
      // caller won the atomic insert, reload and follow the normal transition.
      // If no record exists, preserve the original persistence/validation error.
      current = store.get(report.depositId)
      if (current === undefined) throw error
    }
  }

  if (current.state === 'invalidated') {
    return store.reobserve(report)
  }

  return store.updateConfirmations(report)
}

/**
 * Persist an inclusion invalidation after the caller independently established
 * that the old inclusion left the canonical BTCS chain. Never call this just
 * because RPC timed out or temporarily failed.
 */
export async function invalidateBtcsL1DepositAfterConfirmedReorg(
  store: BtcsL1DepositStore,
  depositId: string,
  expectedPreviousBlockHash: string,
): Promise<BtcsL1DepositRecord> {
  const current = store.get(depositId)
  if (current === undefined) {
    throw new ProtocolError('deposit does not exist for this transaction output')
  }
  if (current.state !== 'confirmed') {
    throw new ProtocolError('only a confirmed deposit can be invalidated after a reorg')
  }
  if (current.blockHash !== expectedPreviousBlockHash) {
    throw new ProtocolError('deposit inclusion changed before invalidation')
  }

  return store.invalidate(depositId, expectedPreviousBlockHash)
}
