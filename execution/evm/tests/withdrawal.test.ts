import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeWithdrawalId, validateWithdrawalRequest, isWithdrawalEnabled, canProcessPayout, WITHDRAWAL_VERSION } from '../src/withdrawal.js'

test('withdrawal: validates request structure', () => {
  const req = {
    version: WITHDRAWAL_VERSION,
    l2From: '0x1111111111111111111111111111111111111111',
    l1To: 'bcrt1qtest123456789',
    amountWei: 1000000000000000000n,
    nonce: 1n,
  }
  const validated = validateWithdrawalRequest(req)
  assert.equal(validated.l2From, '0x1111111111111111111111111111111111111111')
  assert.equal(validated.amountWei, 1000000000000000000n)
})

test('withdrawal: rejects invalid addresses', () => {
  assert.throws(() => validateWithdrawalRequest({
    version: WITHDRAWAL_VERSION,
    l2From: 'not-an-address',
    l1To: 'bcrt1qtest',
    amountWei: 100n,
    nonce: 1n,
  }), /invalid l2From/)
})

test('withdrawal: rejects zero or negative amounts', () => {
  assert.throws(() => validateWithdrawalRequest({
    version: WITHDRAWAL_VERSION,
    l2From: '0x1111111111111111111111111111111111111111',
    l1To: 'bcrt1qtest123456789012345678901234567890123456',
    amountWei: 0n,
    nonce: 1n,
  }), /invalid withdrawal amount/)
  
  assert.throws(() => validateWithdrawalRequest({
    version: WITHDRAWAL_VERSION,
    l2From: '0x1111111111111111111111111111111111111111',
    l1To: 'bcrt1qtest123456789012345678901234567890123456',
    amountWei: -1n,
    nonce: 1n,
  }))
})

test('withdrawal: computes deterministic ID', () => {
  const req = {
    version: WITHDRAWAL_VERSION,
    l2From: '0x1111111111111111111111111111111111111111',
    l1To: 'bcrt1qtest123456789012345678901234567890123456',
    amountWei: 100n,
    nonce: 1n,
  }
  const id1 = computeWithdrawalId(req)
  const id2 = computeWithdrawalId(req)
  assert.equal(id1, id2)
  assert.equal(id1.length, 64)
})

test('withdrawal: different nonces produce different IDs', () => {
  const req1 = { version: WITHDRAWAL_VERSION, l2From: '0x1111111111111111111111111111111111111111', l1To: 'bcrt1qtest123456789012345678901234567890123456', amountWei: 100n, nonce: 1n }
  const req2 = { ...req1, nonce: 2n }
  assert.notEqual(computeWithdrawalId(req1), computeWithdrawalId(req2))
})

test('withdrawal: disabled by default', () => {
  assert.equal(isWithdrawalEnabled(), false)
})

test('withdrawal: payouts never enabled', () => {
  assert.equal(canProcessPayout(), false)
})
