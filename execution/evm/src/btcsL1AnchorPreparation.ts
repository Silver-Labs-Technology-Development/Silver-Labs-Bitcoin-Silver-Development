import { ProtocolError } from './blockProcessor.js'
import {
  encodeBtcsL1AnchorPayload,
  encodeBtcsL1AnchorScript,
} from './btcsL1Anchor.js'
import { verifyEvmSettlementBatchExecution } from './settlementBatchReplay.js'

export const BTCS_L1_ANCHOR_PREPARATION_FORMAT =
  'btcs-l2-l1-anchor-preparation'

export type BtcsL1AnchorPreparation = Readonly<{
  format: typeof BTCS_L1_ANCHOR_PREPARATION_FORMAT
  version: 1
  batchHash: string
  startHeight: string
  endHeight: string
  blocksVerified: number
  childBlocksReexecuted: number
  executionVerified: true
  dataHex: string
  scriptPubKeyHex: string
}>

/**
 * Prepare an L1 anchor only after the existing verifier has validated the
 * batch structure and independently re-executed its EVM block sequence.
 *
 * This prototype verifier currently requires a batch starting at genesis.
 * This function prepares bytes for transaction creation; it does not create,
 * sign, broadcast, confirm, or prove inclusion of a BTCS L1 transaction.
 */
export async function prepareBtcsL1AnchorForBatch(
  value: unknown,
  expectedPreviousCommitment: string,
  expectedParentHash: string,
  expectedStartHeight: string,
): Promise<BtcsL1AnchorPreparation> {
  const report = await verifyEvmSettlementBatchExecution(
    value,
    expectedPreviousCommitment,
    expectedParentHash,
    expectedStartHeight,
  )

  if (
    report.executionVerified !== true ||
    !/^[0-9a-f]{64}$/.test(report.batchHash) ||
    report.blocksVerified < 1
  ) {
    throw new ProtocolError('batch did not pass the required execution verification')
  }

  return {
    format: BTCS_L1_ANCHOR_PREPARATION_FORMAT,
    version: 1,
    batchHash: report.batchHash,
    startHeight: report.startHeight,
    endHeight: report.endHeight,
    blocksVerified: report.blocksVerified,
    childBlocksReexecuted: report.childBlocksReexecuted,
    executionVerified: true,
    // Pass dataHex as the "data" output to a BTCS Core transaction RPC.
    dataHex: encodeBtcsL1AnchorPayload(report.batchHash),
    scriptPubKeyHex: encodeBtcsL1AnchorScript(report.batchHash),
  }
}
