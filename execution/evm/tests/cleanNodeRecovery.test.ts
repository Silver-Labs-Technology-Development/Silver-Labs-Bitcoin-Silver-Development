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

test('clean-node recovery: reconstruct batch from L1-published fragments only', async () => {
  // Simulate sequencer building and publishing
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
    
    // Publish to "L1" as fragments
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    const anchorScript = encodeBtcsL1AnchorScript(batch.batchHash)
    const fragmentScripts = encoded.fragments.map(f => f.scriptPubKeyHex)
    
    // Clean node recovery: only has L1 data, no sequencer DB
    const recovered = await reconstructEvmSettlementBatchFromScripts(
      [anchorScript, ...fragmentScripts], // include anchor too
      batch.batchHash,
      ANCHORS
    )
    
    assert.equal(recovered.batch.batchHash, batch.batchHash)
    assert.equal(recovered.fragmentCount, encoded.fragments.length)
    assert.equal(recovered.serializedBatch.toString(), encoded.serializedBatch.toString())
  } finally {
    await rm(sequencerDir, { recursive: true, force: true })
  }
})

test('clean-node recovery: fails without complete fragments', async () => {
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
    
    // Missing fragment
    const scripts = encoded.fragments.slice(0, -1).map(f => f.scriptPubKeyHex)
    await assert.rejects(async () => {
      await reconstructEvmSettlementBatchFromScripts(scripts, batch.batchHash, ANCHORS)
    }, /incomplete|missing/)
  } finally {
    await rm(sequencerDir, { recursive: true, force: true })
  }
})

test('clean-node recovery: rejects tampered fragment', async () => {
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
    
    // Tamper with fragment
    const scripts = encoded.fragments.map((f, i) => i === 0 ? f.scriptPubKeyHex.replace(/[0-9a-f]$/i, 'b') : f.scriptPubKeyHex)
    try {
      await reconstructEvmSettlementBatchFromScripts(scripts, batch.batchHash, ANCHORS)
      assert.fail('should have thrown')
    } catch (e) {
      assert.ok(e instanceof Error)
    }
  } finally {
    await rm(sequencerDir, { recursive: true, force: true })
  }
})
