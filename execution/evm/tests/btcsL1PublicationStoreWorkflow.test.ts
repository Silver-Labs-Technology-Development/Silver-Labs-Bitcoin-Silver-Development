import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import { BtcsL1PublicationStore } from '../src/btcsL1PublicationStore.js'
import type { BtcsL1ConfirmationRpc } from '../src/btcsL1Confirmation.js'
import {
  invalidateBtcsL1PublicationAfterConfirmedReorg,
  verifyAndAdvanceBtcsL1PublicationInStore,
} from '../src/btcsL1PublicationWorkflow.js'

const batchHash = 'a'.repeat(64)
const txid = 'b'.repeat(64)
const blockHash = 'c'.repeat(64)
const replacementBlockHash = 'd'.repeat(64)

async function withStore(
  run: (directory: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l1-store-workflow-'))
  try {
    await run(join(root, 'store'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function makeRpc(
  confirmations: number,
  options: {
    height?: number
    activeChain?: boolean
    anchorBatchHash?: string
  } = {},
): BtcsL1ConfirmationRpc {
  return {
    async getRawTransaction(requestedTxid, requestedBlockHash) {
      return {
        txid: requestedTxid,
        blockhash: requestedBlockHash,
        in_active_chain: options.activeChain ?? true,
        confirmations,
        vout: [{
          scriptPubKey: {
            hex: encodeBtcsL1AnchorScript(
              options.anchorBatchHash ?? batchHash,
            ),
          },
        }],
      }
    },
    async getBlockHeader(requestedBlockHash) {
      return {
        hash: requestedBlockHash,
        height: options.height ?? 120,
        confirmations,
      }
    },
  }
}

test('verified observations and confirmation thresholds persist across restart', async () => {
  await withStore(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    await store.createPublication(batchHash, 6)
    await store.markSubmitted(batchHash, txid)

    const observed = await verifyAndAdvanceBtcsL1PublicationInStore(
      makeRpc(2),
      store,
      batchHash,
      blockHash,
    )
    assert.equal(observed.state, 'observed')
    assert.equal(observed.confirmations, 2)

    const reopened = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(reopened.get(batchHash), observed)

    const confirmed = await verifyAndAdvanceBtcsL1PublicationInStore(
      makeRpc(6),
      reopened,
      batchHash,
      blockHash,
    )
    assert.equal(confirmed.state, 'confirmed')
    assert.equal(confirmed.confirmations, 6)

    const recovered = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(recovered.get(batchHash), confirmed)
  })
})

test('RPC failure leaves durable publication unchanged and does not invalidate it', async () => {
  await withStore(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    await store.createPublication(batchHash, 6)
    await store.markSubmitted(batchHash, txid)

    const observed = await verifyAndAdvanceBtcsL1PublicationInStore(
      makeRpc(2),
      store,
      batchHash,
      blockHash,
    )

    const unavailable: BtcsL1ConfirmationRpc = {
      async getRawTransaction() {
        throw new Error('temporary RPC outage')
      },
      async getBlockHeader() {
        throw new Error('should not be called')
      },
    }

    await assert.rejects(
      verifyAndAdvanceBtcsL1PublicationInStore(
        unavailable,
        store,
        batchHash,
        blockHash,
      ),
      /temporary RPC outage/,
    )

    const reopened = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(reopened.get(batchHash), observed)
    assert.equal(reopened.get(batchHash)?.state, 'observed')
  })
})

test('confirmed reorg invalidation persists before verified re-observation', async () => {
  await withStore(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    await store.createPublication(batchHash, 6)
    await store.markSubmitted(batchHash, txid)

    const observed = await verifyAndAdvanceBtcsL1PublicationInStore(
      makeRpc(3),
      store,
      batchHash,
      blockHash,
    )
    assert.equal(observed.state, 'observed')

    const invalidated = await invalidateBtcsL1PublicationAfterConfirmedReorg(
      store,
      batchHash,
      blockHash,
    )
    assert.equal(invalidated.state, 'invalidated')
    assert.equal(invalidated.txid, txid)
    assert.equal(invalidated.blockHash, undefined)

    const afterRestart = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(afterRestart.get(batchHash), invalidated)

    const reobserved = await verifyAndAdvanceBtcsL1PublicationInStore(
      makeRpc(1, { height: 121 }),
      afterRestart,
      batchHash,
      replacementBlockHash,
    )

    assert.equal(reobserved.state, 'observed')
    assert.equal(reobserved.blockHash, replacementBlockHash)
    assert.equal(reobserved.blockHeight, 121)
    assert.equal(reobserved.confirmations, 1)

    const recovered = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(recovered.get(batchHash), reobserved)
  })
})

test('stale reorg invalidation cannot clear a different stored inclusion', async () => {
  await withStore(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    await store.createPublication(batchHash, 6)
    await store.markSubmitted(batchHash, txid)

    const observed = await verifyAndAdvanceBtcsL1PublicationInStore(
      makeRpc(3),
      store,
      batchHash,
      blockHash,
    )

    await assert.rejects(
      invalidateBtcsL1PublicationAfterConfirmedReorg(
        store,
        batchHash,
        replacementBlockHash,
      ),
      /publication inclusion changed before invalidation/,
    )

    assert.deepEqual(store.get(batchHash), observed)
    const reopened = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(reopened.get(batchHash), observed)
  })
})

test('failed confirmation verification does not change submitted publication', async () => {
  await withStore(async (directory) => {
    const store = await BtcsL1PublicationStore.create(directory)
    await store.createPublication(batchHash, 6)
    const submitted = await store.markSubmitted(batchHash, txid)

    await assert.rejects(
      verifyAndAdvanceBtcsL1PublicationInStore(
        makeRpc(6, { anchorBatchHash: 'e'.repeat(64) }),
        store,
        batchHash,
        blockHash,
      ),
      /batch hash/,
    )

    assert.deepEqual(store.get(batchHash), submitted)
    const reopened = await BtcsL1PublicationStore.open(directory)
    assert.deepEqual(reopened.get(batchHash), submitted)
  })
})
