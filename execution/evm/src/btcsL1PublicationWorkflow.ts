import { ProtocolError } from './blockProcessor.js'
import {
  verifyBtcsL1AnchorConfirmation,
  type BtcsL1ConfirmationRpc,
} from './btcsL1Confirmation.js'
import {
  observeBtcsL1Publication,
  reobserveBtcsL1Publication,
  type BtcsL1PublicationRecord,
} from './btcsL1Publication.js'

/**
 * Verify an existing transaction's active-chain inclusion and anchor before
 * advancing the local publication lifecycle.
 *
 * The caller must supply the candidate block hash. This function does not
 * discover transactions, persist records, create transactions, sign, broadcast,
 * or independently validate consensus beyond the trusted BTCS Core RPC model.
 *
 * A failed RPC or verification leaves the supplied immutable record unchanged.
 * Do not invalidate a record merely because the RPC is temporarily unavailable.
 */
export async function verifyAndAdvanceBtcsL1Publication(
  rpc: BtcsL1ConfirmationRpc,
  record: BtcsL1PublicationRecord,
  blockHash: string,
): Promise<BtcsL1PublicationRecord> {
  if (
    record.state !== 'submitted' &&
    record.state !== 'observed' &&
    record.state !== 'confirmed' &&
    record.state !== 'invalidated'
  ) {
    throw new ProtocolError(
      'publication must be submitted, observed, confirmed, or invalidated before verification',
    )
  }
  if (record.txid === undefined) {
    throw new ProtocolError('publication has no transaction ID to verify')
  }

  // Ask the verifier to establish canonical inclusion with at least one
  // confirmation; the lifecycle applies its own configured confirmation target.
  const report = await verifyBtcsL1AnchorConfirmation(rpc, {
    txid: record.txid,
    blockHash,
    batchHash: record.batchHash,
    requiredConfirmations: 1,
  })

  if (
    report.format !== 'btcs-l2-btcs-l1-confirmation' ||
    report.version !== 1 ||
    report.verificationModel !== 'trusted-btcs-core-rpc' ||
    report.txid !== record.txid ||
    report.blockHash !== blockHash ||
    report.batchHash !== record.batchHash ||
    report.activeChain !== true ||
    report.anchorVerified !== true ||
    !Number.isSafeInteger(report.blockHeight) ||
    report.blockHeight < 0 ||
    !Number.isSafeInteger(report.confirmations) ||
    report.confirmations < 1
  ) {
    throw new ProtocolError(
      'BTCS L1 confirmation report does not match the publication record',
    )
  }

  if (record.state === 'invalidated') {
    return reobserveBtcsL1Publication(
      record,
      report.blockHash,
      report.blockHeight,
      report.confirmations,
    )
  }

  return observeBtcsL1Publication(
    record,
    report.blockHash,
    report.blockHeight,
    report.confirmations,
  )
}
