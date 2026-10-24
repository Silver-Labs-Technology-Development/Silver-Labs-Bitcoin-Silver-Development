import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createBlockFromRLP } from '@ethereumjs/block'
import { bytesToHex, hexToBytes } from '@ethereumjs/util'
import { ProtocolError, PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createHarnessCommon } from '../src/config.js'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import {
  BTCS_L1_BATCH_DATA_CHUNK_BYTES,
  BTCS_L1_BATCH_DATA_MAGIC_HEX,
  MAX_BTCS_L1_BATCH_DATA_BYTES,
  decodeBtcsL1BatchDataScript,
  encodeBtcsL1BatchData,
  extractBtcsL1BatchDataScriptsFromCoreBlocks,
  reconstructEvmSettlementBatchFromCoreBlocks,
  reconstructEvmSettlementBatchFromScripts,
} from '../src/btcsL1BatchData.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ANCHORS = {
  previousCommitment: ZERO_COMMITMENT,
  parentHash: ZERO_HASH,
  startHeight: '0',
}

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-batch-data-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function makeBatch(directory: string) {
  const processor = await PersistentBlockProcessor.open(join(directory, 'chain'))
  const view = await processor.createCanonicalReadView()
  const genesis = view.getCanonicalBlockByNumber(0n)
  assert.ok(genesis)
  const envelope = createEvmSettlementEnvelope(genesis.blockRlpHex)
  return createEvmSettlementBatch([envelope])
}

test('encodes canonical settlement bytes into bounded, standard-size OP_RETURN fragments', async () => {
  await withDirectory(async (directory) => {
    const batch = await makeBatch(directory)
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)

    assert.equal(encoded.batchHash, batch.batchHash)
    assert.ok(encoded.serializedBatch.byteLength <= MAX_BTCS_L1_BATCH_DATA_BYTES)
    assert.ok(encoded.fragments.length > 1)
    assert.equal(
      encoded.fragments.length,
      Math.ceil(encoded.serializedBatch.byteLength / BTCS_L1_BATCH_DATA_CHUNK_BYTES),
    )
    for (const [index, fragment] of encoded.fragments.entries()) {
      assert.equal(fragment.index, index)
      assert.equal(fragment.count, encoded.fragments.length)
      assert.equal(fragment.batchHash, batch.batchHash)
      assert.ok(fragment.scriptPubKeyHex.startsWith('6a'))
      assert.ok(fragment.scriptPubKeyHex.length / 2 <= 83)
      assert.ok(fragment.dataHex.startsWith(BTCS_L1_BATCH_DATA_MAGIC_HEX))
      assert.deepEqual(decodeBtcsL1BatchDataScript(fragment.scriptPubKeyHex), fragment)
    }
  })
})

test('refuses to encode a structurally valid batch whose state root is not executable', async () => {
  await withDirectory(async (directory) => {
    const processor = await PersistentBlockProcessor.open(join(directory, 'chain'))
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const genesisEnvelope = createEvmSettlementEnvelope(genesis.blockRlpHex)

    await processor.buildNextBlock([], 1_750_000_001n)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    assert.ok(child)

    const block = createBlockFromRLP(
      hexToBytes(child.blockRlpHex as `0x${string}`),
      { common: createHarnessCommon() },
    )
    block.header.stateRoot.set(hexToBytes(`0x${'1'.repeat(64)}`))
    const bogusEnvelope = createEvmSettlementEnvelope(
      bytesToHex(block.serialize()),
      genesisEnvelope.commitmentHash,
    )
    const batch = createEvmSettlementBatch([genesisEnvelope, bogusEnvelope])

    await assert.rejects(
      () => encodeBtcsL1BatchData(batch, ANCHORS),
      /state root|execution|replay|mismatch/i,
    )
  })
})

test('rejects an unknown execution-verification mode instead of defaulting to genesis', async () => {
  await withDirectory(async (directory) => {
    const batch = await makeBatch(directory)
    await assert.rejects(
      () => encodeBtcsL1BatchData(batch, ANCHORS, { kind: 'bogus' } as never),
      /unsupported batch execution verification mode/,
    )
  })
})

test('reconstructs out-of-order fragments from Core blocks and verifies the existing batch hash', async () => {
  await withDirectory(async (directory) => {
    const batch = await makeBatch(directory)
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    const fragmentTransactions = [...encoded.fragments].reverse().map((fragment) => ({
      vout: [{ scriptPubKey: { hex: fragment.scriptPubKeyHex } }],
    }))
    const blocks = [{
      height: 500,
      tx: [
        { vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batch.batchHash) } }] },
        ...fragmentTransactions,
      ],
    }]

    const scripts = extractBtcsL1BatchDataScriptsFromCoreBlocks(blocks)
    assert.equal(scripts.length, encoded.fragments.length + 1)
    const reconstructed = await reconstructEvmSettlementBatchFromCoreBlocks(
      blocks,
      batch.batchHash,
      ANCHORS,
    )
    assert.equal(reconstructed.batch.batchHash, batch.batchHash)
    assert.deepEqual(reconstructed.batch, batch)
    assert.equal(reconstructed.fragmentCount, encoded.fragments.length)
    assert.deepEqual(reconstructed.serializedBatch, encoded.serializedBatch)
  })
})

test('rejects missing and duplicate fragments instead of returning partial batch data', async () => {
  await withDirectory(async (directory) => {
    const batch = await makeBatch(directory)
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    const scripts = encoded.fragments.map((fragment) => fragment.scriptPubKeyHex)

    await assert.rejects(
      () => reconstructEvmSettlementBatchFromScripts(scripts.slice(1), batch.batchHash, ANCHORS),
      /incomplete|missing a fragment/,
    )
    await assert.rejects(
      () => reconstructEvmSettlementBatchFromScripts(
        [...scripts, scripts[0]!],
        batch.batchHash,
        ANCHORS,
      ),
      /duplicate.*fragment index/,
    )
  })
})

test('rejects altered fragment bytes, inconsistent anchors, and a different expected commitment', async () => {
  await withDirectory(async (directory) => {
    const batch = await makeBatch(directory)
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    const scripts = encoded.fragments.map((fragment) => fragment.scriptPubKeyHex)
    const changed = [...scripts]
    const lastScript = changed.at(-1)!
    changed[changed.length - 1] = lastScript.slice(0, -1) + (lastScript.endsWith('0') ? '1' : '0')

    await assert.rejects(
      () => reconstructEvmSettlementBatchFromScripts(changed, batch.batchHash, ANCHORS),
      ProtocolError,
    )
    await assert.rejects(
      () => reconstructEvmSettlementBatchFromScripts(
        scripts,
        batch.batchHash,
        { ...ANCHORS, startHeight: '1' },
      ),
      /starting height|batch start height/,
    )
    await assert.rejects(
      () => reconstructEvmSettlementBatchFromScripts(scripts, 'f'.repeat(64), ANCHORS),
      /no matching confirmed/,
    )
  })
})

test('ignores unrelated OP_RETURN payloads but rejects malformed fragments using its marker', async () => {
  await withDirectory(async (directory) => {
    const batch = await makeBatch(directory)
    const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
    assert.equal(decodeBtcsL1BatchDataScript(encodeBtcsL1AnchorScript(batch.batchHash)), undefined)

    const first = encoded.fragments[0]!
    const payload = Buffer.from(first.dataHex, 'hex')
    const truncatedPayload = payload.subarray(0, 10)
    const truncatedScript = `6a${truncatedPayload.length.toString(16).padStart(2, '0')}${truncatedPayload.toString('hex')}`
    assert.throws(
      () => decodeBtcsL1BatchDataScript(truncatedScript),
      /header is truncated/,
    )
  })
})

test('enforces bounded Core block and output scan inputs', () => {
  assert.throws(
    () => extractBtcsL1BatchDataScriptsFromCoreBlocks(Array(10_001).fill({ tx: [] })),
    /block scan exceeds its height limit/,
  )
  assert.throws(
    () => extractBtcsL1BatchDataScriptsFromCoreBlocks([
      { tx: [{ vout: Array(100_001).fill({ scriptPubKey: { hex: '51' } }) }] },
    ]),
    /output limit/,
  )
})
