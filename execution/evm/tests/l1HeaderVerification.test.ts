import assert from 'node:assert/strict'
import { test } from 'node:test'
import { verifyHeaderChain, validateNetworkParams, computeBlockHash } from '../src/l1HeaderVerifier.js'

test('header verifier: validates chain continuity', () => {
  const headers = [
    { hash: 'a'.repeat(64), previousblockhash: '0'.repeat(64), height: 100 },
    { hash: 'b'.repeat(64), previousblockhash: 'a'.repeat(64), height: 101 },
    { hash: 'c'.repeat(64), previousblockhash: 'b'.repeat(64), height: 102 },
  ]
  const result = verifyHeaderChain(headers)
  assert.equal(result.valid, true)
  assert.equal(result.height, 102)
})

test('header verifier: rejects broken chain', () => {
  const headers = [
    { hash: 'a'.repeat(64), previousblockhash: '0'.repeat(64), height: 100 },
    { hash: 'b'.repeat(64), previousblockhash: 'd'.repeat(64), height: 101 },
  ]
  const result = verifyHeaderChain(headers)
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('chain')))
})

test('header verifier: rejects wrong height sequence', () => {
  const headers = [
    { hash: 'a'.repeat(64), previousblockhash: '0'.repeat(64), height: 100 },
    { hash: 'b'.repeat(64), previousblockhash: 'a'.repeat(64), height: 102 },
  ]
  const result = verifyHeaderChain(headers)
  assert.equal(result.valid, false)
})

test('header verifier: rejects genesis mismatch', () => {
  const headers = [
    { hash: 'b'.repeat(64), previousblockhash: '0'.repeat(64), height: 0 },
  ]
  const result = verifyHeaderChain(headers, 'a'.repeat(64))
  assert.equal(result.valid, false)
})

test('header verifier: network validation', () => {
  validateNetworkParams('regtest', 'regtest')
  assert.throws(() => validateNetworkParams('main', 'regtest'), /Network mismatch/)
})

test('header verifier: block hash computation', () => {
  const h = { hash: '1'.repeat(64), previousblockhash: '0'.repeat(64), height: 0 }
  assert.equal(computeBlockHash(h), '1'.repeat(64))
})
