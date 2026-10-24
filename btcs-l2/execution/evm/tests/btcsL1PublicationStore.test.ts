import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  bindExistingBtcsL1PublicationStore,
  BtcsL1PublicationStore,
  BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE,
  BTCS_L1_PUBLICATION_STORE_FILE,
  BTCS_L1_PUBLICATION_STORE_FORMAT,
  BTCS_L1_PUBLICATION_STORE_VERSION,
} from '../src/btcsL1PublicationStore.js'
import { SettlementContinuityStore } from '../src/settlementContinuity.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import {
  createGenesisSettlementFixture,
  type GenesisSettlementFixture,
} from './fixtures/settlementBatchFixture.js'

const txid = 'b'.repeat(64)
const blockHash = 'c'.repeat(64)
const alternateBlockHash = 'd'.repeat(64)
const fileName = BTCS_L1_PUBLICATION_STORE_FILE

async function withDirectory(
  run: (
    directory: string,
    continuity: SettlementContinuityStore,
    fixture: GenesisSettlementFixture,
  ) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l1-publication-store-'))
  try {
    const fixture = await createGenesisSettlementFixture(join(root, 'fixture'))
    const continuity = await SettlementContinuityStore.create(
      join(root, 'continuity'),
    )
    await run(join(root, 'store'), continuity, fixture)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('publication state survives reopening after each durable transition', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)

    const prepared = await store.createPublication(batchHash, 6)
    assert.equal(prepared.state, 'prepared')

    const submitted = await store.markSubmitted(batchHash, txid)
    assert.equal(submitted.state, 'submitted')

    const observed = await store.observe(
      batchHash,
      blockHash,
      120,
      2,
      fixture.batch,
    )
    assert.equal(observed.state, 'observed')
    assert.equal(observed.confirmations, 2)

    const reopened = await BtcsL1PublicationStore.open(directory, continuity)
    assert.deepEqual(reopened.get(batchHash), observed)
    assert.equal(reopened.list().length, 1)

    const confirmed = await reopened.observe(
      batchHash,
      blockHash,
      120,
      6,
      fixture.batch,
    )
    assert.equal(confirmed.state, 'confirmed')
    assert.equal(reopened.getContinuityCursor()?.batchHash, batchHash)

    const recovered = await BtcsL1PublicationStore.open(directory, continuity)
    assert.deepEqual(recovered.get(batchHash), confirmed)
  })
})

test('failed transitions leave both in-memory and persisted state unchanged', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    const prepared = await store.createPublication(batchHash, 6)

    await assert.rejects(
      store.observe(batchHash, blockHash, 120, 1, fixture.batch),
      /only a submitted, observed, or confirmed publication can be observed/,
    )

    assert.deepEqual(store.get(batchHash), prepared)

    const recovered = await BtcsL1PublicationStore.open(directory, continuity)
    assert.deepEqual(recovered.get(batchHash), prepared)
  })
})

test('invalidating and re-observing a publication survives restart', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    await store.createPublication(batchHash, 3)
    await store.markSubmitted(batchHash, txid)
    await store.observe(batchHash, blockHash, 120, 3, fixture.batch)

    const invalidated = await store.invalidate(batchHash)
    assert.equal(invalidated.state, 'invalidated')
    assert.equal(invalidated.txid, txid)
    assert.equal(invalidated.blockHash, undefined)

    const reopened = await BtcsL1PublicationStore.open(directory, continuity)
    assert.deepEqual(reopened.get(batchHash), invalidated)

    const replacementBlockHash = 'd'.repeat(64)
    const reobserved = await reopened.reobserve(
      batchHash,
      replacementBlockHash,
      121,
      1,
      fixture.batch,
    )
    assert.equal(reobserved.state, 'observed')
    assert.equal(reobserved.blockHash, replacementBlockHash)

    const recovered = await BtcsL1PublicationStore.open(directory, continuity)
    assert.deepEqual(recovered.get(batchHash), reobserved)
  })
})

test('missing publication store fails closed instead of initializing an empty store', async () => {
  await withDirectory(async (directory, continuity) => {
    await mkdir(directory, { recursive: true })
    await assert.rejects(
      BtcsL1PublicationStore.open(directory, continuity),
      /publication store file is missing/,
    )
  })
})

test('corrupt JSON and unsupported store versions are rejected', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    const path = join(directory, fileName)

    await store.createPublication(batchHash, 6)
    await writeFile(path, '{"broken":', 'utf8')
    await assert.rejects(
      BtcsL1PublicationStore.open(directory, continuity),
      /publication store contains invalid JSON/,
    )

    await writeFile(path, JSON.stringify({
      format: BTCS_L1_PUBLICATION_STORE_FORMAT,
      version: BTCS_L1_PUBLICATION_STORE_VERSION + 1,
      records: [],
    }), 'utf8')
    await assert.rejects(
      BtcsL1PublicationStore.open(directory, continuity),
      /unsupported publication store format or version/,
    )
  })
})

test('duplicate batch records and invalid publication records are rejected', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    const prepared = await store.createPublication(batchHash, 6)
    const path = join(directory, fileName)

    const header = {
      format: BTCS_L1_PUBLICATION_STORE_FORMAT,
      version: BTCS_L1_PUBLICATION_STORE_VERSION,
    }

    await writeFile(path, JSON.stringify({
      ...header,
      records: [prepared, prepared],
    }), 'utf8')
    await assert.rejects(
      BtcsL1PublicationStore.open(directory, continuity),
      /duplicate batch hashes/,
    )

    await writeFile(path, JSON.stringify({
      ...header,
      records: [{ ...prepared, unexpectedField: true }],
    }), 'utf8')
    await assert.rejects(
      BtcsL1PublicationStore.open(directory, continuity),
      /unknown fields/,
    )
  })
})

test('persisted snapshot contains a versioned schema and no temporary files remain after normal writes', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    await store.createPublication(batchHash, 6)
    await store.markSubmitted(batchHash, txid)

    const snapshot = JSON.parse(
      await readFile(join(directory, fileName), 'utf8'),
    ) as Record<string, unknown>

    assert.equal(snapshot.format, BTCS_L1_PUBLICATION_STORE_FORMAT)
    assert.equal(snapshot.version, BTCS_L1_PUBLICATION_STORE_VERSION)
    assert.ok(Array.isArray(snapshot.records))
    assert.equal((snapshot.records as unknown[]).length, 1)
    assert.deepEqual(
      (await readdir(directory)).sort(),
      [BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE, fileName].sort(),
    )

    const binding = JSON.parse(
      await readFile(
        join(directory, BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE),
        'utf8',
      ),
    ) as Record<string, unknown>
    assert.equal(binding.continuityDirectory, continuity.getDirectory())
  })
})

test('duplicate batch publication is rejected without modifying durable state', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    const original = await store.createPublication(batchHash, 6)

    await assert.rejects(
      store.createPublication(batchHash, 9),
      /publication already exists for this batch hash/,
    )

    assert.deepEqual(store.get(batchHash), original)
    const reopened = await BtcsL1PublicationStore.open(directory, continuity)
    assert.deepEqual(reopened.get(batchHash), original)
  })
})

test('pre-rename write failure preserves the prior state and permits retry', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const initial = await BtcsL1PublicationStore.create(directory, continuity)
    const prepared = await initial.createPublication(batchHash, 6)

    let injectFailure = true
    const writer = await BtcsL1PublicationStore.open(directory, continuity, {
      persistenceTestHook(stage) {
        if (stage === 'before-rename' && injectFailure) {
          injectFailure = false
          throw new Error('injected pre-rename failure')
        }
      },
    })

    await assert.rejects(
      writer.markSubmitted(batchHash, txid),
      /injected pre-rename failure/,
    )
    assert.deepEqual(writer.get(batchHash), prepared)

    const submitted = await writer.markSubmitted(batchHash, txid)
    assert.equal(submitted.state, 'submitted')
  })
})

test('post-rename write failure requires reopening before further access', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const initial = await BtcsL1PublicationStore.create(directory, continuity)
    await initial.createPublication(batchHash, 6)

    let injectFailure = true
    const writer = await BtcsL1PublicationStore.open(directory, continuity, {
      persistenceTestHook(stage) {
        if (stage === 'renamed' && injectFailure) {
          injectFailure = false
          throw new Error('injected post-rename failure')
        }
      },
    })

    await assert.rejects(
      writer.markSubmitted(batchHash, txid),
      /injected post-rename failure/,
    )
    assert.throws(
      () => writer.get(batchHash),
      /persistence outcome is uncertain/,
    )
    await assert.rejects(
      writer.markSubmitted(batchHash, txid),
      /persistence outcome is uncertain/,
    )

    const recovered = await BtcsL1PublicationStore.open(directory, continuity)
    assert.equal(recovered.get(batchHash)?.state, 'submitted')
    assert.equal(recovered.get(batchHash)?.txid, txid)
  })
})

test('direct observation rejects a batch value for another publication', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    await store.createPublication(batchHash, 1)
    const submitted = await store.markSubmitted(batchHash, txid)

    await assert.rejects(
      store.observe(
        batchHash,
        blockHash,
        120,
        1,
        { ...fixture.batch, batchHash: 'f'.repeat(64) },
      ),
      /does not match the publication batch hash/,
    )

    assert.deepEqual(store.get(batchHash), submitted)
    assert.equal(store.getContinuityCursor(), null)
  })
})

test('direct observation cannot persist a gapped batch without continuity', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    await fixture.processor.buildNextBlock([], 1_750_000_002n)
    const view = await fixture.processor.createCanonicalReadView()
    const block2 = view.getCanonicalBlockByNumber(2n)
    assert.ok(block2)
    const gapBatch = createEvmSettlementBatch([
      createEvmSettlementEnvelope(block2.blockRlpHex, ZERO_COMMITMENT),
    ])

    const store = await BtcsL1PublicationStore.create(directory, continuity)
    await store.createPublication(gapBatch.batchHash, 1)
    const submitted = await store.markSubmitted(gapBatch.batchHash, txid)

    await assert.rejects(
      store.observe(
        gapBatch.batchHash,
        blockHash,
        120,
        1,
        gapBatch,
      ),
      /genesis|starting height|previous|parent hash/i,
    )

    assert.deepEqual(store.get(gapBatch.batchHash), submitted)
    assert.equal(store.getContinuityCursor(), null)
  })
})

test('continuity commits before a failed confirmation write and retry is idempotent', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const batchHash = fixture.batch.batchHash
    const initial = await BtcsL1PublicationStore.create(directory, continuity)
    await initial.createPublication(batchHash, 1)
    const submitted = await initial.markSubmitted(batchHash, txid)

    let injectFailure = true
    const writer = await BtcsL1PublicationStore.open(directory, continuity, {
      persistenceTestHook(stage) {
        if (stage === 'before-rename' && injectFailure) {
          injectFailure = false
          throw new Error('injected publication write failure')
        }
      },
    })

    await assert.rejects(
      writer.observe(batchHash, blockHash, 120, 1, fixture.batch),
      /injected publication write failure/,
    )

    // The publication was not persisted as confirmed, but its settlement
    // cursor is already durable. That ordering cannot create a confirmed
    // publication without continuity.
    assert.deepEqual(writer.get(batchHash), submitted)
    assert.equal(writer.getContinuityCursor()?.batchHash, batchHash)

    const confirmed = await writer.observe(
      batchHash,
      blockHash,
      120,
      1,
      fixture.batch,
    )
    assert.equal(confirmed.state, 'confirmed')
    assert.equal(writer.getContinuityCursor()?.batchHash, batchHash)
  })
})

test('a competing genesis publication cannot use a fresh continuity prefix', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const alternate = await createGenesisSettlementFixture(
      join(directory, '..', 'alternate'),
      1_750_000_009n,
    )
    assert.notEqual(alternate.batch.batchHash, fixture.batch.batchHash)

    const store = await BtcsL1PublicationStore.create(directory, continuity)
    await store.createPublication(fixture.batch.batchHash, 1)
    await store.markSubmitted(fixture.batch.batchHash, txid)
    await store.createPublication(alternate.batch.batchHash, 1)
    await store.markSubmitted(alternate.batch.batchHash, txid)

    const first = await store.observe(
      fixture.batch.batchHash,
      blockHash,
      120,
      1,
      fixture.batch,
    )
    assert.equal(first.state, 'confirmed')

    await assert.rejects(
      store.observe(
        alternate.batch.batchHash,
        alternateBlockHash,
        120,
        1,
        alternate.batch,
      ),
      /genesis|starting height|previous|parent hash/i,
    )

    assert.equal(
      store.get(alternate.batch.batchHash)?.state,
      'submitted',
    )
    assert.equal(
      store.getContinuityCursor()?.batchHash,
      fixture.batch.batchHash,
    )
  })
})

test('publication store refuses to reopen with a different continuity store', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    await store.createPublication(fixture.batch.batchHash, 1)

    const other = await SettlementContinuityStore.create(
      join(directory, '..', 'other-continuity'),
    )
    await assert.rejects(
      BtcsL1PublicationStore.open(directory, other),
      /bound to a different settlement continuity store/,
    )
  })
})

test('publication store refuses to bind silently when its binding is missing', async () => {
  await withDirectory(async (directory, continuity, fixture) => {
    const store = await BtcsL1PublicationStore.create(directory, continuity)
    await store.createPublication(fixture.batch.batchHash, 1)

    await unlink(join(directory, BTCS_L1_PUBLICATION_CONTINUITY_BINDING_FILE))
    await assert.rejects(
      BtcsL1PublicationStore.open(directory, continuity),
      /continuity binding is missing/,
    )

    await bindExistingBtcsL1PublicationStore(directory, continuity)
    const rebound = await BtcsL1PublicationStore.open(directory, continuity)
    assert.equal(rebound.list().length, 1)

    const other = await SettlementContinuityStore.create(
      join(directory, '..', 'other-continuity'),
    )
    await assert.rejects(
      bindExistingBtcsL1PublicationStore(directory, other),
      /bound to a different settlement continuity store/,
    )
  })
})
