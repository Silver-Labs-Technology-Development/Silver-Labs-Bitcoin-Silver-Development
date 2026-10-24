import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { importEvmSettlementBatchFile } from '../src/settlementBatchFile.js'
import {
  runClientDemo,
  type ClientDemoSummary,
} from '../scripts/demo-client.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ZERO_COMMITMENT = /^[0-9a-f]{64}$/
const TX_HASH = /^0x[0-9a-f]{64}$/
const ADDRESS = /^0x[0-9a-f]{40}$/

function assertSummaryShape(summary: ClientDemoSummary): void {
  assert.equal(summary.format, 'btcs-l2-client-demo-summary')
  assert.equal(summary.version, 1)
  assert.equal(summary.chainId, 31337)
  assert.match(summary.deployTx.hash, TX_HASH)
  assert.match(summary.deployTx.contractAddress, ADDRESS)
  assert.match(summary.incrementTx.hash, TX_HASH)
  assert.equal(summary.incrementTx.status, 1)
  assert.match(summary.revertedTx.hash, TX_HASH)
  assert.equal(summary.revertedTx.status, 0)
  assert.match(summary.transferTx.hash, TX_HASH)
  assert.equal(summary.transferTx.status, 1)
  assert.equal(summary.blockNumber, 1)
  assert.equal(summary.reads.storageValue, '1')
  assert.equal(summary.reads.incrementLogCount, 1)
  assert.equal(summary.reads.revertLogCount, 0)
  assert.equal(summary.reads.senderNonce, 4)
  assert.match(summary.reads.recipientBalanceWei, /^[0-9]+$/)
  assert.equal(summary.settlement.version, 'v2')
  assert.equal(summary.settlement.startHeight, '0')
  assert.equal(summary.settlement.endHeight, '1')
  assert.equal(summary.settlement.blocksVerified, 2)
  assert.equal(summary.settlement.childBlocksReexecuted, 1)
  assert.equal(summary.settlement.executionVerified, true)
  assert.match(summary.settlement.batchHash, ZERO_COMMITMENT)
  assert.equal(summary.notes.whatThisProves.length, 4)
  assert.equal(summary.notes.doesNotProve.length, 4)
}

test('client demo runs headlessly and produces the required summary shape', async () => {
  const summary = await runClientDemo()
  try {
    assertSummaryShape(summary)

    // The default artifact must survive the temporary chain-data cleanup.
    await access(summary.batchFilePath)

    const imported = await importEvmSettlementBatchFile(summary.batchFilePath, {
      previousCommitment: '0'.repeat(64),
      parentHash: ZERO_HASH,
      startHeight: '0',
    })
    assert.equal(imported.batchHash, summary.settlement.batchHash)
  } finally {
    await rm(dirname(summary.batchFilePath), { recursive: true, force: true })
  }
})

test('client demo emits a batch file the standalone verifier accepts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-client-demo-verify-'))
  try {
    const batchFilePath = join(directory, 'batch.json')
    const summary = await runClientDemo({ batchOut: batchFilePath })
    assertSummaryShape(summary)

    const imported = await importEvmSettlementBatchFile(batchFilePath, {
      previousCommitment: '0'.repeat(64),
      parentHash: ZERO_HASH,
      startHeight: '0',
    })
    assert.equal(imported.batchHash, summary.settlement.batchHash)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})