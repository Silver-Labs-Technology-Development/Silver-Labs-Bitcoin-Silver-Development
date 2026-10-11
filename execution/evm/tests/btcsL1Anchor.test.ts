import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BTCS_L1_ANCHOR_MAGIC_HEX,
  decodeBtcsL1AnchorPayload,
  decodeBtcsL1AnchorScript,
  encodeBtcsL1AnchorPayload,
  encodeBtcsL1AnchorScript,
} from '../src/btcsL1Anchor.js'

const BATCH_HASH = 'ab'.repeat(32)

test('encodes a deterministic 39-byte BTCS L1 anchor payload', () => {
  const payload = encodeBtcsL1AnchorPayload(BATCH_HASH)

  assert.equal(payload, `${BTCS_L1_ANCHOR_MAGIC_HEX}01${BATCH_HASH}`)
  assert.equal(payload.length / 2, 39)
  assert.deepEqual(decodeBtcsL1AnchorPayload(payload), {
    format: 'btcs-l2-l1-anchor',
    version: 1,
    batchHash: BATCH_HASH,
  })
})

test('encodes and decodes the canonical OP_RETURN script', () => {
  const script = encodeBtcsL1AnchorScript(BATCH_HASH)

  assert.equal(script, `6a27${BTCS_L1_ANCHOR_MAGIC_HEX}01${BATCH_HASH}`)
  assert.equal(script.length / 2, 41)
  assert.deepEqual(decodeBtcsL1AnchorScript(script), {
    format: 'btcs-l2-l1-anchor',
    version: 1,
    batchHash: BATCH_HASH,
  })
})

test('rejects malformed batch hashes', () => {
  for (const badHash of [
    '',
    'AB'.repeat(32),
    'ab'.repeat(31),
    'ab'.repeat(31) + 'xz',
    '0x' + 'ab'.repeat(32),
  ]) {
    assert.throws(() => encodeBtcsL1AnchorPayload(badHash), /batch hash/)
  }
})

test('rejects malformed payloads, wrong markers, and unsupported versions', () => {
  const payload = encodeBtcsL1AnchorPayload(BATCH_HASH)

  assert.throws(() => decodeBtcsL1AnchorPayload(''), /malformed/)
  assert.throws(
    () => decodeBtcsL1AnchorPayload(payload.slice(0, -2)),
    /malformed/,
  )
  assert.throws(
    () => decodeBtcsL1AnchorPayload('425443534c33' + payload.slice(12)),
    /marker/,
  )
  assert.throws(
    () => decodeBtcsL1AnchorPayload(payload.slice(0, 12) + '02' + payload.slice(14)),
    /version/,
  )
  assert.throws(
    () => decodeBtcsL1AnchorPayload(payload.slice(0, -2) + 'G0'),
    /malformed/,
  )
})

test('rejects noncanonical or altered OP_RETURN scripts', () => {
  const script = encodeBtcsL1AnchorScript(BATCH_HASH)

  assert.throws(
    () => decodeBtcsL1AnchorScript('6a26' + script.slice(4)),
    /canonical BTCS L1 anchor/,
  )
  assert.throws(
    () => decodeBtcsL1AnchorScript('6a27' + 'ff'.repeat(39)),
    /marker/,
  )
  assert.throws(
    () => decodeBtcsL1AnchorScript(script + '00'),
    /canonical BTCS L1 anchor/,
  )
})
