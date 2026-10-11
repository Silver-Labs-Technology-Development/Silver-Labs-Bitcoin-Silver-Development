import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  BtcsL1PublicationStore,
  BTCS_L1_PUBLICATION_STORE_FILE,
  BTCS_L1_PUBLICATION_STORE_FORMAT,
  BTCS_L1_PUBLICATION_STORE_VERSION,
} from '../src/btcsL1PublicationStore.js'

const batchHash = 'a'.repeat(64)
const txid = 'b'.repeat(64)
const blockHash = 'c'.repeat(64)
const fileName = BTCS_L1_PUBLICATION_STORE_FILE

async function withDirectory(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l1-publication-store-'))
  try {
    await run(join(root, 'store'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('publication state survives reopening after each durable transition', async () => {
  await withDirectory(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)

    const prepared = await store.createPublication(batchHash, 6)
    assert.equal(prepared.state, 'prepared')

    const submitted = await store.markSubmitted(batchHash, txid)
    assert.equal(submitted.state, 'submitted')

    const observed = await store.observe(batchHash, blockHash, 120, 2)
    assert.equal(observed.state, 'observed')
    assert.equal(observed.confirmations, 2)

    const reopened = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(reopened.get(batchHash), observed)
    assert.equal(reopened.list().length, 1)

    const confirmed = await reopened.observe(batchHash, blockHash, 120, 6)
    assert.equal(confirmed.state, 'confirmed')

    const recovered = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(recovered.get(batchHash), confirmed)
  })
})

test('failed transitions leave both in-memory and persisted state unchanged', async () => {
  await withDirectory(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    const prepared = await store.createPublication(batchHash, 6)

    await assert.rejects(
      store.observe(batchHash, blockHash, 120, 1),
      /only a submitted, observed, or confirmed publication can be observed/,
    )

    assert.deepEqual(store.get(batchHash), prepared)

    const recovered = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(recovered.get(batchHash), prepared)
  })
})

test('invalidating and re-observing a publication survives restart', async () => {
  await withDirectory(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    await store.createPublication(batchHash, 3)
    await store.markSubmitted(batchHash, txid)
    await store.observe(batchHash, blockHash, 120, 3)

    const invalidated = await store.invalidate(batchHash)
    assert.equal(invalidated.state, 'invalidated')
    assert.equal(invalidated.txid, txid)
    assert.equal(invalidated.blockHash, undefined)

    const reopened = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(reopened.get(batchHash), invalidated)

    const replacementBlockHash = 'd'.repeat(64)
    const reobserved = await reopened.reobserve(
      batchHash,
      replacementBlockHash,
      121,
      1,
    )
    assert.equal(reobserved.state, 'observed')
    assert.equal(reobserved.blockHash, replacementBlockHash)

    const recovered = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(recovered.get(batchHash), reobserved)
  })
})

test('missing publication store fails closed instead of initializing an empty store', async () => {
  await withDirectory(async (directory) => {
    await mkdir(directory, { recursive: true })
    await assert.rejects(
      BtcsL1PublicationStore.open(directory),
      /publication store file is missing/,
    )
  })
})

test('corrupt JSON and unsupported store versions are rejected', async () => {
  await withDirectory(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    const path = join(directory, fileName)

    await store.createPublication(batchHash, 6)
    await writeFile(path, '{"broken":', 'utf8')
    await assert.rejects(
      BtcsL1PublicationStore.open(directory),
      /publication store contains invalid JSON/,
    )

    await writeFile(path, JSON.stringify({
      format: BTCS_L1_PUBLICATION_STORE_FORMAT,
      version: BTCS_L1_PUBLICATION_STORE_VERSION + 1,
      records: [],
    }), 'utf8')
    await assert.rejects(
      BtcsL1PublicationStore.open(directory),
      /unsupported publication store format or version/,
    )
  })
})

test('duplicate batch records and invalid publication records are rejected', async () => {
  await withDirectory(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
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
      BtcsL1PublicationStore.open(directory),
      /duplicate batch hashes/,
    )

    await writeFile(path, JSON.stringify({
      ...header,
      records: [{ ...prepared, unexpectedField: true }],
    }), 'utf8')
    await assert.rejects(
      BtcsL1PublicationStore.open(directory),
      /unknown fields/,
    )
  })
})

test('persisted snapshot contains a versioned schema and no temporary files remain after normal writes', async () => {
  await withDirectory(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    await store.createPublication(batchHash, 6)
    await store.markSubmitted(batchHash, txid)

    const snapshot = JSON.parse(
      await readFile(join(directory, fileName), 'utf8'),
    ) as Record<string, unknown>

    assert.equal(snapshot.format, BTCS_L1_PUBLICATION_STORE_FORMAT)
    assert.equal(snapshot.version, BTCS_L1_PUBLICATION_STORE_VERSION)
    assert.ok(Array.isArray(snapshot.records))
    assert.equal((snapshot.records as unknown[]).length, 1)
    assert.deepEqual(await readdir(directory), [fileName])
  })
})

test('duplicate batch publication is rejected without modifying durable state', async () => {
  await withDirectory(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    const original = await store.createPublication(batchHash, 6)

    await assert.rejects(
      store.createPublication(batchHash, 9),
      /publication already exists for this batch hash/,
    )

    assert.deepEqual(store.get(batchHash), original)
    const reopened = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(reopened.get(batchHash), original)
  })
})

test('pre-rename write failure preserves the prior state and permits retry', async () => {
  await withDirectory(async (directory) => {
    const initial = await BtcsL1PublicationStore.create(directory)
    const prepared = await initial.createPublication(batchHash, 6)

    let injectFailure = true
    const writer = await BtcsL1PublicationStore.open(directory, {
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
  await withDirectory(async (directory) => {
    const initial = await BtcsL1PublicationStore.create(directory)
    await initial.createPublication(batchHash, 6)

    let injectFailure = true
    const writer = await BtcsL1PublicationStore.open(directory, {
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

    const recovered = await BtcsL1PublicationStore.open(directory)
    assert.equal(recovered.get(batchHash)?.state, 'submitted')
    assert.equal(recovered.get(batchHash)?.txid, txid)
  })
})
