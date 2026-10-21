import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import { Address, bytesToHex, createAddressFromPrivateKey, hexToBytes } from '@ethereumjs/util'
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
  classifyCanonicalDepositReorg,
  classifyDepositReorg,
  collectCanonicalDepositCredits,
} from '../src/depositReorgAccounting.js'
import type { CanonicalReadView } from '../src/blockProcessor.js'
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
    const assessment = await assessCreditSpend(view, credits[0]!)
    assert.equal(assessment.status, 'outflow-observed')
    assert.equal(assessment.basis, 'canonical-execution-trace')
    assert.equal(assessment.activity?.kind, 'native-value')
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

test('a complete trace with no post-credit outflow proves the credit was not spent', async () => {
  await withFixture(async ({ store, chain }) => {
    const record = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const operation = createEvmDepositOperation(record)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])

    const view = await chain.createCanonicalReadView()
    const credits = collectCanonicalDepositCredits(view)
    assert.deepEqual(await assessCreditSpend(view, credits[0]!), {
      status: 'no-outflow-observed',
      basis: 'canonical-execution-trace',
    })
    assert.equal(
      await view.getAccountBalance(recipient),
      BigInt(operation.amountWei),
    )
  })
})

test('transaction fees count as outflow even when the transaction transfers no value', async () => {
  await withFixture(async ({ store, chain }) => {
    const record = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const operation = createEvmDepositOperation(record)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])

    const feeOnly = signedByRecipient({ nonce: 0n, to: otherAccount, value: 0n })
    await chain.buildNextBlock([feeOnly], GENESIS_TIMESTAMP + 2n)

    const view = await chain.createCanonicalReadView()
    const credit = collectCanonicalDepositCredits(view)[0]!
    const assessment = await assessCreditSpend(view, credit)
    assert.equal(assessment.status, 'outflow-observed')
    assert.equal(assessment.activity?.kind, 'transaction-fee')
    assert.ok(BigInt(assessment.activity?.amountWei ?? '0') > 0n)
  })
})

test('post-credit outflow is detected even when later funding keeps balance above the credit', async () => {
  await withFixture(async ({ store, chain }) => {
    const firstRecord = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const firstOperation = createEvmDepositOperation(firstRecord)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [firstOperation])

    const spend = signedByRecipient({ nonce: 0n, to: otherAccount, value: 1n })
    await chain.buildNextBlock([spend], GENESIS_TIMESTAMP + 2n)

    const laterRecord = makeRecord({
      depositId: `${'d'.repeat(64)}:0`,
      txid: 'd'.repeat(64),
      recipientAddress: recipient.toString().toLowerCase(),
      amountSats: (BigInt(amountSats) / 2n).toString(10),
      blockHash: 'e'.repeat(64),
      blockHeight: 201,
      confirmations: 8,
    })
    const laterOperation = createEvmDepositOperation(laterRecord)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 3n, [laterOperation])

    const view = await chain.createCanonicalReadView()
    const credits = collectCanonicalDepositCredits(view)
    assert.equal(credits.length, 2)
    assert.ok((await view.getAccountBalance(recipient)) > BigInt(firstOperation.amountWei))

    const firstAssessment = await assessCreditSpend(view, credits[0]!)
    assert.equal(firstAssessment.status, 'outflow-observed')
    assert.equal(firstAssessment.activity?.blockNumber, 2n)
    assert.equal(firstAssessment.activity?.kind, 'native-value')

    const laterAssessment = await assessCreditSpend(view, credits[1]!)
    assert.deepEqual(laterAssessment, {
      status: 'no-outflow-observed',
      basis: 'canonical-execution-trace',
    })

    await invalidateBtcsL1DepositAfterConfirmedReorg(store, depositId, originalBlockHash)
    const classification = await classifyCanonicalDepositReorg({
      depositId,
      view,
      l1: store.get(depositId),
      credit: credits[0],
    })
    assert.equal(classification.spendAssessment?.status, 'outflow-observed')
    assert.equal(classification.plan.action, 'freeze-bridge')

    const laterClassification = await classifyCanonicalDepositReorg({
      depositId: credits[1]!.depositId,
      view,
      l1: undefined,
      credit: credits[1],
    })
    assert.equal(laterClassification.spendAssessment?.status, 'no-outflow-observed')
    assert.equal(laterClassification.plan.action, 'revert-l2-credit')
  })
})

test('incomplete spend traces freeze an unbacked credit instead of assuming it was untouched', async () => {
  const credit = creditForRecord(makeRecord())
  const view = {
    getSpendActivitySince: () => undefined,
    spendTraceComplete: false,
    async getAccountBalance() {
      return BigInt(credit.amountWei)
    },
  } as unknown as CanonicalReadView

  const classification = await classifyCanonicalDepositReorg({
    depositId: credit.depositId,
    view,
    l1: undefined,
    credit,
  })
  assert.equal(classification.spendAssessment?.status, 'unknown')
  assert.equal(classification.plan.action, 'freeze-bridge')
})

test('canonical execution tracing observes a value transfer from a credited contract', async () => {
  await withFixture(async ({ store, chain }) => {
    const deployerRecord = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const deployerOperation = createEvmDepositOperation(deployerRecord)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [deployerOperation])

    const runtime = Uint8Array.from([
      0x60, 0x00, // return data length
      0x60, 0x00, // return data offset
      0x60, 0x00, // input data length
      0x60, 0x00, // input data offset
      0x60, 0x01, // value
      0x73, ...otherAccount.bytes, // recipient
      0x61, 0xff, 0xff, // gas
      0xf1, // CALL
      0x50, // POP result
      0x00, // STOP
    ])
    const initCode = Uint8Array.from([
      0x60, runtime.length,
      0x60, 0x0c,
      0x60, 0x00,
      0x39,
      0x60, runtime.length,
      0x60, 0x00,
      0xf3,
      ...runtime,
    ])
    const deploy = createFeeMarket1559Tx({
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 300_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      value: 0n,
      data: initCode,
    }, { common: createHarnessCommon() }).sign(recipientKey)
    const deploymentBlock = await chain.buildNextBlock([deploy], GENESIS_TIMESTAMP + 2n)
    const contractAddressHex = deploymentBlock.summary.receipts[0]?.createdAddress
    assert.ok(contractAddressHex)
    const contractAddress = new Address(hexToBytes(contractAddressHex as `0x${string}`))

    const contractRecord = makeRecord({
      depositId: `${'f'.repeat(64)}:0`,
      txid: 'f'.repeat(64),
      recipientAddress: contractAddress.toString().toLowerCase(),
      amountSats: '100',
      blockHash: 'e'.repeat(64),
      blockHeight: 202,
      confirmations: 8,
    })
    const contractOperation = createEvmDepositOperation(contractRecord)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 3n, [contractOperation])

    const invoke = createFeeMarket1559Tx({
      chainId: EVM_CHAIN_ID,
      nonce: 1n,
      gasLimit: 150_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      to: contractAddress,
      value: 0n,
    }, { common: createHarnessCommon() }).sign(recipientKey)
    const invocationBlock = await chain.buildNextBlock([invoke], GENESIS_TIMESTAMP + 4n)
    assert.equal(invocationBlock.summary.receipts[0]?.status, 1)

    const view = await chain.createCanonicalReadView()
    const contractCredit = collectCanonicalDepositCredits(view).find(
      (credit) => credit.depositId === contractOperation.depositId,
    )
    assert.ok(contractCredit)
    const assessment = await assessCreditSpend(view, contractCredit)
    assert.equal(assessment.status, 'outflow-observed')
    assert.equal(assessment.activity?.kind, 'native-value')
    assert.equal(assessment.activity?.amountWei, '1')
    assert.equal(assessment.activity?.transactionIndex, 0)
    assert.equal(assessment.activity?.transactionHash, bytesToHex(invoke.hash()).toLowerCase())
    assert.equal(assessment.activity?.blockNumber, 4n)
  })
})

test('canonical execution tracing observes a credited contract selfdestruct', async () => {
  await withFixture(async ({ store, chain }) => {
    const deployerRecord = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const deployerOperation = createEvmDepositOperation(deployerRecord)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [deployerOperation])

    const runtime = Uint8Array.from([0x73, ...otherAccount.bytes, 0xff])
    const initCode = Uint8Array.from([
      0x60, runtime.length,
      0x60, 0x0c,
      0x60, 0x00,
      0x39,
      0x60, runtime.length,
      0x60, 0x00,
      0xf3,
      ...runtime,
    ])
    const deploy = createFeeMarket1559Tx({
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 300_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      value: 0n,
      data: initCode,
    }, { common: createHarnessCommon() }).sign(recipientKey)
    const deploymentBlock = await chain.buildNextBlock([deploy], GENESIS_TIMESTAMP + 2n)
    const contractAddressHex = deploymentBlock.summary.receipts[0]?.createdAddress
    assert.ok(contractAddressHex)
    const contractAddress = new Address(hexToBytes(contractAddressHex as `0x${string}`))

    const contractRecord = makeRecord({
      depositId: `${'8'.repeat(64)}:0`,
      txid: '8'.repeat(64),
      recipientAddress: contractAddress.toString().toLowerCase(),
      amountSats: '100',
      blockHash: '9'.repeat(64),
      blockHeight: 203,
      confirmations: 8,
    })
    const contractOperation = createEvmDepositOperation(contractRecord)
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 3n, [contractOperation])

    const invoke = createFeeMarket1559Tx({
      chainId: EVM_CHAIN_ID,
      nonce: 1n,
      gasLimit: 100_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      to: contractAddress,
      value: 0n,
    }, { common: createHarnessCommon() }).sign(recipientKey)
    await chain.buildNextBlock([invoke], GENESIS_TIMESTAMP + 4n)

    const view = await chain.createCanonicalReadView()
    const credit = collectCanonicalDepositCredits(view).find(
      (candidate) => candidate.depositId === contractOperation.depositId,
    )
    assert.ok(credit)
    const assessment = await assessCreditSpend(view, credit)
    assert.equal(assessment.status, 'outflow-observed')
    assert.equal(assessment.activity?.kind, 'selfdestruct')
    assert.equal(assessment.activity?.transactionIndex, 0)
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
