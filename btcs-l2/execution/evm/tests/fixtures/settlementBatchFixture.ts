import { join } from 'node:path'
import { PersistentBlockProcessor } from '../../src/blockProcessor.js'
import {
  createEvmSettlementEnvelope,
} from '../../src/settlementEnvelope.js'
import {
  createEvmSettlementBatch,
  type EvmSettlementBatch,
} from '../../src/settlementBatch.js'

export type GenesisSettlementFixture = Readonly<{
  batch: EvmSettlementBatch
  processor: PersistentBlockProcessor
}>

/**
 * Build a small replay-verified genesis batch for publication/continuity tests.
 *
 * The caller owns the temporary root directory and must remove it afterwards.
 */
export async function createGenesisSettlementFixture(
  root: string,
  childTimestamp = 1_750_000_001n,
): Promise<GenesisSettlementFixture> {
  const processor = await PersistentBlockProcessor.open(join(root, 'chain'))
  const view0 = await processor.createCanonicalReadView()
  const genesis = view0.getCanonicalBlockByNumber(0n)
  if (genesis === undefined) {
    throw new Error('test fixture genesis block is missing')
  }

  const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)
  await processor.buildNextBlock([], childTimestamp)
  const view1 = await processor.createCanonicalReadView()
  const block1 = view1.getCanonicalBlockByNumber(1n)
  if (block1 === undefined) {
    throw new Error('test fixture child block is missing')
  }
  const envelope1 = createEvmSettlementEnvelope(
    block1.blockRlpHex,
    envelope0.commitmentHash,
  )

  return {
    batch: createEvmSettlementBatch([envelope0, envelope1]),
    processor,
  }
}
