import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
  createStaticDepositBackingProvider,
} from '../src/blockProcessor.js'
import {
  BTCS_L1_DEPOSIT_RECORD_FORMAT,
  BTCS_L1_DEPOSIT_RECORD_VERSION,
} from '../src/btcsL1DepositStore.js'
import type { BtcsL1DepositRecord } from '../src/btcsL1DepositStore.js'
import { createEvmDepositOperation } from '../src/depositPrelude.js'
import {
  createEvmSettlementEnvelope,
  verifyEvmSettlementEnvelope,
  ZERO_COMMITMENT,
} from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import {
  verifyEvmSettlementBatchExecution,
  verifyEvmSettlementBatchExecutionFromCheckpoint,
} from '../src/settlementBatchReplay.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`

function makeRecord(): BtcsL1DepositRecord {
  return {
    format: BTCS_L1_DEPOSIT_RECORD_FORMAT,
    version: BTCS_L1_DEPOSIT_RECORD_VERSION,
    depositId: `${'a'.repeat(64)}:0`,
    txid: 'a'.repeat(64),
    depositOutputIndex: 0,
    recipientAddress: `0x${'1'.repeat(40)}`,
    amountSats: '125000000',
    requiredConfirmations: 6,
    state: 'confirmed',
    blockHash: 'b'.repeat(64),
    blockHeight: 200,
    confirmations: 8,
  }
}

test('settlement v2 carries deposit operations and independently replays their credit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-settlement-deposit-'))

  try {
    const source = await PersistentBlockProcessor.open(join(root, 'source'), {
      depositBackingProvider: createStaticDepositBackingProvider([makeRecord()]),
    })
    const genesis = await source.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const genesisEnvelope = createEvmSettlementEnvelope(genesis.blockRlpHex)
    const operation = createEvmDepositOperation(makeRecord())
    const child = await source.buildNextBlock(
      [],
      GENESIS_TIMESTAMP + 1n,
      [operation],
    )
    const childEnvelope = createEvmSettlementEnvelope(
      child.blockRlpHex,
      genesisEnvelope.commitmentHash,
      [operation],
    )

    assert.deepEqual(childEnvelope.depositOperations, [operation])
    assert.equal(
      verifyEvmSettlementEnvelope(
        childEnvelope,
        genesisEnvelope.commitmentHash,
        genesisEnvelope.blockHash,
      ).commitmentHash,
      childEnvelope.commitmentHash,
    )

    const batch = createEvmSettlementBatch([genesisEnvelope, childEnvelope])
    const replay = await verifyEvmSettlementBatchExecution(
      batch,
      ZERO_COMMITMENT,
      ZERO_HASH,
      '0',
    )

    assert.equal(replay.executionVerified, true)
    assert.equal(replay.childBlocksReexecuted, 1)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('checkpoint settlement replay applies deposit operations after the checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-settlement-checkpoint-deposit-'))

  try {
    const secondTxid = 'c'.repeat(64)
    const secondRecord: BtcsL1DepositRecord = {
      ...makeRecord(),
      depositId: `${secondTxid}:0`,
      txid: secondTxid,
      recipientAddress: `0x${'2'.repeat(40)}`,
      blockHash: 'd'.repeat(64),
      blockHeight: 201,
    }
    const source = await PersistentBlockProcessor.open(join(root, 'source'), {
      depositBackingProvider: createStaticDepositBackingProvider([
        makeRecord(),
        secondRecord,
      ]),
    })
    const genesis = await source.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)

    const genesisEnvelope = createEvmSettlementEnvelope(genesis.blockRlpHex)
    const firstOperation = createEvmDepositOperation(makeRecord())
    const checkpointBlock = await source.buildNextBlock(
      [],
      GENESIS_TIMESTAMP + 1n,
      [firstOperation],
    )
    const checkpointEnvelope = createEvmSettlementEnvelope(
      checkpointBlock.blockRlpHex,
      genesisEnvelope.commitmentHash,
      [firstOperation],
    )

    const checkpointDirectory = join(root, 'checkpoint')
    await source.exportStateCheckpoint(checkpointDirectory)

    const secondOperation = createEvmDepositOperation(secondRecord)

    const child = await source.buildNextBlock(
      [],
      GENESIS_TIMESTAMP + 2n,
      [secondOperation],
    )
    const childEnvelope = createEvmSettlementEnvelope(
      child.blockRlpHex,
      checkpointEnvelope.commitmentHash,
      [secondOperation],
    )
    const batch = createEvmSettlementBatch([childEnvelope])
    const canonicalView = await source.createCanonicalReadView()

    const replay = await verifyEvmSettlementBatchExecutionFromCheckpoint(
      batch,
      checkpointEnvelope.commitmentHash,
      checkpointEnvelope.blockHash,
      '2',
      checkpointDirectory,
      canonicalView,
    )

    assert.equal(replay.executionVerified, true)
    assert.equal(replay.startHeight, '2')
    assert.equal(replay.endHeight, '2')
    assert.equal(replay.childBlocksReexecuted, 1)
    assert.equal(replay.blocksVerified, 1)
    assert.equal(child.summary.stateRoot, childEnvelope.stateRoot)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('settlement envelope rejects a missing or altered deposit operation list', async () => {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-settlement-deposit-tamper-'))

  try {
    const source = await PersistentBlockProcessor.open(join(root, 'source'), {
      depositBackingProvider: createStaticDepositBackingProvider([makeRecord()]),
    })
    const operation = createEvmDepositOperation(makeRecord())
    const child = await source.buildNextBlock(
      [],
      GENESIS_TIMESTAMP + 1n,
      [operation],
    )

    assert.throws(
      () => createEvmSettlementEnvelope(child.blockRlpHex),
      /block has deposit commitment data but no deposit operations/,
    )

    const genesis = await source.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const genesisEnvelope = createEvmSettlementEnvelope(genesis.blockRlpHex)
    const envelope = createEvmSettlementEnvelope(
      child.blockRlpHex,
      genesisEnvelope.commitmentHash,
      [operation],
    )

    const altered = {
      ...envelope,
      depositOperations: [{
        ...operation,
        recipientAddress: `0x${'2'.repeat(40)}`,
      }],
    }

    assert.throws(
      () => verifyEvmSettlementEnvelope(
        altered,
        genesisEnvelope.commitmentHash,
        genesisEnvelope.blockHash,
      ),
      /do not match the block-header commitment/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
