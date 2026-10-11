import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  createBtcsL1Publication,
  invalidateBtcsL1Publication,
  markBtcsL1PublicationSubmitted,
  observeBtcsL1Publication,
  reobserveBtcsL1Publication,
} from '../src/btcsL1Publication.js'

const batchHash = 'a'.repeat(64)
const txid = 'b'.repeat(64)
const blockHash = 'c'.repeat(64)

test('publication progresses from prepared to submitted, observed, and confirmed', () => {
  const prepared = createBtcsL1Publication(batchHash, 6)
  assert.equal(prepared.state, 'prepared')

  const submitted = markBtcsL1PublicationSubmitted(prepared, txid)
  assert.equal(submitted.state, 'submitted')
  assert.equal(submitted.txid, txid)

  const observed = observeBtcsL1Publication(submitted, blockHash, 120, 2)
  assert.equal(observed.state, 'observed')
  assert.equal(observed.confirmations, 2)

  const confirmed = observeBtcsL1Publication(observed, blockHash, 120, 6)
  assert.equal(confirmed.state, 'confirmed')
  assert.equal(confirmed.confirmations, 6)
})

test('rejects invalid hashes, confirmation targets, and illegal transitions', () => {
  assert.throws(() => createBtcsL1Publication('bad', 6), /batch hash/)
  assert.throws(() => createBtcsL1Publication(batchHash, 0), /positive safe integer/)

  const prepared = createBtcsL1Publication(batchHash, 6)
  assert.throws(() => markBtcsL1PublicationSubmitted(prepared, 'bad'), /transaction ID/)
  assert.throws(() => observeBtcsL1Publication(prepared, blockHash, 120, 1), /submitted or observed/)
})

test('invalidating an observed publication clears its chain inclusion data', () => {
  const submitted = markBtcsL1PublicationSubmitted(
    createBtcsL1Publication(batchHash, 6),
    txid,
  )
  const observed = observeBtcsL1Publication(submitted, blockHash, 120, 2)
  const invalidated = invalidateBtcsL1Publication(observed)

  assert.equal(invalidated.state, 'invalidated')
  assert.equal(invalidated.txid, txid)
  assert.equal('blockHash' in invalidated, false)
  assert.equal('blockHeight' in invalidated, false)
  assert.equal('confirmations' in invalidated, false)
})

test('rejects invalidation from prepared or submitted state', () => {
  assert.throws(
    () => invalidateBtcsL1Publication(createBtcsL1Publication(batchHash, 6)),
    /observed or confirmed/,
  )
  assert.throws(
    () => invalidateBtcsL1Publication(
      markBtcsL1PublicationSubmitted(createBtcsL1Publication(batchHash, 6), txid),
    ),
    /observed or confirmed/,
  )
})

test('rejects confirmation regression and block changes without invalidation', () => {
  const submitted = markBtcsL1PublicationSubmitted(
    createBtcsL1Publication(batchHash, 6),
    txid,
  )
  const observed = observeBtcsL1Publication(submitted, blockHash, 120, 3)

  assert.throws(
    () => observeBtcsL1Publication(observed, blockHash, 120, 2),
    /cannot decrease/,
  )
  assert.throws(
    () => observeBtcsL1Publication(observed, 'd'.repeat(64), 121, 4),
    /invalidate it before observing a new block/,
  )
})

test('rejects malformed runtime records and inconsistent confirmed records', () => {
  const prepared = createBtcsL1Publication(batchHash, 6)

  assert.throws(
    () => markBtcsL1PublicationSubmitted(
      { ...prepared, batchHash: 'bad' } as typeof prepared,
      txid,
    ),
    /batch hash/,
  )

  const submitted = markBtcsL1PublicationSubmitted(prepared, txid)
  const inconsistent = {
    ...submitted,
    state: 'confirmed',
    blockHash,
    blockHeight: 120,
    confirmations: 2,
  } as const

  assert.throws(
    () => observeBtcsL1Publication(inconsistent, blockHash, 120, 3),
    /confirmed publication is below its confirmation threshold/,
  )
})

test('allows re-observation after explicit invalidation while retaining transaction ID', () => {
  const submitted = markBtcsL1PublicationSubmitted(
    createBtcsL1Publication(batchHash, 6),
    txid,
  )
  const observed = observeBtcsL1Publication(submitted, blockHash, 120, 3)
  const invalidated = invalidateBtcsL1Publication(observed)

  assert.equal(invalidated.state, 'invalidated')
  assert.equal(invalidated.txid, txid)

  const reobserved = reobserveBtcsL1Publication(
    invalidated,
    'd'.repeat(64),
    121,
    1,
  )
  assert.equal(reobserved.state, 'observed')
  assert.equal(reobserved.blockHeight, 121)
  assert.equal(reobserved.blockHash, 'd'.repeat(64))
})
