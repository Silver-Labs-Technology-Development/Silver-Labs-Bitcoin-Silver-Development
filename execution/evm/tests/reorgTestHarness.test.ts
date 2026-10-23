import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BtcsL1DepositRecord } from '../src/btcsL1DepositStore.js'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import {
  calculateDepositAccounting,
  classifyDepositReorg,
} from '../src/depositReorgAccounting.js'
import { rederiveCanonicalL2AfterDepositInvalidation } from '../src/depositReorgRecovery.js'

const SATOSHI_TO_WEI = 10n ** 10n

function makeRecord(overrides: Partial<BtcsL1DepositRecord> = {}): BtcsL1DepositRecord {
  return {
    format: 'btcs-l2-btcs-l1-deposit-record',
    version: 1,
    depositId: `${'a'.repeat(64)}:1`,
    txid: 'a'.repeat(64),
    depositOutputIndex: 1,
    recipientAddress: `0x${'1'.repeat(40)}`,
    amountSats: '125000000',
    requiredConfirmations: 6,
    state: 'confirmed' as const,
    blockHeight: 200,
    confirmations: 8,
    blockHash: 'a'.repeat(64),
    ...overrides,
  }
}

function creditForRecord(record: BtcsL1DepositRecord, overrides: Partial<any> = {}): any {
  return {
    depositId: record.depositId,
    recipientAddress: record.recipientAddress,
    amountWei: (BigInt(record.amountSats) * SATOSHI_TO_WEI).toString(10),
    sourceBlockHash: record.blockHash ?? 'b'.repeat(64),
    creditedAtBlock: '1',
    ...overrides,
  }
}

async function withFixture(body: (ctx: { store: any; chain: any; addBacking: any }) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-reorg-test-'))
  try {
    const store = await (await import('../src/btcsL1DepositStore.js')).BtcsL1DepositStore.create(join(root, 'deposits'))
    const extraBacking = new Map<string, BtcsL1DepositRecord>()
    const chain = await PersistentBlockProcessor.open(join(root, 'chain'), {
      depositBackingProvider: {
        get: (depositId: string) => store.get(depositId) ?? extraBacking.get(depositId),
      },
    })
    const addBacking = (record: BtcsL1DepositRecord) => extraBacking.set(record.depositId, record)
    await body({ store, chain, addBacking })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('reorg scenario: before dispute - commitment invalidation', async () => {
  await withFixture(async ({ store, chain, addBacking }) => {
    const record = makeRecord()
    addBacking(record)
    const initialCredit = creditForRecord(record)
    const initialReport = calculateDepositAccounting({ secured: [record], credits: [initialCredit] })
    assert.equal(initialReport.status, 'ok', 'Initial state should be ok')
    assert.equal(initialReport.invariantHolds, true)
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: undefined, credit: undefined, creditSpent: false })
    assert.equal(plan.timing, 'reorg-before-credit')
    assert.equal(plan.action, 'invalidate-l1-only')
    const invalidated = makeRecord({ state: 'invalidated', blockHeight: undefined, confirmations: undefined, lastInvalidatedBlockHash: 'b'.repeat(64), blockHash: 'b'.repeat(64) })
    const credit = creditForRecord(invalidated)
    const report = calculateDepositAccounting({ secured: [invalidated], credits: [credit] })
    assert.equal(report.status, 'violated')
    assert.equal(report.progressBlocked, true)
    assert.ok(report.violations.some((v: any) => v.kind === 'unbacked-credit'))
  })
})

test('reorg scenario: after credit before spend - revert L2 credit', async () => {
  await withFixture(async ({ chain, addBacking }) => {
    const record = makeRecord()
    addBacking(record)
    const credit = creditForRecord(record)
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: undefined, credit, creditSpent: false })
    assert.equal(plan.timing, 'after-credit-before-spend')
    assert.equal(plan.action, 'revert-l2-credit')
    assert.equal(plan.progressBlocked, true)
    // Note: rederive requires canonicalView setup, skipped for this test
  })
})

test('reorg scenario: after spend - freeze bridge', async () => {
  await withFixture(async ({ chain, addBacking }) => {
    const record = makeRecord()
    addBacking(record)
    const credit = creditForRecord(record)
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: undefined, credit: { ...credit, amountWei: '1' }, creditSpent: true })
    assert.equal(plan.timing, 'after-spend')
    assert.equal(plan.action, 'freeze-bridge')
    assert.equal(plan.progressBlocked, true)
  })
})

test('reorg scenario: re-inclusion is no-op - same recipient and amount', async () => {
  await withFixture(async ({ chain, addBacking }) => {
    const record = makeRecord()
    addBacking(record)
    const credit = creditForRecord(record)
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: record, credit, creditSpent: false })
    assert.equal(plan.timing, 're-inclusion')
    assert.equal(plan.action, 'no-op')
    assert.equal(plan.progressBlocked, false)
  })
})

test('reorg scenario: same inclusion with wrong recipient reverts credit', async () => {
  await withFixture(async ({ chain, addBacking }) => {
    const record = makeRecord()
    addBacking(record)
    const credit = creditForRecord(record, { recipientAddress: '0x' + '2'.repeat(40) })
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: record, credit, creditSpent: false })
    assert.equal(plan.action, 'revert-l2-credit')
    assert.equal(plan.progressBlocked, true)
    assert.ok(plan.reason.includes('recipient') || plan.reason.includes('amount'), 'Expected reason to include recipient or amount, got: ' + plan.reason)
  })
})

test('reorg scenario: same inclusion with wrong amount freezes after spend', async () => {
  await withFixture(async ({ chain, addBacking }) => {
    const record = makeRecord()
    addBacking(record)
    const credit = creditForRecord(record, { amountWei: (BigInt('125000000') * 2n * SATOSHI_TO_WEI).toString(10) })
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: record, credit, creditSpent: true })
    assert.equal(plan.action, 'freeze-bridge')
    assert.equal(plan.progressBlocked, true)
    assert.ok(plan.reason.includes('recipient') || plan.reason.includes('amount'), 'Expected reason to include recipient or amount, got: ' + plan.reason)
  })
})

test('economic model: deposit accounting invariant after reorg', async () => {
  await withFixture(async ({ store, chain, addBacking }) => {
    const record = makeRecord({ blockHeight: 200, depositId: `${'a'.repeat(64)}:1` })
    addBacking(record)
    const credit1 = creditForRecord(record)
    const report = calculateDepositAccounting({ secured: [record], credits: [credit1] })
    assert.equal(report.status, 'ok')
    assert.equal(report.invariantHolds, true)
    assert.equal(report.backedCreditCount, 1)
    assert.equal(report.creditedWei, report.securedWei)
    assert.equal(report.unbackedCreditedWei, '0')
    // After invalidating the deposit, the invariant should be violated
    const invalidated = makeRecord({ state: 'invalidated', blockHeight: undefined, blockHash: 'b'.repeat(64) })
    const credit = creditForRecord(invalidated)
    const reportAfterReorg = calculateDepositAccounting({ secured: [record], credits: [credit] })
    assert.equal(reportAfterReorg.status, 'violated')
    assert.ok(reportAfterReorg.violations.some((v: any) => v.kind === 'unbacked-credit' || v.kind === 'over-credit'), 'Expected unbacked-credit or over-credit violation, got: ' + JSON.stringify(reportAfterReorg.violations.map(v => v.kind)))
  })
})

test('reorg scenario: l1 confirmed but different blockhash reverts credit', async () => {
  await withFixture(async ({ chain, addBacking }) => {
    // Use a record with undefined blockHash so credit gets 'b'.repeat(64)
    const record = makeRecord({ blockHash: undefined })
    addBacking(record)
    const credit = creditForRecord(record)
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: record, credit, creditSpent: false })
    // When blockHash doesn't match, should revert L2 credit
    assert.equal(plan.action, 'revert-l2-credit')
    assert.equal(plan.progressBlocked, true)
  })
})

test('reorg scenario: confirmed L1 deposit with wrong amount leads to revert', async () => {
  await withFixture(async ({ chain, addBacking }) => {
    // Use confirmed deposit with wrong amount to trigger revert
    const record = makeRecord({ blockHeight: 200 })
    addBacking(record)
    const credit = creditForRecord(record, { amountWei: (BigInt('125000000') * 2n * SATOSHI_TO_WEI).toString(10) })
    const plan = classifyDepositReorg({ depositId: record.depositId, l1: record, credit, creditSpent: false })
    // With wrong amount but confirmed L1, should revert L2 credit
    assert.equal(plan.action, 'revert-l2-credit')
    assert.equal(plan.progressBlocked, true)
  })
})
