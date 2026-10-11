import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createContractAddress, hexToBytes } from '@ethereumjs/util'
import { PersistentBlockProcessor, ProtocolError } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { SENDER_ADDRESS } from '../src/config.js'
import { compileCounter } from '../src/compile.js'
import { signFeeMarketTransaction } from '../src/transactions.js'
import { createEvmSettlementBatch, verifyEvmSettlementBatch } from '../src/settlementBatch.js'
import {
  verifyEvmSettlementBatchExecution,
  verifyEvmSettlementBatchExecutionFromCheckpoint,
} from '../src/settlementBatchReplay.js'

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

test('checkpoint replay preserves contract state and verifies a non-genesis continuation', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const compiled = compileCounter()
    const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
    const incrementSelector = compiled.methodIdentifiers['increment()']
    assert.ok(incrementSelector)

    const deployment = signFeeMarketTransaction({
      nonce: 0n,
      data: compiled.creationBytecode,
      gasLimit: 500_000n,
    })
    const increment = signFeeMarketTransaction({
      nonce: 1n,
      to: contractAddress,
      data: hexToBytes(`0x${incrementSelector}`),
      gasLimit: 150_000n,
    })

    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)

    const deployed = await processor.buildNextBlock(
      [deployment],
      1_750_000_001n,
    )
    assert.equal(deployed.summary.receipts[0]?.status, 1)

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
    assert.equal(manifest.stateRoot, envelope1.stateRoot)

    const incremented = await processor.buildNextBlock(
      [increment],
      1_750_000_002n,
    )
    assert.equal(incremented.summary.receipts[0]?.status, 1)

    const canonicalView = await processor.createCanonicalReadView()
    const block2 = canonicalView.getCanonicalBlockByNumber(2n)
    assert.ok(block2)
    const envelope2 = createEvmSettlementEnvelope(
      block2.blockRlpHex,
      envelope1.commitmentHash,
    )
    const continuationBatch = createEvmSettlementBatch([envelope2])

    const report = await verifyEvmSettlementBatchExecutionFromCheckpoint(
      continuationBatch,
      envelope1.commitmentHash,
      envelope1.blockHash,
      '2',
      checkpointPath,
      canonicalView,
    )

    assert.equal(report.executionVerified, true)
    assert.equal(report.blocksVerified, 1)
    assert.equal(report.childBlocksReexecuted, 1)
    assert.equal(report.startHeight, '2')
    assert.equal(report.endHeight, '2')
    assert.equal(report.checkpointHeight, '1')
    assert.equal(report.checkpointAncestryBlocksLoaded, 2)
    assert.equal(report.batchHash, continuationBatch.batchHash)

    // A canonical checkpoint is not sufficient if it is more than one
    // block behind the batch's first block.
    await processor.buildNextBlock([], 1_750_000_003n)
    const view3 = await processor.createCanonicalReadView()
    const block3 = view3.getCanonicalBlockByNumber(3n)
    assert.ok(block3)
    const envelope3 = createEvmSettlementEnvelope(
      block3.blockRlpHex,
      envelope2.commitmentHash,
    )
    const gapBatch = createEvmSettlementBatch([envelope3])

    await assert.rejects(
      verifyEvmSettlementBatchExecutionFromCheckpoint(
        gapBatch,
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
