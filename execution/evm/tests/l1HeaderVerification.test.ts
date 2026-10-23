import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  verifyHeaderChain,
  validateNetworkParams,
  computeBlockHash,
  verifyBtcsL1TxOutProof,
  verifyTransactionInclusion,
  type L1Header,
} from '../src/l1HeaderVerifier.js'
import {
  HEIGHT_555_HASH,
  HEIGHT_555_MERKLE_ROOT,
  HEIGHT_555_PREVIOUS_HASH,
  HEIGHT_555_TIME,
  HEIGHT_556_HASH,
  HEIGHT_556_MERKLE_ROOT,
  HEIGHT_556_PREVIOUS_HASH,
  HEIGHT_556_TIME,
  REAL_PROOF,
  REAL_TXID,
} from './fixtures/btcsL1ProofFixture.js'

const HEIGHT_555_HEADER: L1Header = {
  hash: HEIGHT_555_HASH,
  version: 536870912,
  previousblockhash: HEIGHT_555_PREVIOUS_HASH,
  merkleroot: HEIGHT_555_MERKLE_ROOT,
  time: HEIGHT_555_TIME,
  bits: '207fffff',
  nonce: 0,
  height: 555,
  confirmations: 2,
}

const HEIGHT_556_HEADER: L1Header = {
  hash: HEIGHT_556_HASH,
  version: 536870912,
  previousblockhash: HEIGHT_556_PREVIOUS_HASH,
  merkleroot: HEIGHT_556_MERKLE_ROOT,
  time: HEIGHT_556_TIME,
  bits: '207fffff',
  nonce: 0,
  height: 556,
  confirmations: 1,
}

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

test('header verifier: computes a real BTCS header hash locally', () => {
  assert.equal(computeBlockHash(HEIGHT_556_HEADER), HEIGHT_556_HEADER.hash)
  assert.equal(computeBlockHash(HEIGHT_555_HEADER), HEIGHT_555_HEADER.hash)
})

test('header verifier: strict mode validates real serialized headers and proof of work', () => {
  const result = verifyHeaderChain(
    [HEIGHT_555_HEADER, HEIGHT_556_HEADER],
    HEIGHT_555_HEADER.hash,
    { strict: true },
  )
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
  assert.ok(result.checked.includes('header_1_serialized_hash'))
  assert.ok(result.checked.includes('header_1_proof_of_work'))
})

test('header verifier: strict mode rejects a hash that does not match its fields', () => {
  const tampered = { ...HEIGHT_556_HEADER, nonce: 1 }
  const result = verifyHeaderChain([tampered], undefined, { strict: true })
  assert.equal(result.valid, false)
  assert.ok(result.errors.some(e => e.includes('hash does not match')))
})

test('transaction proof: verifies a real regtest partial Merkle proof', () => {
  const report = verifyBtcsL1TxOutProof(
    REAL_PROOF,
    HEIGHT_556_HEADER.hash,
    REAL_TXID,
  )
  assert.equal(report.verificationModel, 'pow-merkle-proof')
  assert.equal(report.blockHash, HEIGHT_556_HEADER.hash)
  assert.equal(report.previousBlockHash, HEIGHT_555_HEADER.hash)
  assert.equal(report.merkleRoot, HEIGHT_556_HEADER.merkleroot)
  assert.equal(report.transactionCount, 2)
  assert.deepEqual(report.matchedTxids, [REAL_TXID])
})

test('transaction proof: rejects wrong block, wrong txid, malformed and truncated proof', () => {
  assert.throws(
    () => verifyBtcsL1TxOutProof(REAL_PROOF, '1'.repeat(64), REAL_TXID),
    /does not match the expected block hash/,
  )
  assert.throws(
    () => verifyBtcsL1TxOutProof(REAL_PROOF, HEIGHT_556_HEADER.hash, '2'.repeat(64)),
    /does not commit to the expected txid/,
  )
  assert.throws(
    () => verifyBtcsL1TxOutProof('00', HEIGHT_556_HEADER.hash, REAL_TXID),
    /too short|invalid/,
  )
  assert.throws(
    () => verifyBtcsL1TxOutProof(REAL_PROOF.slice(0, -2), HEIGHT_556_HEADER.hash, REAL_TXID),
    /truncated|invalid/,
  )
  assert.throws(
    () => verifyBtcsL1TxOutProof('zz', HEIGHT_556_HEADER.hash, REAL_TXID),
    /lowercase hex/,
  )
})

test('transaction proof: rejects a header that fails proof of work', () => {
  // Change the nonce in the header bytes while keeping the expected hash.
  const bytes = Buffer.from(REAL_PROOF, 'hex')
  bytes.writeUInt32LE(1, 76)
  assert.throws(
    () => verifyBtcsL1TxOutProof(bytes.toString('hex'), HEIGHT_556_HEADER.hash, REAL_TXID),
    /proof-of-work target/,
  )
})

test('header verifier: refuses to treat format checks as transaction inclusion proofs', () => {
  assert.throws(
    () => verifyTransactionInclusion('1'.repeat(64), '2'.repeat(64), '3'.repeat(64), []),
    /requires a header and partial Merkle proof/,
  )
  assert.equal(
    verifyTransactionInclusion('not-a-hash', '2'.repeat(64), '3'.repeat(64), []),
    false,
  )
})
