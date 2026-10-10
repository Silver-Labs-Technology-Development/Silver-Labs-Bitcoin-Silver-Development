import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hexToBytes } from '@ethereumjs/util'
import {
  PersistentBlockProcessor,
  ProtocolError,
} from './blockProcessor.js'
import {
  verifyEvmSettlementBatch,
  type EvmSettlementBatch,
} from './settlementBatch.js'

export type EvmSettlementReplayReport = Readonly<{
  format: 'btcs-l2-evm-settlement-replay-report'
  version: 'v1'
  startHeight: string
  endHeight: string
  blocksVerified: number
  childBlocksReexecuted: number
  batchHash: string
  executionVerified: true
}>

/**
 * Independently re-executes a genesis-starting batch in a disposable local
 * chain. This is a prototype verifier for the pinned local EVM profile; it
 * does not prove BTCS L1 publication, settlement, or finality.
 */
export async function verifyEvmSettlementBatchExecution(
  value: unknown,
  expectedPreviousCommitment: string,
  expectedParentHash: string,
  expectedStartHeight: string,
): Promise<EvmSettlementReplayReport> {
  const batch: EvmSettlementBatch = verifyEvmSettlementBatch(
    value,
    expectedPreviousCommitment,
    expectedParentHash,
    expectedStartHeight,
  )

  if (batch.startHeight !== '0') {
    throw new ProtocolError(
      'independent replay currently requires a batch starting at genesis height 0',
    )
  }

  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-independent-replay-'))
  try {
    const processor = await PersistentBlockProcessor.open(directory)
    let blocksVerified = 0
    let childBlocksReexecuted = 0

    for (const envelope of batch.envelopes) {
      const height = BigInt(envelope.height)

      if (height === 0n) {
        const genesis = await processor.getCanonicalBlockByNumber(0n)
        if (genesis === undefined) {
          throw new ProtocolError('fresh replay chain is missing its fixed genesis')
        }
        if (genesis.blockRlpHex !== envelope.blockRlpHex) {
          throw new ProtocolError('batch genesis does not match the fixed local genesis')
        }
        assertEnvelopeMatchesSummary(envelope, genesis.summary)
        blocksVerified += 1
        continue
      }

      const processed = await processor.acceptBlock(
        hexToBytes(envelope.blockRlpHex as `0x${string}`),
      )
      if (processed.blockRlpHex !== envelope.blockRlpHex) {
        throw new ProtocolError(`re-executed block ${envelope.height} bytes do not match`)
      }
      assertEnvelopeMatchesSummary(envelope, processed.summary)
      blocksVerified += 1
      childBlocksReexecuted += 1
    }

    if (processor.tip.number.toString(10) !== batch.endHeight) {
      throw new ProtocolError('replayed canonical tip does not match the batch end height')
    }

    return {
      format: 'btcs-l2-evm-settlement-replay-report',
      version: 'v1',
      startHeight: batch.startHeight,
      endHeight: batch.endHeight,
      blocksVerified,
      childBlocksReexecuted,
      batchHash: batch.batchHash,
      executionVerified: true,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function assertEnvelopeMatchesSummary(
  envelope: EvmSettlementBatch['envelopes'][number],
  summary: {
    number: string
    hash: string
    parentHash: string
    stateRoot: string
    transactionsRoot: string
    receiptsRoot: string
  },
): void {
  if (
    summary.number !== envelope.height ||
    summary.hash !== envelope.blockHash ||
    summary.parentHash !== envelope.parentHash ||
    summary.stateRoot !== envelope.stateRoot ||
    summary.transactionsRoot !== envelope.transactionsRoot ||
    summary.receiptsRoot !== envelope.receiptsRoot
  ) {
    throw new ProtocolError(
      `re-executed block ${envelope.height} summary does not match its settlement envelope`,
    )
  }
}
