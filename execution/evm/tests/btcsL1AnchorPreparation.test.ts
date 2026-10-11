import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import {
  prepareBtcsL1AnchorForBatch,
  prepareBtcsL1AnchorForBatchFromCheckpoint,
} from '../src/btcsL1AnchorPreparation.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`

async function withStore<T>(run: (directory: string) => Promise<T>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-anchor-prep-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function makeTwoBlockBatch(directory: string) {
  const processor = await PersistentBlockProcessor.open(directory)
  const view0 = await processor.createCanonicalReadView()
  const genesis = view0.getCanonicalBlockByNumber(0n)
  assert.ok(genesis)

  const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)
  await processor.buildNextBlock([], 1_750_000_001n)

  const view1 = await processor.createCanonicalReadView()
  const child = view1.getCanonicalBlockByNumber(1n)
  assert.ok(child)

  const envelope1 = createEvmSettlementEnvelope(
    child.blockRlpHex,
    envelope0.commitmentHash,
  )

  return createEvmSettlementBatch([envelope0, envelope1])
}

test('only independently replay-verified batches produce an L1 anchor preparation', async () => {
  await withStore(async (directory) => {
    const batch = await makeTwoBlockBatch(directory)

    const prepared = await prepareBtcsL1AnchorForBatch(
      batch,
      ZERO_COMMITMENT,
      ZERO_HASH,
      '0',
    )

    assert.equal(prepared.format, 'btcs-l2-l1-anchor-preparation')
    assert.equal(prepared.version, 1)
    assert.equal(prepared.batchHash, batch.batchHash)
    assert.equal(prepared.startHeight, '0')
    assert.equal(prepared.endHeight, '1')
    assert.equal(prepared.blocksVerified, 2)
    assert.equal(prepared.childBlocksReexecuted, 1)
    assert.equal(prepared.executionVerified, true)
    assert.equal(prepared.dataHex.length / 2, 39)
    assert.equal(prepared.scriptPubKeyHex, `6a27${prepared.dataHex}`)
  })
})


test('checkpoint-verified continuation batches can be prepared for BTCS L1 anchoring', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)

    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)

    await processor.buildNextBlock([], 1_750_000_001n)
    const view1 = await processor.createCanonicalReadView()
    const block1 = view1.getCanonicalBlockByNumber(1n)
    assert.ok(block1)
    const envelope1 = createEvmSettlementEnvelope(
      block1.blockRlpHex,
      envelope0.commitmentHash,
    )

    const checkpointPath = join(directory, 'checkpoint')
    const manifest = await processor.exportStateCheckpoint(checkpointPath)
    assert.equal(manifest.blockHeight, '1')
    assert.equal(manifest.blockHash, envelope1.blockHash)

    await processor.buildNextBlock([], 1_750_000_002n)
    const view2 = await processor.createCanonicalReadView()
    const block2 = view2.getCanonicalBlockByNumber(2n)
    assert.ok(block2)
    const envelope2 = createEvmSettlementEnvelope(
      block2.blockRlpHex,
      envelope1.commitmentHash,
    )
    const continuationBatch = createEvmSettlementBatch([envelope2])

    const prepared = await prepareBtcsL1AnchorForBatchFromCheckpoint(
      continuationBatch,
      envelope1.commitmentHash,
      envelope1.blockHash,
      '2',
      checkpointPath,
      view2,
    )

    assert.equal(prepared.format, 'btcs-l2-l1-anchor-preparation')
    assert.equal(prepared.batchHash, continuationBatch.batchHash)
    assert.equal(prepared.startHeight, '2')
    assert.equal(prepared.endHeight, '2')
    assert.equal(prepared.blocksVerified, 1)
    assert.equal(prepared.childBlocksReexecuted, 1)
    assert.equal(prepared.executionVerified, true)
    assert.equal(prepared.dataHex.length / 2, 39)
    assert.equal(prepared.scriptPubKeyHex, `6a27${prepared.dataHex}`)

    // A checkpoint at height 1 must not authorize skipping blocks 2 onward
    // when preparing an anchor for a batch beginning at height 3.
    await processor.buildNextBlock([], 1_750_000_003n)
    const view3 = await processor.createCanonicalReadView()
    const block3 = view3.getCanonicalBlockByNumber(3n)
    assert.ok(block3)
    const envelope3 = createEvmSettlementEnvelope(
      block3.blockRlpHex,
      envelope2.commitmentHash,
    )
    const laterBatch = createEvmSettlementBatch([envelope3])

    await assert.rejects(
      prepareBtcsL1AnchorForBatchFromCheckpoint(
        laterBatch,
        envelope2.commitmentHash,
        envelope2.blockHash,
        '3',
        checkpointPath,
        view3,
      ),
      /checkpoint height must be exactly one block before the batch start/,
    )
  })
})

test('anchor preparation rejects a tampered batch commitment', async () => {
  await withStore(async (directory) => {
    const batch = await makeTwoBlockBatch(directory)

    await assert.rejects(
      prepareBtcsL1AnchorForBatch(
        { ...batch, batchHash: '1'.repeat(64) },
        ZERO_COMMITMENT,
        ZERO_HASH,
        '0',
      ),
      /settlement batch hash mismatch/,
    )
  })
})

test('anchor preparation rejects incorrect trusted starting anchors', async () => {
  await withStore(async (directory) => {
    const batch = await makeTwoBlockBatch(directory)

    await assert.rejects(
      prepareBtcsL1AnchorForBatch(
        batch,
        '1'.repeat(64),
        ZERO_HASH,
        '0',
      ),
      /starting commitment does not match|previous settlement commitment does not match/,
    )
  })
})
