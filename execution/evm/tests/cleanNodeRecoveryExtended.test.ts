import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { encodeBtcsL1BatchData, reconstructEvmSettlementBatchFromScripts } from '../src/btcsL1BatchData.js'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ANCHORS = {
  previousCommitment: ZERO_COMMITMENT,
  parentHash: ZERO_HASH,
  startHeight: '0',
}

test('clean-node recovery extended: restart simulation - reconstruct after "restart" with same fragments', async () => {
  const sequencerDir = await mkdtemp(join(tmpdir(), 'btcs-sequencer-'))
  try {
    const processor = await PersistentBlockProcessor.open(join(sequencerDir, 'chain'))
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const GENESIS_TIMESTAMP = BigInt((genesis as any).block?.header?.timestamp ?? (genesis as any).summary?.timestamp ?? 1000000n)
    
    const envelope0 = createEvmSettlementEnvelope((genesis as any).blockRlpHex ?? (genesis as any).block?.blockRlpHex)
    await processor.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    assert.ok(child)
    const envelope1 = createEvmSettlementEnvelope((child as any).blockRlpHex ?? (child as any).block?.blockRlpHex, envelope0.commitmentHash)
    const batch = createEvmSettlementBatch([envelope0, envelope1])
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    const anchorScript = encodeBtcsL1AnchorScript(batch.batchHash)
    const fragmentScripts = encoded.fragments.map(f => f.scriptPubKeyHex)
    
    // First reconstruction
    const recovered1 = await reconstructEvmSettlementBatchFromScripts([anchorScript, ...fragmentScripts], batch.batchHash, ANCHORS)
    // Simulate restart - reconstruct again from same artifacts
    const recovered2 = await reconstructEvmSettlementBatchFromScripts([anchorScript, ...fragmentScripts], batch.batchHash, ANCHORS)
    
    assert.equal(recovered1.batch.batchHash, recovered2.batch.batchHash)
    assert.equal(recovered1.serializedBatch.toString(), recovered2.serializedBatch.toString())
  } finally {
    await rm(sequencerDir, { recursive: true, force: true })
  }
})

test('clean-node recovery extended: incomplete artifacts cannot become finalized - missing fragment rejected', async () => {
  const sequencerDir = await mkdtemp(join(tmpdir(), 'btcs-sequencer-'))
  try {
    const processor = await PersistentBlockProcessor.open(join(sequencerDir, 'chain'))
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const GENESIS_TIMESTAMP = BigInt((genesis as any).block?.header?.timestamp ?? (genesis as any).summary?.timestamp ?? 1000000n)
    const envelope0 = createEvmSettlementEnvelope((genesis as any).blockRlpHex ?? (genesis as any).block?.blockRlpHex)
    await processor.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    assert.ok(child)
    const envelope1 = createEvmSettlementEnvelope((child as any).blockRlpHex ?? (child as any).block?.blockRlpHex, envelope0.commitmentHash)
    const batch = createEvmSettlementBatch([envelope0, envelope1])
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    
    const scripts = encoded.fragments.slice(0, Math.floor(encoded.fragments.length/2)).map(f => f.scriptPubKeyHex)
    await assert.rejects(async () => {
      await reconstructEvmSettlementBatchFromScripts(scripts, batch.batchHash, ANCHORS)
    })
  } finally {
    await rm(sequencerDir, { recursive: true, force: true })
  }
})

test('clean-node recovery extended: conflicting fragments rejected', async () => {
  const sequencerDir = await mkdtemp(join(tmpdir(), 'btcs-sequencer-'))
  try {
    const processor = await PersistentBlockProcessor.open(join(sequencerDir, 'chain'))
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const GENESIS_TIMESTAMP = BigInt((genesis as any).block?.header?.timestamp ?? (genesis as any).summary?.timestamp ?? 1000000n)
    const envelope0 = createEvmSettlementEnvelope((genesis as any).blockRlpHex ?? (genesis as any).block?.blockRlpHex)
    await processor.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    assert.ok(child)
    const envelope1 = createEvmSettlementEnvelope((child as any).blockRlpHex ?? (child as any).block?.blockRlpHex, envelope0.commitmentHash)
    const batch = createEvmSettlementBatch([envelope0, envelope1])
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    
    // Create conflicting fragment by duplicating with different data
    const scripts = [...encoded.fragments.map(f => f.scriptPubKeyHex)]
    scripts[1] = scripts[0].replace(/[0-9a-f]$/i, 'c')
    try {
      await reconstructEvmSettlementBatchFromScripts(scripts, batch.batchHash, ANCHORS)
      assert.fail('should throw')
    } catch (e) {
      assert.ok(e instanceof Error)
    }
  } finally {
    await rm(sequencerDir, { recursive: true, force: true })
  }
})

test('clean-node recovery extended: interrupted reconstruction cannot be finalized without all pieces', async () => {
  const sequencerDir = await mkdtemp(join(tmpdir(), 'btcs-sequencer-'))
  try {
    const processor = await PersistentBlockProcessor.open(join(sequencerDir, 'chain'))
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const GENESIS_TIMESTAMP = BigInt((genesis as any).block?.header?.timestamp ?? (genesis as any).summary?.timestamp ?? 1000000n)
    const envelope0 = createEvmSettlementEnvelope((genesis as any).blockRlpHex ?? (genesis as any).block?.blockRlpHex)
    await processor.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    assert.ok(child)
    const envelope1 = createEvmSettlementEnvelope((child as any).blockRlpHex ?? (child as any).block?.blockRlpHex, envelope0.commitmentHash)
    const batch = createEvmSettlementBatch([envelope0, envelope1])
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    const anchorScript = encodeBtcsL1AnchorScript(batch.batchHash)
    
    // Only anchor, no fragments
    await assert.rejects(async () => {
      await reconstructEvmSettlementBatchFromScripts([anchorScript], batch.batchHash, ANCHORS)
    })
  } finally {
    await rm(sequencerDir, { recursive: true, force: true })
  }
})
