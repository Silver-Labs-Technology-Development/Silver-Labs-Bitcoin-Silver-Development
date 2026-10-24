import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  BtcsL1DepositStore,
  BTCS_L1_DEPOSIT_STORE_FILE,
  BTCS_L1_DEPOSIT_STORE_FORMAT,
  type BtcsL1DepositStorePersistenceStage,
} from '../src/btcsL1DepositStore.js'
import type { BtcsL1DepositReport } from '../src/btcsL1Deposit.js'

const txid = '1'.repeat(64)
const blockHash = '2'.repeat(64)
const recipientAddress = `0x${'b'.repeat(40)}`
const depositId = `${txid}:2`

function makeReport(overrides: Partial<BtcsL1DepositReport> = {}): BtcsL1DepositReport {
  const resolvedTxid = overrides.txid ?? txid
  const resolvedIndex = overrides.depositOutputIndex ?? 2
  return {
    format: 'btcs-l2-btcs-l1-deposit-verification',
    version: 1,
    verificationModel: 'trusted-btcs-core-rpc',
    inclusionProofVerified: false,
    depositId: overrides.depositId ?? `${resolvedTxid}:${resolvedIndex}`,
    txid: resolvedTxid,
    blockHash: overrides.blockHash ?? blockHash,
    blockHeight: overrides.blockHeight ?? 120,
    confirmations: overrides.confirmations ?? 6,
    activeChain: true,
    recipientAddress: overrides.recipientAddress ?? recipientAddress,
    amountSats: overrides.amountSats ?? '1234567890',
    depositOutputIndex: resolvedIndex,
    depositVerified: true,
    ...overrides,
  }
}

async function withStore(
  run: (directory: string, store: BtcsL1DepositStore) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l1-deposit-store-test-'))
  try {
    const store = await BtcsL1DepositStore.create(directory)
    await run(directory, store)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('records a verified deposit and recovers it after reopening the store', async () => {
  await withStore(async (directory, store) => {
    const record = await store.recordVerifiedDeposit(makeReport(), 6)
    assert.equal(record.depositId, depositId)
    assert.equal(record.state, 'confirmed')
    assert.equal(record.amountSats, '1234567890')
    assert.equal(record.requiredConfirmations, 6)
    assert.equal(record.confirmations, 6)

    const reopened = await BtcsL1DepositStore.open(directory)
    assert.deepEqual(reopened.get(depositId), record)
    assert.deepEqual(reopened.list(), [record])
  })
})

test('refuses duplicate txid:vout records without modifying the original deposit', async () => {
  await withStore(async (directory, store) => {
    const original = await store.recordVerifiedDeposit(makeReport(), 6)
    await assert.rejects(
      store.recordVerifiedDeposit(makeReport({ blockHash: '3'.repeat(64) }), 6),
      /deposit already exists for this transaction output/,
    )
    const reopened = await BtcsL1DepositStore.open(directory)
    assert.deepEqual(reopened.get(depositId), original)
  })
})

test('rejects unverified, malformed, or under-confirmed reports', async () => {
  await withStore(async (_directory, store) => {
    assert.throws(
      () => store.recordVerifiedDeposit(makeReport({ depositVerified: false } as unknown as Partial<BtcsL1DepositReport>), 6),
      /successful trusted-Core verification/,
    )
    assert.throws(
      () => store.recordVerifiedDeposit(makeReport({ depositId: `${txid}:9` }), 6),
      /inconsistent deposit ID/,
    )
    assert.throws(
      () => store.recordVerifiedDeposit(makeReport({ confirmations: 5 }), 6),
      /does not meet its confirmation requirement/,
    )
  })
})

test('updates confirmations monotonically on the same inclusion only', async () => {
  await withStore(async (_directory, store) => {
    await store.recordVerifiedDeposit(makeReport(), 6)
    const advanced = await store.updateConfirmations(makeReport({ confirmations: 8 }))
    assert.equal(advanced.confirmations, 8)

    await assert.rejects(
      store.updateConfirmations(makeReport({ confirmations: 7 })),
      /confirmation count cannot regress/,
    )
    await assert.rejects(
      store.updateConfirmations(makeReport({ blockHash: '3'.repeat(64), confirmations: 9 })),
      /inclusion changed/,
    )
    await assert.rejects(
      store.updateConfirmations(makeReport({ blockHeight: 121, confirmations: 9 })),
      /inclusion changed/,
    )
  })
})

test('invalidates a reorged inclusion, preserving identity and surviving restart', async () => {
  await withStore(async (directory, store) => {
    await store.recordVerifiedDeposit(makeReport(), 6)
    const invalidated = await store.invalidate(depositId, blockHash)
    assert.equal(invalidated.state, 'invalidated')
    assert.equal(invalidated.lastInvalidatedBlockHash, blockHash)
    assert.equal('blockHash' in invalidated, false)
    assert.equal('confirmations' in invalidated, false)

    const reopened = await BtcsL1DepositStore.open(directory)
    assert.deepEqual(reopened.get(depositId), invalidated)
  })
})

test('stale reorg invalidation cannot clear an inclusion that has changed', async () => {
  await withStore(async (_directory, store) => {
    await store.recordVerifiedDeposit(makeReport(), 6)
    await assert.rejects(
      store.invalidate(depositId, '3'.repeat(64)),
      /inclusion changed before invalidation/,
    )
    assert.equal(store.get(depositId)?.state, 'confirmed')
  })
})

test('requires invalidation before re-observation and preserves the same deposit identity', async () => {
  await withStore(async (directory, store) => {
    await store.recordVerifiedDeposit(makeReport(), 6)
    const replacementBlock = '4'.repeat(64)
    await assert.rejects(store.reobserve(makeReport({ blockHash: replacementBlock })), /must be invalidated/)

    await store.invalidate(depositId, blockHash)
    const reobserved = await store.reobserve(makeReport({
      blockHash: replacementBlock,
      blockHeight: 125,
      confirmations: 6,
    }))
    assert.equal(reobserved.depositId, depositId)
    assert.equal(reobserved.state, 'confirmed')
    assert.equal(reobserved.blockHash, replacementBlock)
    assert.equal(reobserved.blockHeight, 125)
    assert.equal(reobserved.lastInvalidatedBlockHash, blockHash)

    const reopened = await BtcsL1DepositStore.open(directory)
    assert.deepEqual(reopened.get(depositId), reobserved)
    assert.equal(reopened.list().length, 1)
  })
})

test('re-observation rejects an altered recipient or amount after a reorg', async () => {
  await withStore(async (_directory, store) => {
    await store.recordVerifiedDeposit(makeReport(), 6)
    await store.invalidate(depositId, blockHash)

    await assert.rejects(
      store.reobserve(makeReport({ blockHash: '4'.repeat(64), recipientAddress: `0x${'c'.repeat(40)}` })),
      /does not match the stored deposit identity and amount/,
    )
    await assert.rejects(
      store.reobserve(makeReport({ blockHash: '4'.repeat(64), amountSats: '1234567891' })),
      /does not match the stored deposit identity and amount/,
    )
    assert.equal(store.get(depositId)?.state, 'invalidated')
  })
})

test('opening a missing store snapshot fails closed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l1-deposit-missing-'))
  try {
    await assert.rejects(BtcsL1DepositStore.open(directory))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('corrupt JSON and unsupported versions are rejected without reinitialization', async () => {
  await withStore(async (directory) => {
    const path = join(directory, BTCS_L1_DEPOSIT_STORE_FILE)
    await writeFile(path, '{not json\n', 'utf8')
    await assert.rejects(BtcsL1DepositStore.open(directory), /invalid JSON/)

    await writeFile(path, JSON.stringify({
      format: BTCS_L1_DEPOSIT_STORE_FORMAT,
      version: 99,
      records: [],
    }), 'utf8')
    await assert.rejects(BtcsL1DepositStore.open(directory), /unsupported deposit store format or version/)
    const raw = await readFile(path, 'utf8')
    assert.match(raw, /99/)
  })
})

test('pre-rename persistence failure leaves old state intact and permits retry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l1-deposit-pre-rename-'))
  try {
    await BtcsL1DepositStore.create(directory)
    let shouldFail = true
    const store = await BtcsL1DepositStore.open(directory, {
      persistenceTestHook(stage: BtcsL1DepositStorePersistenceStage) {
        if (shouldFail && stage === 'before-rename') {
          shouldFail = false
          throw new Error('injected pre-rename failure')
        }
      },
    })
    await assert.rejects(store.recordVerifiedDeposit(makeReport(), 6), /injected pre-rename failure/)
    assert.equal(store.list().length, 0)
    const retry = await store.recordVerifiedDeposit(makeReport(), 6)
    assert.equal(retry.state, 'confirmed')
    assert.deepEqual((await BtcsL1DepositStore.open(directory)).list(), [retry])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('post-rename failure requires reopening before further store access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l1-deposit-post-rename-'))
  try {
    await BtcsL1DepositStore.create(directory)
    let shouldFail = true
    const store = await BtcsL1DepositStore.open(directory, {
      persistenceTestHook(stage: BtcsL1DepositStorePersistenceStage) {
        if (shouldFail && stage === 'renamed') {
          shouldFail = false
          throw new Error('injected post-rename failure')
        }
      },
    })
    await assert.rejects(store.recordVerifiedDeposit(makeReport(), 6), /injected post-rename failure/)
    assert.throws(() => store.list(), /persistence outcome is uncertain/)

    const reopened = await BtcsL1DepositStore.open(directory)
    assert.equal(reopened.get(depositId)?.state, 'confirmed')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
