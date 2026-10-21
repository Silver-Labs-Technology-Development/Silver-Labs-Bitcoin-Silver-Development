import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import { Address, createAddressFromPrivateKey, hexToBytes } from '@ethereumjs/util'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
} from '../src/blockProcessor.js'
import { EVM_CHAIN_ID, createHarnessCommon } from '../src/config.js'
import { encodeBtcsL1DepositScript } from '../src/btcsL1Deposit.js'
import {
  invalidateBtcsL1DepositAfterConfirmedReorg,
  verifyAndRecordBtcsL1Deposit,
} from '../src/btcsL1DepositWorkflow.js'
import {
  BTCS_L1_DEPOSIT_RECORD_FORMAT,
  BTCS_L1_DEPOSIT_RECORD_VERSION,
  BtcsL1DepositStore,
} from '../src/btcsL1DepositStore.js'
import { createEvmDepositOperation } from '../src/depositPrelude.js'
import {
  assessCreditSpend,
  calculateDepositAccounting,
  classifyDepositReorg,
  collectCanonicalDepositCredits,
} from '../src/depositReorgAccounting.js'
import type { DepositCredit } from '../src/depositReorgAccounting.js'
import type { BtcsL1DepositRecord } from '../src/btcsL1DepositStore.js'
import type {
  BtcsL1DepositRequest,
  BtcsL1DepositRpc,
} from '../src/btcsL1Deposit.js'

const SATOSHI_TO_WEI = 10n ** 10n
const recipientKey = hexToBytes(`0x${'22'.repeat(32)}`)
const recipient = createAddressFromPrivateKey(recipientKey)
const otherAccount = new Address(hexToBytes(`0x${'33'.repeat(20)}`))

const txid = 'a'.repeat(64)
const originalBlockHash = 'b'.repeat(64)
const replacementBlockHash = 'c'.repeat(64)
const depositScriptPubKeyHex = `0014${recipient.toString().slice(2)}`
const amountSats = '125000000'
const depositId = `${txid}:1`

function request(blockHash = originalBlockHash): BtcsL1DepositRequest {
  return {
    txid,
    blockHash,
    recipientAddress: recipient.toString(),
    depositScriptPubKeyHex,
    requiredConfirmations: 6,
  }
}

function makeRpc(options: {
  inActiveChain?: boolean
  confirmations?: number
  value?: number
} = {}): BtcsL1DepositRpc {
  const confirmations = options.confirmations ?? 8
  return {
    async getRawTransaction(requestedTxid, requestedBlockHash) {
      return {
        txid: requestedTxid,
        blockhash: requestedBlockHash,
        in_active_chain: options.inActiveChain ?? true,
        confirmations,
        vout: [
          {
            n: 0,
            value: 0,
            scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient.toString()) },
          },
          {
            n: 1,
            value: options.value ?? 1.25,
            scriptPubKey: { hex: depositScriptPubKeyHex },
          },
        ],
      }
    },
    async getBlockHeader(requestedBlockHash) {
      return { hash: requestedBlockHash, height: 200, confirmations }
    },
  }
}

function signedByRecipient(options: Readonly<{
  nonce: bigint
  to: Address
  value: bigint
}>) {
  return createFeeMarket1559Tx({
    chainId: EVM_CHAIN_ID,
    nonce: options.nonce,
    gasLimit: 21_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    to: options.to,
    value: options.value,
  }, { common: createHarnessCommon() }).sign(recipientKey)
}

async function withFixture(
  body: (context: {
    store: BtcsL1DepositStore
    chain: PersistentBlockProcessor
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-deposit-accounting-'))
  try {
    const store = await BtcsL1DepositStore.create(join(root, 'deposits'))
    const chain = await PersistentBlockProcessor.open(join(root, 'chain'))
    await body({ store, chain })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function makeRecord(
  overrides: Partial<BtcsL1DepositRecord> = {},
): BtcsL1DepositRecord {
  return {
    format: BTCS_L1_DEPOSIT_RECORD_FORMAT,
    version: BTCS_L1_DEPOSIT_RECORD_VERSION,
    depositId: `${'a'.repeat(64)}:0`,
    txid: 'a'.repeat(64),
    depositOutputIndex: 0,
    recipientAddress: `0x${'1'.repeat(40)}`,
    amountSats,
    requiredConfirmations: 6,
    state: 'confirmed',
    blockHash: 'b'.repeat(64),
    blockHeight: 200,
    confirmations: 8,
    ...overrides,
  }
}

function creditForRecord(
  record: BtcsL1DepositRecord,
  overrides: Partial<DepositCredit> = {},
): DepositCredit {
  return {
    depositId: record.depositId,
    recipientAddress: record.recipientAddress,
    amountWei: (BigInt(record.amountSats) * SATOSHI_TO_WEI).toString(10),
    sourceBlockHash: record.blockHash ?? 'b'.repeat(64),
    creditedAtBlock: '1',
    ...overrides,
  }
}

test('accounting holds when every L2 credit is backed by a confirmed L1 deposit', () => {
  const record = makeRecord()
  const credit = creditForRecord(record)
  const report = calculateDepositAccounting({ secured: [record], credits: [credit] })
  assert.equal(report.status, 'ok')
  assert.equal(report.invariantHolds, true)
  assert.equal(report.progressBlocked, false)
  assert.equal(report.backedCreditCount, 1)
  assert.equal(report.creditedWei, (BigInt(amountSats) * SATOSHI_TO_WEI).toString(10))
  assert.equal(report.securedWei, report.creditedWei)
  assert.equal(report.unbackedCreditedWei, '0')
})

test('an L2 credit whose L1 inclusion was invalidated is reported unbacked', () => {
  const invalidated = makeRecord({
    state: 'invalidated',
    blockHash: undefined,
    blockHeight: undefined,
    confirmations: undefined,
    lastInvalidatedBlockHash: 'b'.repeat(64),
  })
  const credit = creditForRecord(makeRecord())
  const report = calculateDepositAccounting({ secured: [invalidated], credits: [credit] })
  assert.equal(report.status, 'violated')
  assert.equal(report.progressBlocked, true)
  assert.equal(report.securedWei, '0')
  assert.equal(report.unbackedCreditedWei, credit.amountWei)
  assert.ok(report.violations.some((violation) => violation.kind === 'unbacked-credit'))
})

test('a credit amount that differs from its confirmed L1 deposit is reported', () => {
  const record = makeRecord()
  const credit = creditForRecord(record, {
    amountWei: (BigInt(amountSats) * 2n * SATOSHI_TO_WEI).toString(10),
  })
  const report = calculateDepositAccounting({ secured: [record], credits: [credit] })
  assert.equal(report.status, 'violated')
  assert.ok(report.violations.some((violation) => violation.kind === 'amount-mismatch'))
})

test('a duplicated canonical credit is detected', () => {
  const record = makeRecord()
  const credit = creditForRecord(record)
  const report = calculateDepositAccounting({ secured: [record], credits: [credit, credit] })
  assert.equal(report.status, 'violated')
  assert.ok(report.violations.some((violation) => violation.kind === 'duplicate-credit'))
})

test('total L2 credit exceeding total confirmed L1 backing is reported', () => {
  const record = makeRecord()
  const backed = creditForRecord(record)
  const unbacked: DepositCredit = {
    depositId: `${'9'.repeat(64)}:0`,
    recipientAddress: record.recipientAddress,
    amountWei: (BigInt(amountSats) * 2n * SATOSHI_TO_WEI).toString(10),
    sourceBlockHash: 'd'.repeat(64),
    creditedAtBlock: '1',
  }
  const report = calculateDepositAccounting({ secured: [record], credits: [backed, unbacked] })
  assert.equal(report.status, 'violated')
  assert.ok(report.violations.some((violation) => violation.kind === 'over-credit'))
})

test('classify: reorg before credit is an L1-only invalidation', () => {
  const plan = classifyDepositReorg({
    depositId,
    l1: undefined,
    credit: undefined,
    creditSpent: false,
  })
  assert.equal(plan.timing, 'reorg-before-credit')
  assert.equal(plan.action, 'invalidate-l1-only')
  assert.equal(plan.progressBlocked, false)
})

test('classify: reorg after credit before spend requires reverting the credit', () => {
  const credit = creditForRecord(makeRecord())
  const plan = classifyDepositReorg({
    depositId,
    l1: undefined,
    credit,
    creditSpent: false,
  })
  assert.equal(plan.timing, 'after-credit-before-spend')
  assert.equal(plan.action, 'revert-l2-credit')
  assert.equal(plan.progressBlocked, true)
  assert.equal(plan.rederiveFromBlock, credit.creditedAtBlock)
})

test('classify: reorg after a spent credit freezes the bridge', () => {
  const credit = creditForRecord(makeRecord())
  const plan = classifyDepositReorg({
    depositId,
    l1: undefined,
    credit,
    creditSpent: true,
  })
  assert.equal(plan.timing, 'after-spend')
  assert.equal(plan.action, 'freeze-bridge')
  assert.equal(plan.progressBlocked, true)
  assert.equal(plan.rederiveFromBlock, undefined)
})

test('classify: same inclusion confirmed again is a no-op', () => {
  const record = makeRecord()
  const plan = classifyDepositReorg({
    depositId,
    l1: record,
    credit: creditForRecord(record),
    creditSpent: false,
  })
  assert.equal(plan.timing, 're-inclusion')
  assert.equal(plan.action, 'no-op')
  assert.equal(plan.progressBlocked, false)
})

test('classify: a confirmed deposit with no credit is credited once', () => {
  const plan = classifyDepositReorg({
    depositId,
    l1: makeRecord(),
    credit: undefined,
    creditSpent: false,
  })
  assert.equal(plan.timing, 'none')
  assert.equal(plan.action, 'credit-l2-once')
  assert.equal(plan.progressBlocked, false)
})

test('classify: a new confirmed inclusion reverts the stale credit', () => {
  const plan = classifyDepositReorg({
    depositId,
    l1: makeRecord({ blockHash: replacementBlockHash }),
    credit: creditForRecord(makeRecord()),
    creditSpent: false,
  })
  assert.equal(plan.timing, 're-inclusion')
  assert.equal(plan.action, 'revert-l2-credit')
  assert.equal(plan.progressBlocked, true)
})

test('a credited deposit keeps the invariant until its L1 inclusion is invalidated', async () => {
  await withFixture(async ({ store, chain }) => {
    const record = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const operation = createEvmDepositOperation(record)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])

    const view = await chain.createCanonicalReadView()
    const credits = collectCanonicalDepositCredits(view)
    assert.equal(credits.length, 1)
    assert.equal(credits[0]!.creditedAtBlock, '1')

    const healthy = calculateDepositAccounting({ secured: store.list(), credits })
    assert.equal(healthy.status, 'ok')
    assert.equal(healthy.backedCreditCount, 1)
    assert.equal(healthy.creditedWei, operation.amountWei)

    await invalidateBtcsL1DepositAfterConfirmedReorg(store, depositId, originalBlockHash)

    const violated = calculateDepositAccounting({ secured: store.list(), credits })
    assert.equal(violated.status, 'violated')
    assert.equal(violated.progressBlocked, true)
    assert.ok(violated.violations.some((violation) => violation.kind === 'unbacked-credit'))

    const plan = classifyDepositReorg({
      depositId,
      l1: store.get(depositId),
      credit: credits[0],
      creditSpent: false,
    })
    assert.equal(plan.timing, 'after-credit-before-spend')
    assert.equal(plan.action, 'revert-l2-credit')
    assert.equal(plan.rederiveFromBlock, '1')
  })
})

test('a reorganized-out deposit whose credit was spent freezes the bridge', async () => {
  await withFixture(async ({ store, chain }) => {
    const record = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const operation = createEvmDepositOperation(record)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])

    const spend = signedByRecipient({
      nonce: 0n,
      to: otherAccount,
      value: BigInt(operation.amountWei) / 2n,
    })
    await chain.buildNextBlock([spend], GENESIS_TIMESTAMP + 2n)

    await invalidateBtcsL1DepositAfterConfirmedReorg(store, depositId, originalBlockHash)

    const view = await chain.createCanonicalReadView()
    const credits = collectCanonicalDepositCredits(view)
    assert.equal(await assessCreditSpend(view, credits[0]!), 'spent')
    assert.ok(
      (await view.getAccountBalance(recipient)) < BigInt(operation.amountWei),
    )

    const plan = classifyDepositReorg({
      depositId,
      l1: store.get(depositId),
      credit: credits[0],
      creditSpent: true,
    })
    assert.equal(plan.timing, 'after-spend')
    assert.equal(plan.action, 'freeze-bridge')
    assert.equal(plan.progressBlocked, true)
  })
})

test('an untouched credited deposit is only unknown spend evidence', async () => {
  await withFixture(async ({ store, chain }) => {
    const record = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const operation = createEvmDepositOperation(record)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])

    const view = await chain.createCanonicalReadView()
    const credits = collectCanonicalDepositCredits(view)
    assert.equal(await assessCreditSpend(view, credits[0]!), 'unknown')
    assert.equal(
      await view.getAccountBalance(recipient),
      BigInt(operation.amountWei),
    )
  })
})

test('re-observation under a new inclusion reverts the stale credit', async () => {
  await withFixture(async ({ store, chain }) => {
    const record = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const operation = createEvmDepositOperation(record)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])

    await invalidateBtcsL1DepositAfterConfirmedReorg(store, depositId, originalBlockHash)
    const recovered = await verifyAndRecordBtcsL1Deposit(
      makeRpc(),
      store,
      request(replacementBlockHash),
    )
    assert.equal(recovered.blockHash, replacementBlockHash)

    const view = await chain.createCanonicalReadView()
    const credits = collectCanonicalDepositCredits(view)
    const plan = classifyDepositReorg({
      depositId,
      l1: store.get(depositId),
      credit: credits[0],
      creditSpent: false,
    })
    assert.equal(plan.timing, 're-inclusion')
    assert.equal(plan.action, 'revert-l2-credit')
    assert.equal(plan.progressBlocked, true)
  })
})
