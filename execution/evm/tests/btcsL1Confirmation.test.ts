import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import {
  verifyBtcsL1AnchorConfirmation,
  type BtcsL1ConfirmationRequest,
  type BtcsL1ConfirmationRpc,
} from '../src/btcsL1Confirmation.js'

const txid = '1'.repeat(64)
const blockHash = '2'.repeat(64)
const batchHash = '3'.repeat(64)
const request: BtcsL1ConfirmationRequest = {
  txid,
  blockHash,
  batchHash,
  requiredConfirmations: 6,
}

function makeRpc(options: {
  txid?: string
  blockhash?: string
  inActiveChain?: boolean
  scripts?: string[]
  headerHash?: string
  height?: number
  confirmations?: number
} = {}): BtcsL1ConfirmationRpc {
  return {
    async getRawTransaction() {
      return {
        txid: options.txid ?? txid,
        blockhash: options.blockhash ?? blockHash,
        in_active_chain: options.inActiveChain ?? true,
        vout: (options.scripts ?? [encodeBtcsL1AnchorScript(batchHash)]).map(
          (hex) => ({ scriptPubKey: { hex } }),
        ),
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

test('verifies an active-chain anchor with sufficient confirmations', async () => {
  const report = await verifyBtcsL1AnchorConfirmation(makeRpc(), request)

  assert.equal(report.format, 'btcs-l2-btcs-l1-confirmation')
  assert.equal(report.verificationModel, 'trusted-btcs-core-rpc')
  assert.equal(report.txid, txid)
  assert.equal(report.blockHash, blockHash)
  assert.equal(report.blockHeight, 120)
  assert.equal(report.confirmations, 10)
  assert.equal(report.activeChain, true)
  assert.equal(report.batchHash, batchHash)
  assert.equal(report.anchorVerified, true)
})

test('rejects a transaction reported outside the active chain', async () => {
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(makeRpc({ inActiveChain: false }), request),
    /not confirmed in the active chain/,
  )
})

test('rejects a different transaction ID or block hash', async () => {
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(makeRpc({ txid: '4'.repeat(64) }), request),
    /different txid/,
  )
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(makeRpc({ blockhash: '5'.repeat(64) }), request),
    /not in the requested block/,
  )
})

test('rejects an anchor for a different batch', async () => {
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(
      makeRpc({ scripts: [encodeBtcsL1AnchorScript('4'.repeat(64))] }),
      request,
    ),
    /batch hash does not match/,
  )
})

test('rejects missing, duplicate, and malformed anchor scripts', async () => {
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(makeRpc({ scripts: ['6a'] }), request),
    /exactly one matching/,
  )
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(
      makeRpc({
        scripts: [
          encodeBtcsL1AnchorScript(batchHash),
          encodeBtcsL1AnchorScript(batchHash),
        ],
      }),
      request,
    ),
    /exactly one matching/,
  )
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(
      makeRpc({ scripts: [`6a27${'425443534c32'}01${'a'.repeat(64)}`] }),
      request,
    ),
    /malformed|canonical|batch hash/,
  )
})

test('rejects insufficient confirmations and mismatched block headers', async () => {
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(makeRpc({ confirmations: 5 }), request),
    /insufficient confirmations/,
  )
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(makeRpc({ headerHash: '6'.repeat(64) }), request),
    /different block hash/,
  )
})

test('rejects invalid confirmation requirements', async () => {
  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(makeRpc(), {
      ...request,
      requiredConfirmations: 0,
    }),
    /positive safe integer/,
  )
})
