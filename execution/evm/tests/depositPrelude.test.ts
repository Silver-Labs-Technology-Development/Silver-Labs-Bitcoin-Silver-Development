import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BTCS_L1_DEPOSIT_RECORD_FORMAT,
  BTCS_L1_DEPOSIT_RECORD_VERSION,
} from '../src/btcsL1DepositStore.js'
import type { BtcsL1DepositRecord } from '../src/btcsL1DepositStore.js'
import {
  calculateEvmDepositPreludeCommitment,
  createEvmDepositOperation,
  encodeEvmDepositPreludeExtraData,
  normalizeEvmDepositOperations,
  verifyEvmDepositPrelude,
} from '../src/depositPrelude.js'

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
    amountSats: '125000000',
    requiredConfirmations: 6,
    state: 'confirmed',
    blockHash: 'b'.repeat(64),
    blockHeight: 200,
    confirmations: 8,
    ...overrides,
  }
}

test('converts satoshis to wei exactly and commits the operation in 32 bytes', () => {
  const operation = createEvmDepositOperation(makeRecord())
  assert.equal(operation.amountWei, '1250000000000000000')

  const extraData = encodeEvmDepositPreludeExtraData([operation])
  assert.equal(extraData.length, 32)
  assert.match(calculateEvmDepositPreludeCommitment([operation])!, /^[0-9a-f]{64}$/)
  assert.deepEqual(verifyEvmDepositPrelude([operation], extraData), [operation])
})

test('empty deposit prelude uses empty extraData', () => {
  assert.equal(encodeEvmDepositPreludeExtraData([]).length, 0)
  assert.deepEqual(verifyEvmDepositPrelude([], new Uint8Array()), [])
  assert.throws(
    () => verifyEvmDepositPrelude([], new Uint8Array(32)),
    /no deposit operations/,
  )
})

test('rejects unconfirmed and invalidated deposit records', () => {
  assert.throws(
    () => createEvmDepositOperation(makeRecord({ state: 'invalidated' })),
    /sufficiently confirmed/,
  )
  assert.throws(
    () => createEvmDepositOperation(makeRecord({ confirmations: 5 })),
    /sufficiently confirmed/,
  )
})

test('rejects duplicate or noncanonical deposit ordering', () => {
  const first = createEvmDepositOperation(makeRecord())
  assert.throws(
    () => normalizeEvmDepositOperations([first, first]),
    /uniquely ordered/,
  )

  const second = createEvmDepositOperation(makeRecord({
    depositId: `${'c'.repeat(64)}:0`,
    txid: 'c'.repeat(64),
  }))
  assert.throws(
    () => normalizeEvmDepositOperations([second, first]),
    /uniquely ordered/,
  )
})

test('rejects incorrect satoshi conversion and altered committed operations', () => {
  const operation = createEvmDepositOperation(makeRecord())
  assert.throws(
    () => normalizeEvmDepositOperations([{ ...operation, amountWei: '125000000' }]),
    /conversion is incorrect/,
  )

  const commitment = encodeEvmDepositPreludeExtraData([operation])
  assert.throws(
    () => verifyEvmDepositPrelude(
      [{ ...operation, recipientAddress: `0x${'2'.repeat(40)}` }],
      commitment,
    ),
    /do not match/,
  )
})

test('rejects malformed source identities, addresses, and oversized amounts', () => {
  const operation = createEvmDepositOperation(makeRecord())
  assert.throws(
    () => normalizeEvmDepositOperations([{ ...operation, sourceBlockHash: 'xyz' }]),
    /transaction or block hash/,
  )
  assert.throws(
    () => normalizeEvmDepositOperations([{ ...operation, recipientAddress: '0x1234' }]),
    /lowercase EVM address/,
  )
  assert.throws(
    () => normalizeEvmDepositOperations([{
      ...operation,
      amountSats: '9'.repeat(78),
      amountWei: '9'.repeat(78),
    }]),
    /uint256 balance range/,
  )
})
