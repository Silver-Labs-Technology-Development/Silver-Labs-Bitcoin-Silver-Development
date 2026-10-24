import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PersistentBlockProcessor,
  ProtocolError,
} from '../src/blockProcessor.js'
import {
  createEvmSettlementEnvelope,
  verifyEvmSettlementEnvelope,
  ZERO_COMMITMENT,
} from '../src/settlementEnvelope.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`

async function withStore<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-settlement-v1-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('v1 envelope verifies canonical genesis and linked child block', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)
    assert.equal(
      verifyEvmSettlementEnvelope(envelope0, ZERO_COMMITMENT, ZERO_HASH).commitmentHash,
      envelope0.commitmentHash,
    )

    await processor.buildNextBlock([], 1_750_000_001n)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    assert.ok(child)

    const envelope1 = createEvmSettlementEnvelope(
      child.blockRlpHex,
      envelope0.commitmentHash,
    )
    assert.equal(envelope1.parentHash, envelope0.blockHash)
    assert.equal(
      verifyEvmSettlementEnvelope(
        envelope1,
        envelope0.commitmentHash,
        envelope0.blockHash,
      ).blockHash,
      child.summary.hash,
    )
  })
})

test('v1 envelope rejects altered header fields and commitment hashes', async () => {
  await withStore(async (directory) => {
    const processor = await PersistentBlockProcessor.open(directory)
    const view = await processor.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const envelope = createEvmSettlementEnvelope(genesis.blockRlpHex)
    const alteredStateRoot = {
      ...envelope,
      stateRoot: `0x${'1'.repeat(64)}`,
    }
    assert.throws(
      () => verifyEvmSettlementEnvelope(alteredStateRoot, ZERO_COMMITMENT, ZERO_HASH),
      ProtocolError,
    )

    const alteredCommitment = {
      ...envelope,
      commitmentHash: '1'.repeat(64),
    }
    assert.throws(
      () => verifyEvmSettlementEnvelope(alteredCommitment, ZERO_COMMITMENT, ZERO_HASH),
      ProtocolError,
    )
  })
})

test('v1 envelope rejects malformed RLP, wrong commitment links, and broken parent links', async () => {
  assert.throws(
    () => createEvmSettlementEnvelope('0x01'),
    ProtocolError,
  )

  await withStore(async (directory) => {
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

    assert.throws(
      () => verifyEvmSettlementEnvelope(envelope1, ZERO_COMMITMENT, envelope0.blockHash),
      ProtocolError,
    )
    assert.throws(
      () => verifyEvmSettlementEnvelope(
        envelope1,
        envelope0.commitmentHash,
        ZERO_HASH,
      ),
      ProtocolError,
    )
  })
})
