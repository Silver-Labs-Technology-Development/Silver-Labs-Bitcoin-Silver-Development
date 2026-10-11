import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor, ProtocolError } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch, verifyEvmSettlementBatch } from '../src/settlementBatch.js'
import { verifyEvmSettlementBatchExecution } from '../src/settlementBatchReplay.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`

async function withStore<T>(run: (directory: string) => Promise<T>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-batch-v1-'))
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
  const envelope1 = createEvmSettlementEnvelope(child.blockRlpHex, envelope0.commitmentHash)

  return {
    envelopes: [envelope0, envelope1],
    batch: createEvmSettlementBatch([envelope0, envelope1]),
  }
}

test('v1 batch builds and verifies an ordered genesis-plus-child sequence', async () => {
  await withStore(async (directory) => {
    const { batch, envelopes } = await makeTwoBlockBatch(directory)

    assert.equal(batch.startHeight, '0')
    assert.equal(batch.endHeight, '1')
    assert.equal(batch.previousCommitment, ZERO_COMMITMENT)
    assert.equal(batch.terminalCommitment, envelopes[1]!.commitmentHash)

    const verified = verifyEvmSettlementBatch(batch, ZERO_COMMITMENT, ZERO_HASH, '0')
    assert.equal(verified.batchHash, batch.batchHash)
    assert.equal(verified.envelopes.length, 2)
  })
})

test('v1 batch rejects incorrect starting anchors', async () => {
  await withStore(async (directory) => {
    const { batch } = await makeTwoBlockBatch(directory)

    assert.throws(
      () => verifyEvmSettlementBatch(batch, '1'.repeat(64), ZERO_HASH, '0'),
      ProtocolError,
    )
    assert.throws(
      () => verifyEvmSettlementBatch(batch, ZERO_COMMITMENT, `0x${'1'.repeat(64)}`, '0'),
      ProtocolError,
    )
    assert.throws(
      () => verifyEvmSettlementBatch(batch, ZERO_COMMITMENT, ZERO_HASH, '1'),
      ProtocolError,
    )
  })
})

test('v1 batch rejects a broken parent link inside the sequence', async () => {
  await withStore(async (directory) => {
    const { batch, envelopes } = await makeTwoBlockBatch(directory)
    const brokenChild = {
      ...envelopes[1]!,
      parentHash: `0x${'1'.repeat(64)}`,
    }
    const brokenBatch = {
      ...batch,
      envelopes: [envelopes[0]!, brokenChild],
    }

    assert.throws(
      () => verifyEvmSettlementBatch(brokenBatch, ZERO_COMMITMENT, ZERO_HASH, '0'),
      ProtocolError,
    )
  })
})

test('v1 batch rejects altered metadata and a tampered batch hash', async () => {
  await withStore(async (directory) => {
    const { batch } = await makeTwoBlockBatch(directory)

    assert.throws(
      () => verifyEvmSettlementBatch(
        { ...batch, endHeight: '99' },
        ZERO_COMMITMENT,
        ZERO_HASH,
        '0',
      ),
      ProtocolError,
    )
    assert.throws(
      () => verifyEvmSettlementBatch(
        { ...batch, batchHash: '1'.repeat(64) },
        ZERO_COMMITMENT,
        ZERO_HASH,
        '0',
      ),
      ProtocolError,
    )
  })
})

test('v1 batch rejects empty envelopes and unknown fields', async () => {
  await withStore(async (directory) => {
    const { batch } = await makeTwoBlockBatch(directory)

    assert.throws(
      () => verifyEvmSettlementBatch(
        { ...batch, envelopes: [] },
        ZERO_COMMITMENT,
        ZERO_HASH,
        '0',
      ),
      ProtocolError,
    )
    assert.throws(
      () => verifyEvmSettlementBatch(
        { ...batch, unexpected: true },
        ZERO_COMMITMENT,
        ZERO_HASH,
        '0',
      ),
      ProtocolError,
    )
  })
})

test('independent replay verifies a valid genesis-plus-child batch', async () => {
  await withStore(async (directory) => {
    const { batch } = await makeTwoBlockBatch(directory)

    const report = await verifyEvmSettlementBatchExecution(
      JSON.parse(JSON.stringify(batch)),
      ZERO_COMMITMENT,
      ZERO_HASH,
      '0',
    )

    assert.equal(report.executionVerified, true)
    assert.equal(report.blocksVerified, 2)
    assert.equal(report.childBlocksReexecuted, 1)
    assert.equal(report.startHeight, '0')
    assert.equal(report.endHeight, '1')
    assert.equal(report.batchHash, batch.batchHash)
  })
})

test('independent replay rejects a valid non-genesis continuation until checkpoint replay is supported', async () => {
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

    await processor.buildNextBlock([], 1_750_000_002n)
    const view2 = await processor.createCanonicalReadView()
    const block2 = view2.getCanonicalBlockByNumber(2n)
    assert.ok(block2)
    const envelope2 = createEvmSettlementEnvelope(
      block2.blockRlpHex,
      envelope1.commitmentHash,
    )

    const continuationBatch = createEvmSettlementBatch([envelope1, envelope2])
    assert.equal(continuationBatch.startHeight, '1')
    assert.equal(continuationBatch.endHeight, '2')

    await assert.rejects(
      verifyEvmSettlementBatchExecution(
        continuationBatch,
        envelope0.commitmentHash,
        envelope0.blockHash,
        '1',
      ),
      /independent replay currently requires a batch starting at genesis height 0/,
    )
  })
})

test('v1 batch and envelope commitments are deterministic for identical canonical blocks', async () => {
  await withStore(async (directory) => {
    const { envelopes } = await makeTwoBlockBatch(directory)

    const rebuiltGenesis = createEvmSettlementEnvelope(
      envelopes[0]!.blockRlpHex,
    )
    const rebuiltChild = createEvmSettlementEnvelope(
      envelopes[1]!.blockRlpHex,
      rebuiltGenesis.commitmentHash,
    )

    const originalBatch = createEvmSettlementBatch(envelopes)
    const rebuiltBatch = createEvmSettlementBatch([
      rebuiltGenesis,
      rebuiltChild,
    ])

    assert.deepEqual([rebuiltGenesis, rebuiltChild], envelopes)
    assert.deepEqual(rebuiltBatch, originalBatch)
    assert.equal(rebuiltBatch.batchHash, originalBatch.batchHash)

    const verified = verifyEvmSettlementBatch(
      JSON.parse(JSON.stringify(rebuiltBatch)),
      ZERO_COMMITMENT,
      ZERO_HASH,
      '0',
    )
    assert.equal(verified.batchHash, originalBatch.batchHash)
  })
})
