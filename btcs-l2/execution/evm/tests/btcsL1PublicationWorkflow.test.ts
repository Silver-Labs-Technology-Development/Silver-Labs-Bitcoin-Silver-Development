import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import {
  createBtcsL1Publication,
  invalidateBtcsL1Publication,
  markBtcsL1PublicationSubmitted,
} from '../src/btcsL1Publication.js'
import { verifyAndAdvanceBtcsL1Publication } from '../src/btcsL1PublicationWorkflow.js'

const batchHash = 'a'.repeat(64)
const txid = 'b'.repeat(64)
const blockHash = 'c'.repeat(64)

function makeRpc(
  confirmations: number,
  options: {
    activeChain?: boolean
    height?: number
    anchorBatchHash?: string
  } = {},
) {
  return {
    async getRawTransaction(requestedTxid: string, requestedBlockHash: string) {
      return {
        txid: requestedTxid,
        blockhash: requestedBlockHash,
        in_active_chain: options.activeChain ?? true,
        confirmations,
        vout: [{
          scriptPubKey: {
            hex: encodeBtcsL1AnchorScript(options.anchorBatchHash ?? batchHash),
          },
        }],
      }
    },
    async getBlockHeader(requestedBlockHash: string) {
      return {
        hash: requestedBlockHash,
        height: options.height ?? 120,
        confirmations,
      }
    },
  }
}

function submittedPublication() {
  return markBtcsL1PublicationSubmitted(
    createBtcsL1Publication(batchHash, 6),
    txid,
  )
}

test('workflow verifies the anchor before advancing observed and confirmed states', async () => {
  const submitted = submittedPublication()

  const observed = await verifyAndAdvanceBtcsL1Publication(
    makeRpc(2),
    submitted,
    blockHash,
  )
  assert.equal(observed.state, 'observed')
  assert.equal(observed.confirmations, 2)
  assert.equal(submitted.state, 'submitted')

  const confirmed = await verifyAndAdvanceBtcsL1Publication(
    makeRpc(6),
    observed,
    blockHash,
  )
  assert.equal(confirmed.state, 'confirmed')
  assert.equal(confirmed.confirmations, 6)

  const refreshed = await verifyAndAdvanceBtcsL1Publication(
    makeRpc(6),
    confirmed,
    blockHash,
  )
  assert.equal(refreshed.state, 'confirmed')
})

test('workflow refuses unconfirmed transactions and leaves the input record unchanged', async () => {
  const submitted = submittedPublication()

  await assert.rejects(
    verifyAndAdvanceBtcsL1Publication(
      makeRpc(6, { activeChain: false }),
      submitted,
      blockHash,
    ),
    /active chain/,
  )
  assert.equal(submitted.state, 'submitted')
})

test('workflow rejects an anchor for a different batch', async () => {
  const submitted = submittedPublication()

  await assert.rejects(
    verifyAndAdvanceBtcsL1Publication(
      makeRpc(6, { anchorBatchHash: 'd'.repeat(64) }),
      submitted,
      blockHash,
    ),
    /batch hash/,
  )
  assert.equal(submitted.state, 'submitted')
})

test('workflow re-observes an invalidated transaction only after verification', async () => {
  const observed = await verifyAndAdvanceBtcsL1Publication(
    makeRpc(3),
    submittedPublication(),
    blockHash,
  )
  const invalidated = invalidateBtcsL1Publication(observed)
  const newBlockHash = 'd'.repeat(64)

  const reobserved = await verifyAndAdvanceBtcsL1Publication(
    makeRpc(1, { height: 121 }),
    invalidated,
    newBlockHash,
  )

  assert.equal(reobserved.state, 'observed')
  assert.equal(reobserved.txid, txid)
  assert.equal(reobserved.blockHash, newBlockHash)
  assert.equal(reobserved.blockHeight, 121)
  assert.equal(reobserved.confirmations, 1)
})
