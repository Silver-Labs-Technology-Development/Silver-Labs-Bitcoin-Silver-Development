import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { prepareBtcsL1AnchorForBatch } from '../src/btcsL1AnchorPreparation.js'

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
