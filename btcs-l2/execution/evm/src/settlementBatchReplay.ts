import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hexToBytes } from '@ethereumjs/util'
import {
  LOCAL_CHAIN_PROFILE,
  PersistentBlockProcessor,
  ProtocolError,
  createIsolatedReplayDepositBackingProvider,
  reexecuteFromVerifiedCheckpoint,
  type CanonicalReadView,
} from './blockProcessor.js'
import { createHarnessCommon } from './config.js'
import { recoverStateCheckpoint } from './stateCheckpointRecovery.js'
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

export type EvmSettlementCheckpointReplayReport =
  EvmSettlementReplayReport & Readonly<{
    checkpointHeight: string
    checkpointAncestryBlocksLoaded: number
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
    const processor = await PersistentBlockProcessor.open(directory, {
      depositBackingProvider: createIsolatedReplayDepositBackingProvider(
        batch.envelopes.flatMap((envelope) => envelope.depositOperations),
      ),
    })
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
        envelope.depositOperations,
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


/**
 * Re-executes a non-genesis settlement batch from a recovered checkpoint.
 *
 * The checkpoint must match the supplied replay-verified canonical view, and
 * its block must be the direct parent of the batch's first block. The caller
 * supplies the previous commitment as an external anchor; this function does
 * not prove BTCS L1 publication, settlement, finality, or anchor authenticity.
 */
export async function verifyEvmSettlementBatchExecutionFromCheckpoint(
  value: unknown,
  expectedPreviousCommitment: string,
  expectedParentHash: string,
  expectedStartHeight: string,
  checkpointDirectory: string,
  canonicalView: CanonicalReadView,
): Promise<EvmSettlementCheckpointReplayReport> {
  const batch: EvmSettlementBatch = verifyEvmSettlementBatch(
    value,
    expectedPreviousCommitment,
    expectedParentHash,
    expectedStartHeight,
  )

  if (BigInt(batch.startHeight) === 0n) {
    throw new ProtocolError('checkpoint continuation cannot start at genesis height 0')
  }

  const localCommon = createHarnessCommon()
  if (
    batch.profileId !== LOCAL_CHAIN_PROFILE ||
    batch.chainId !== localCommon.chainId().toString(10) ||
    batch.hardfork !== localCommon.hardfork()
  ) {
    throw new ProtocolError('settlement batch metadata does not match the pinned local EVM profile')
  }

  const recovered = await recoverStateCheckpoint(
    checkpointDirectory,
    canonicalView,
    LOCAL_CHAIN_PROFILE,
  )

  try {
    const checkpointHeight = BigInt(recovered.manifest.blockHeight)
    if (checkpointHeight + 1n !== BigInt(batch.startHeight)) {
      throw new ProtocolError(
        'checkpoint height must be exactly one block before the batch start',
      )
    }

    if (
      recovered.manifest.blockHash.toLowerCase() !== expectedParentHash.toLowerCase()
    ) {
      throw new ProtocolError(
        'checkpoint block hash does not match the expected batch parent hash',
      )
    }

    const replay = await reexecuteFromVerifiedCheckpoint(
      canonicalView,
      recovered.stateManager,
      recovered.manifest,
      batch.envelopes.map((envelope) => envelope.blockRlpHex),
      batch.envelopes.map((envelope) => envelope.depositOperations),
    )

    if (replay.blocks.length !== batch.envelopes.length) {
      throw new ProtocolError('checkpoint replay returned an unexpected block count')
    }

    for (let index = 0; index < batch.envelopes.length; index += 1) {
      const envelope = batch.envelopes[index]
      const processed = replay.blocks[index]

      if (envelope === undefined || processed === undefined) {
        throw new ProtocolError('checkpoint replay block sequence is incomplete')
      }
      if (processed.blockRlpHex !== envelope.blockRlpHex) {
        throw new ProtocolError(
          `checkpoint-reexecuted block ${envelope.height} bytes do not match`,
        )
      }
      assertEnvelopeMatchesSummary(envelope, processed.summary)
    }

    return {
      format: 'btcs-l2-evm-settlement-replay-report',
      version: 'v1',
      startHeight: batch.startHeight,
      endHeight: batch.endHeight,
      blocksVerified: batch.envelopes.length,
      childBlocksReexecuted: batch.envelopes.length,
      batchHash: batch.batchHash,
      executionVerified: true,
      checkpointHeight: recovered.manifest.blockHeight,
      checkpointAncestryBlocksLoaded: replay.checkpointAncestryBlocksLoaded,
    }
  } finally {
    await recovered.close()
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
