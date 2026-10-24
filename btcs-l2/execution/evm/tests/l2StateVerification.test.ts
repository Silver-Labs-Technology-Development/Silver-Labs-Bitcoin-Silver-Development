import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { replayAndVerify, verifyBatchContinuity, detectMaliciousBatch } from '../src/l2StateVerifier.js'

test('L2 replay verifier: verifies clean chain', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l2verify-'))
  try {
    const chain = await PersistentBlockProcessor.open(join(dir, 'chain'))
    const view = await chain.createCanonicalReadView()
    const tip = view.report.blocks.at(-1)
    assert.ok(tip)
    const result = await replayAndVerify(chain)
    assert.equal(result.valid, true)
    assert.equal(result.stateRoot, tip.stateRoot)
    assert.equal(result.height, view.report.tip.number)
    assert.ok(result.checked.includes('load_canonical_chain'))
    assert.ok(result.checked.includes('verify_genesis'))
    assert.ok(result.checked.includes('reexecute_canonical_blocks'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('L2 replay verifier: rejects an invalid replay range', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'l2verify-'))
  try {
    const chain = await PersistentBlockProcessor.open(join(dir, 'chain'))
    const result = await replayAndVerify(chain, 1n)
    assert.equal(result.valid, false)
    assert.ok(result.errors.some((error) => error.includes('above the canonical tip')))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('L2 replay verifier: batch continuity', () => {
  const batches = [
    { batchHash: 'b1', priorCommitment: 'genesis' },
    { batchHash: 'b2', priorCommitment: 'b1' },
    { batchHash: 'b3', priorCommitment: 'b2' },
  ]
  const result = verifyBatchContinuity(batches, 'genesis')
  assert.equal(result.valid, true)
})

test('L2 replay verifier: rejects broken continuity', () => {
  const batches = [
    { batchHash: 'b1', priorCommitment: 'genesis' },
    { batchHash: 'b2', priorCommitment: 'wrong' },
  ]
  const result = verifyBatchContinuity(batches, 'genesis')
  assert.equal(result.valid, false)
})

test('L2 replay verifier: rejects wrong genesis prior', () => {
  const batches = [
    { batchHash: 'b1', priorCommitment: 'wrong' },
  ]
  const result = verifyBatchContinuity(batches, 'genesis')
  assert.equal(result.valid, false)
})

test('L2 replay verifier: detects malicious batch - wrong root', () => {
  const batch = { stateRoot: '0xBAD', priorStateRoot: '0xGOOD', transactionCount: 1 }
  const expected = { stateRoot: '0xGOOD', priorStateRoot: '0xGOOD', transactionCount: 1 }
  const errors = detectMaliciousBatch(batch, expected)
  assert.ok(errors.some(e => e.includes('state root')))
})

test('L2 replay verifier: detects fabricated tx', () => {
  const batch = { stateRoot: '0xGOOD', priorStateRoot: '0xGOOD', transactionCount: 5 }
  const expected = { stateRoot: '0xGOOD', priorStateRoot: '0xGOOD', transactionCount: 3 }
  const errors = detectMaliciousBatch(batch, expected)
  assert.ok(errors.some(e => e.includes('transaction')))
})
