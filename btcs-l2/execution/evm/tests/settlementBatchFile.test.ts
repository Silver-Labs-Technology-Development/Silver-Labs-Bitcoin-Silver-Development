import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor, ProtocolError } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import {
  exportEvmSettlementBatchFile,
  importEvmSettlementBatchFile,
} from '../src/settlementBatchFile.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ANCHORS = {
  previousCommitment: ZERO_COMMITMENT,
  parentHash: ZERO_HASH,
  startHeight: '0',
}

async function withStore(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-batch-file-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function makeBatch(directory: string) {
  const processor = await PersistentBlockProcessor.open(directory)
  const view = await processor.createCanonicalReadView()
  const genesis = view.getCanonicalBlockByNumber(0n)
  assert.ok(genesis)

  const envelope = createEvmSettlementEnvelope(genesis.blockRlpHex)
  return createEvmSettlementBatch([envelope])
}

test('batch file exports and imports a verified portable JSON batch', async () => {
  await withStore(async (directory) => {
    const batch = await makeBatch(join(directory, 'chain'))
    const path = join(directory, 'batch.json')

    const exported = await exportEvmSettlementBatchFile(path, batch, ANCHORS)
    const imported = await importEvmSettlementBatchFile(path, ANCHORS)

    assert.equal(exported.batchHash, batch.batchHash)
    assert.equal(imported.batchHash, batch.batchHash)
    assert.deepEqual(imported, batch)

    const contents = await readFile(path, 'utf8')
    assert.equal(JSON.parse(contents).format, 'btcs-l2-evm-settlement-batch')
  })
})

test('batch file import rejects tampering and incorrect anchors', async () => {
  await withStore(async (directory) => {
    const batch = await makeBatch(join(directory, 'chain'))
    const path = join(directory, 'batch.json')
    await exportEvmSettlementBatchFile(path, batch, ANCHORS)

    const tampered = { ...batch, endHeight: '99' }
    await writeFile(path, JSON.stringify(tampered), 'utf8')
    await assert.rejects(
      importEvmSettlementBatchFile(path, ANCHORS),
      ProtocolError,
    )

    await exportEvmSettlementBatchFile(path, batch, ANCHORS)
    await assert.rejects(
      importEvmSettlementBatchFile(path, {
        ...ANCHORS,
        previousCommitment: '1'.repeat(64),
      }),
      ProtocolError,
    )
  })
})

test('batch file import rejects invalid JSON and missing files', async () => {
  await withStore(async (directory) => {
    const invalidPath = join(directory, 'invalid.json')
    await writeFile(invalidPath, '{"format":', 'utf8')

    await assert.rejects(
      importEvmSettlementBatchFile(invalidPath, ANCHORS),
      /invalid JSON/,
    )
    await assert.rejects(
      importEvmSettlementBatchFile(join(directory, 'missing.json'), ANCHORS),
      /cannot be accessed/,
    )
  })
})

test('batch file export refuses to write a batch that fails verification', async () => {
  await withStore(async (directory) => {
    const batch = await makeBatch(join(directory, 'chain'))
    const path = join(directory, 'should-not-exist.json')

    await assert.rejects(
      exportEvmSettlementBatchFile(path, batch, {
        ...ANCHORS,
        startHeight: '1',
      }),
      ProtocolError,
    )
  })
})
