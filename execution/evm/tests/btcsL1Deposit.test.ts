import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  decodeBtcsL1DepositPayload,
  decodeBtcsL1DepositScript,
  encodeBtcsL1DepositPayload,
  encodeBtcsL1DepositScript,
  verifyBtcsL1Deposit,
  type BtcsL1DepositRequest,
  type BtcsL1DepositRpc,
} from '../src/btcsL1Deposit.js'

const txid = '1'.repeat(64)
const blockHash = '2'.repeat(64)
const recipient = `0x${'b'.repeat(40)}`
const depositScript = `0014${'a'.repeat(40)}`
const request: BtcsL1DepositRequest = {
  txid,
  blockHash,
  recipientAddress: recipient,
  depositScriptPubKeyHex: depositScript,
  requiredConfirmations: 6,
}

function makeOutputs(options: {
  intentScript?: string
  includeIntent?: boolean
  includePayment?: boolean
  paymentValue?: number
  extraIntent?: boolean
  extraPayment?: boolean
} = {}): unknown[] {
  const outputs: unknown[] = []
  if (options.includeIntent !== false) {
    outputs.push({
      n: 0,
      value: 0,
      scriptPubKey: { hex: options.intentScript ?? encodeBtcsL1DepositScript(recipient) },
    })
  }
  if (options.extraIntent) {
    outputs.push({
      n: 1,
      value: 0,
      scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) },
    })
  }
  if (options.includePayment !== false) {
    outputs.push({
      n: 2,
      value: options.paymentValue ?? 12.3456789,
      scriptPubKey: { hex: depositScript },
    })
  }
  if (options.extraPayment) {
    outputs.push({
      n: 3,
      value: 1,
      scriptPubKey: { hex: depositScript },
    })
  }
  return outputs
}

function makeRpc(options: {
  returnedTxid?: string
  returnedBlockHash?: string
  inActiveChain?: boolean
  txConfirmations?: number
  headerHash?: string
  height?: number
  confirmations?: number
  vout?: unknown[]
} = {}): BtcsL1DepositRpc {
  return {
    async getRawTransaction() {
      return {
        txid: options.returnedTxid ?? txid,
        blockhash: options.returnedBlockHash ?? blockHash,
        in_active_chain: options.inActiveChain ?? true,
        confirmations: options.txConfirmations ?? 10,
        vout: options.vout ?? makeOutputs(),
      }
    },
    async getBlockHeader() {
      return {
        hash: options.headerHash ?? blockHash,
        height: options.height ?? 120,
        confirmations: options.confirmations ?? 10,
      }
    },
  }
}

test('encodes and decodes a canonical 20-byte EVM deposit recipient', () => {
  const upper = `0x${'B'.repeat(40)}`
  const payload = encodeBtcsL1DepositPayload(upper)
  assert.equal(payload.length, 56)
  assert.equal(decodeBtcsL1DepositPayload(payload).recipientAddress, recipient)

  const script = encodeBtcsL1DepositScript(upper)
  assert.equal(script, `6a1c${payload}`)
  assert.equal(decodeBtcsL1DepositScript(script).recipientAddress, recipient)
})

test('rejects invalid recipient addresses and malformed deposit payloads', () => {
  assert.throws(() => encodeBtcsL1DepositPayload('0x1234'), /20-byte EVM address/)
  assert.throws(() => decodeBtcsL1DepositPayload('abcd'), /malformed/)
  assert.throws(
    () => decodeBtcsL1DepositPayload(`00${encodeBtcsL1DepositPayload(recipient).slice(2)}`),
    /marker does not match/,
  )
  const unsupported = `${'425443534c3244'}02${'b'.repeat(40)}`
  assert.throws(() => decodeBtcsL1DepositPayload(unsupported), /unsupported/)
  assert.throws(() => decodeBtcsL1DepositScript('6a'), /canonical/)
})

test('verifies a confirmed deposit, exact recipient, payment output, and satoshi amount', async () => {
  const report = await verifyBtcsL1Deposit(makeRpc(), request)
  assert.equal(report.format, 'btcs-l2-btcs-l1-deposit-verification')
  assert.equal(report.verificationModel, 'trusted-btcs-core-rpc')
  assert.equal(report.txid, txid)
  assert.equal(report.blockHash, blockHash)
  assert.equal(report.blockHeight, 120)
  assert.equal(report.confirmations, 10)
  assert.equal(report.activeChain, true)
  assert.equal(report.recipientAddress, recipient)
  assert.equal(report.amountSats, '1234567890')
  assert.equal(report.depositOutputIndex, 2)
  assert.equal(report.depositId, `${txid}:2`)
  assert.equal(report.depositVerified, true)
})

test('rejects a deposit transaction outside the active chain', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ inActiveChain: false }), request),
    /not confirmed in the active chain/,
  )
})

test('rejects mismatched transaction and block identities', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ returnedTxid: '3'.repeat(64) }), request),
    /different txid/,
  )
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ returnedBlockHash: '4'.repeat(64) }), request),
    /not in the requested block/,
  )
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ headerHash: '5'.repeat(64) }), request),
    /different block hash/,
  )
})

test('rejects an intent addressed to a different L2 account', async () => {
  const wrongRecipient = `0x${'c'.repeat(40)}`
  await assert.rejects(
    verifyBtcsL1Deposit(
      makeRpc({ vout: makeOutputs({ intentScript: encodeBtcsL1DepositScript(wrongRecipient) }) }),
      request,
    ),
    /recipient does not match/,
  )
})

test('rejects missing, duplicated, or malformed deposit intents', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ vout: makeOutputs({ includeIntent: false }) }), request),
    /exactly one canonical/,
  )
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ vout: makeOutputs({ extraIntent: true }) }), request),
    /exactly one canonical/,
  )
  const malformedMarker = `${encodeBtcsL1DepositScript(recipient).slice(0, 18)}02${encodeBtcsL1DepositScript(recipient).slice(20)}`
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ vout: makeOutputs({ intentScript: malformedMarker }) }), request),
    /unsupported/,
  )
})

test('rejects missing, duplicated, or zero-value payment outputs', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ vout: makeOutputs({ includePayment: false }) }), request),
    /exactly one payment/,
  )
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ vout: makeOutputs({ extraPayment: true }) }), request),
    /exactly one payment/,
  )
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ vout: makeOutputs({ paymentValue: 0 }) }), request),
    /positive numeric value/,
  )
})

test('rejects OP_RETURN as the configured payment destination', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc(), {
      ...request,
      depositScriptPubKeyHex: '6a01ff',
    }),
    /cannot be an OP_RETURN/,
  )
})

test('rejects insufficient confirmations and inconsistent RPC confirmation counts', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ confirmations: 5, txConfirmations: 5 }), request),
    /insufficient confirmations/,
  )
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ confirmations: 10, txConfirmations: 9 }), request),
    /confirmation counts disagree/,
  )
})

test('rejects invalid confirmation requirements and malformed request hashes', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc(), { ...request, requiredConfirmations: 0 }),
    /positive safe integer/,
  )
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc(), { ...request, txid: 'xyz' }),
    /64 lowercase hex characters/,
  )
})

test('rejects deposit output values that cannot represent whole satoshis', async () => {
  await assert.rejects(
    verifyBtcsL1Deposit(makeRpc({ vout: makeOutputs({ paymentValue: 1e-9 }) }), request),
    /whole satoshis/,
  )
})
