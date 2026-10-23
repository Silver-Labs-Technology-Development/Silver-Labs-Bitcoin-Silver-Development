import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PersistentBlockProcessor,
  type CanonicalReadView,
} from '../src/blockProcessor.js'
import {
  createEvmSettlementEnvelope,
  ZERO_COMMITMENT,
} from '../src/settlementEnvelope.js'
import {
  createEvmSettlementBatch,
  type EvmSettlementBatch,
} from '../src/settlementBatch.js'
import {
  BTCS_L2_SETTLEMENT_CONTINUITY_FILE,
  SettlementContinuityStore,
} from '../src/settlementContinuity.js'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import { BtcsL1PublicationStore } from '../src/btcsL1PublicationStore.js'
import type { BtcsL1ConfirmationRpc } from '../src/btcsL1Confirmation.js'
import { verifyAndAdvanceBtcsL1PublicationWithContinuity } from '../src/btcsL1PublicationWorkflow.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const TXID = 'b'.repeat(64)
const PUBLICATION_BLOCK_HASH = 'c'.repeat(64)

function makeConfirmationRpc(batchHash: string): BtcsL1ConfirmationRpc {
  return {
    async getRawTransaction(requestedTxid, requestedBlockHash) {
      return {
        txid: requestedTxid,
        blockhash: requestedBlockHash,
        in_active_chain: true,
        confirmations: 1,
        vout: [{
          scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) },
        }],
      }
    },
    async getBlockHeader(requestedBlockHash) {
      return { hash: requestedBlockHash, height: 120, confirmations: 1 }
    },
  }
}

type Fixture = Readonly<{
  root: string
  genesisBatch: EvmSettlementBatch
  continuationBatch: EvmSettlementBatch
  gapBatch: EvmSettlementBatch
  overlappingBatch: EvmSettlementBatch
  stalePreviousBatch: EvmSettlementBatch
  checkpointDirectory: string
  canonicalView: CanonicalReadView
}>

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-continuity-'))
  const processor = await PersistentBlockProcessor.open(join(root, 'chain'))
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
  const genesisBatch = createEvmSettlementBatch([envelope0, envelope1])

  const checkpointDirectory = join(root, 'checkpoint-at-1')
  await processor.exportStateCheckpoint(checkpointDirectory)

  await processor.buildNextBlock([], 1_750_000_002n)
  const view2 = await processor.createCanonicalReadView()
  const block2 = view2.getCanonicalBlockByNumber(2n)
  assert.ok(block2)
  const envelope2 = createEvmSettlementEnvelope(
    block2.blockRlpHex,
    envelope1.commitmentHash,
  )
  const continuationBatch = createEvmSettlementBatch([envelope2])
  const overlappingBatch = createEvmSettlementBatch([envelope1, envelope2])

  await processor.buildNextBlock([], 1_750_000_003n)
  const view3 = await processor.createCanonicalReadView()
  const block3 = view3.getCanonicalBlockByNumber(3n)
  assert.ok(block3)
  const envelope3 = createEvmSettlementEnvelope(
    block3.blockRlpHex,
    envelope2.commitmentHash,
  )
  const gapBatch = createEvmSettlementBatch([envelope3])

  const wrongPreviousEnvelope = createEvmSettlementEnvelope(
    block2.blockRlpHex,
    ZERO_COMMITMENT,
  )
  const stalePreviousBatch = createEvmSettlementBatch([wrongPreviousEnvelope])

  return {
    root,
    genesisBatch,
    continuationBatch,
    gapBatch,
    overlappingBatch,
    stalePreviousBatch,
    checkpointDirectory,
    canonicalView: view3,
  }
}

test('continuity advances only across exact linked batches and survives restart', async () => {
  const fixture = await makeFixture()
  try {
    const store = await SettlementContinuityStore.create(join(fixture.root, 'continuity'))
    assert.equal(store.getCursor(), null)

    const genesisCursor = await store.acceptBatch(fixture.genesisBatch)
    assert.equal(genesisCursor.startHeight, '0')
    assert.equal(genesisCursor.endHeight, '1')
    assert.equal(genesisCursor.previousCommitment, ZERO_COMMITMENT)
    assert.equal(genesisCursor.terminalCommitment, fixture.genesisBatch.terminalCommitment)
    assert.equal(genesisCursor.parentHash, ZERO_HASH)
    assert.equal(genesisCursor.blockHash, fixture.genesisBatch.envelopes[1]!.blockHash)

    const repeated = await store.acceptBatch(fixture.genesisBatch)
    assert.deepEqual(repeated, genesisCursor)

    const continuation = await store.acceptBatch(fixture.continuationBatch, {
      checkpointDirectory: fixture.checkpointDirectory,
      canonicalView: fixture.canonicalView,
    })
    assert.equal(continuation.startHeight, '2')
    assert.equal(continuation.endHeight, '2')
    assert.equal(continuation.previousCommitment, fixture.genesisBatch.terminalCommitment)

    const reopened = await SettlementContinuityStore.open(join(fixture.root, 'continuity'))
    assert.deepEqual(reopened.getCursor(), continuation)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('continuity rejects gaps, overlaps, stale history, and non-genesis starts', async () => {
  const fixture = await makeFixture()
  try {
    const fresh = await SettlementContinuityStore.create(join(fixture.root, 'fresh'))
    await assert.rejects(
      fresh.acceptBatch(fixture.continuationBatch),
      /genesis|starting height|previous|parent hash/i,
    )

    const store = await SettlementContinuityStore.create(join(fixture.root, 'continuity'))
    await store.acceptBatch(fixture.genesisBatch)

    await assert.rejects(
      store.acceptBatch(fixture.overlappingBatch),
      /starting height|previous|parent hash/i,
    )
    await assert.rejects(
      store.acceptBatch(fixture.continuationBatch),
      /checkpoint/i,
    )
    await assert.rejects(
      store.acceptBatch(fixture.stalePreviousBatch, {
        checkpointDirectory: fixture.checkpointDirectory,
        canonicalView: fixture.canonicalView,
      }),
      /previous|starting anchors|expected/i,
    )

    await store.acceptBatch(fixture.continuationBatch, {
      checkpointDirectory: fixture.checkpointDirectory,
      canonicalView: fixture.canonicalView,
    })

    await assert.rejects(
      store.acceptBatch(fixture.gapBatch, {
        checkpointDirectory: fixture.checkpointDirectory,
        canonicalView: fixture.canonicalView,
      }),
      /starting height|checkpoint/i,
    )
    await assert.rejects(
      store.acceptBatch(fixture.genesisBatch),
      /starting height|expected|previous/i,
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('prepared continuity is non-mutating and rejects a stale commit', async () => {
  const fixture = await makeFixture()
  try {
    const store = await SettlementContinuityStore.create(join(fixture.root, 'continuity'))
    const genesis = await store.acceptBatch(fixture.genesisBatch)
    const prepared = await store.prepareBatch(fixture.continuationBatch, {
      checkpointDirectory: fixture.checkpointDirectory,
      canonicalView: fixture.canonicalView,
    })
    assert.deepEqual(store.getCursor(), genesis)
    assert.equal(prepared.nextCursor.endHeight, '2')

    const committed = await store.commitPreparedBatch(prepared)
    assert.equal(committed.endHeight, '2')
    await assert.rejects(
      store.commitPreparedBatch(prepared),
      /cursor changed/,
    )
    assert.deepEqual(store.getCursor(), committed)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('publication workflow rejects continuity failure before persisting confirmation', async () => {
  const fixture = await makeFixture()
  try {
    const continuity = await SettlementContinuityStore.create(
      join(fixture.root, 'continuity'),
    )
    const publications = await BtcsL1PublicationStore.create(
      join(fixture.root, 'publications'),
      continuity,
    )

    await publications.createPublication(fixture.genesisBatch.batchHash, 1)
    await publications.markSubmitted(fixture.genesisBatch.batchHash, TXID)
    const confirmed = await verifyAndAdvanceBtcsL1PublicationWithContinuity(
      makeConfirmationRpc(fixture.genesisBatch.batchHash),
      publications,
      fixture.genesisBatch.batchHash,
      PUBLICATION_BLOCK_HASH,
      fixture.genesisBatch,
    )
    assert.equal(confirmed.publication.state, 'confirmed')
    assert.equal(confirmed.continuityCursor?.endHeight, '1')

    await publications.createPublication(fixture.gapBatch.batchHash, 1)
    await publications.markSubmitted(fixture.gapBatch.batchHash, TXID)
    await assert.rejects(
      verifyAndAdvanceBtcsL1PublicationWithContinuity(
        makeConfirmationRpc(fixture.gapBatch.batchHash),
        publications,
        fixture.gapBatch.batchHash,
        PUBLICATION_BLOCK_HASH,
        fixture.gapBatch,
      ),
      /starting height|previous|expected/i,
    )
    assert.equal(publications.get(fixture.gapBatch.batchHash)?.state, 'submitted')
    assert.deepEqual(continuity.getCursor(), confirmed.continuityCursor)

    // The low-level store API is the same guarded path; there is no public
    // method that can persist the gapped batch without continuity.
    await assert.rejects(
      publications.observe(
        fixture.gapBatch.batchHash,
        PUBLICATION_BLOCK_HASH,
        120,
        1,
        fixture.gapBatch,
      ),
      /starting height|previous|expected/i,
    )
    assert.equal(publications.get(fixture.gapBatch.batchHash)?.state, 'submitted')
    assert.deepEqual(continuity.getCursor(), confirmed.continuityCursor)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('continuity store fails closed after corruption or missing state', async () => {
  const fixture = await makeFixture()
  try {
    const directory = join(fixture.root, 'continuity')
    const store = await SettlementContinuityStore.create(directory)
    await store.acceptBatch(fixture.genesisBatch)

    await writeFile(join(directory, BTCS_L2_SETTLEMENT_CONTINUITY_FILE), '{not-json')
    await assert.rejects(
      SettlementContinuityStore.open(directory),
      /invalid JSON/,
    )

    const missing = join(fixture.root, 'missing')
    await assert.rejects(
      SettlementContinuityStore.open(missing),
      /ENOENT|missing/,
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('continuity rejects a repeated batch hash with altered content', async () => {
  const fixture = await makeFixture()
  try {
    const store = await SettlementContinuityStore.create(join(fixture.root, 'continuity'))
    await store.acceptBatch(fixture.genesisBatch)
    const cursor = store.getCursor()
    assert.ok(cursor)

    const altered = {
      ...fixture.genesisBatch,
      terminalCommitment: fixture.continuationBatch.terminalCommitment,
    }
    await assert.rejects(
      store.acceptBatch(altered),
      /batch hash|commitment|expected/i,
    )
    assert.deepEqual(store.getCursor(), cursor)
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
