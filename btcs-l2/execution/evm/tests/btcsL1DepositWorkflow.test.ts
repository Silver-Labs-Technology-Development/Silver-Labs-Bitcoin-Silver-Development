import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { encodeBtcsL1DepositScript } from '../src/btcsL1Deposit.js'
import {
  invalidateBtcsL1DepositAfterConfirmedReorg,
  verifyAndRecordBtcsL1Deposit,
} from '../src/btcsL1DepositWorkflow.js'
import { BtcsL1DepositStore } from '../src/btcsL1DepositStore.js'
import type {
  BtcsL1DepositRequest,
  BtcsL1DepositRpc,
} from '../src/btcsL1Deposit.js'

const txid = '1'.repeat(64)
const originalBlockHash = '2'.repeat(64)
const replacementBlockHash = '3'.repeat(64)
const recipientAddress = `0x${'b'.repeat(40)}`
const depositScriptPubKeyHex = `0014${'a'.repeat(40)}`
const depositId = `${txid}:1`

function request(blockHash = originalBlockHash): BtcsL1DepositRequest {
  return {
    txid,
    blockHash,
    recipientAddress,
    depositScriptPubKeyHex,
    requiredConfirmations: 6,
  }
}

function makeRpc(options: {
  inActiveChain?: boolean
  confirmations?: number
  amount?: number
} = {}): BtcsL1DepositRpc {
  const confirmations = options.confirmations ?? 8
  return {
    async getRawTransaction(requestedTxid, requestedBlockHash) {
      return {
        txid: requestedTxid,
        blockhash: requestedBlockHash,
        in_active_chain: options.inActiveChain ?? true,
        confirmations,
        vout: [
          {
            n: 0,
            value: 0,
            scriptPubKey: { hex: encodeBtcsL1DepositScript(recipientAddress) },
          },
          {
            n: 1,
            value: options.amount ?? 1.25,
            scriptPubKey: { hex: depositScriptPubKeyHex },
          },
        ],
      }
    },
    async getBlockHeader(requestedBlockHash) {
      return {
        hash: requestedBlockHash,
        height: requestedBlockHash === originalBlockHash ? 100 : 101,
        confirmations,
      }
    },
  }
}

async function withStore(
  action: (directory: string, store: BtcsL1DepositStore) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-deposit-workflow-'))
  try {
    const store = await BtcsL1DepositStore.create(directory)
    await action(directory, store)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('verifies and durably registers a first deposit', async () => {
  await withStore(async (directory, store) => {
    const record = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    assert.equal(record.depositId, depositId)
    assert.equal(record.state, 'confirmed')
    assert.equal(record.amountSats, '125000000')
    assert.equal(record.blockHash, originalBlockHash)

    const reopened = await BtcsL1DepositStore.open(directory)
    assert.deepEqual(reopened.get(depositId), record)
  })
})

test('repeated verification of the same inclusion is idempotent', async () => {
  await withStore(async (_directory, store) => {
    const first = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const second = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    assert.deepEqual(second, first)
    assert.equal(store.list().length, 1)
  })
})

test('RPC verification failure does not mutate an existing deposit', async () => {
  await withStore(async (_directory, store) => {
    const first = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    await assert.rejects(
      verifyAndRecordBtcsL1Deposit(makeRpc({ inActiveChain: false }), store, request()),
      /not confirmed in the active chain/,
    )
    assert.deepEqual(store.get(depositId), first)
  })
})

test('a changed inclusion requires explicit invalidation before re-observation', async () => {
  await withStore(async (_directory, store) => {
    const original = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    await assert.rejects(
      verifyAndRecordBtcsL1Deposit(makeRpc(), store, request(replacementBlockHash)),
      /inclusion changed; invalidate and re-observe it/,
    )
    assert.deepEqual(store.get(depositId), original)
  })
})

test('confirmed reorg invalidation and replacement inclusion survive store reopening', async () => {
  await withStore(async (directory, store) => {
    const original = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const invalidated = await invalidateBtcsL1DepositAfterConfirmedReorg(
      store,
      depositId,
      originalBlockHash,
    )
    assert.equal(invalidated.state, 'invalidated')
    assert.equal(invalidated.lastInvalidatedBlockHash, originalBlockHash)

    const reopenedInvalidated = await BtcsL1DepositStore.open(directory)
    assert.deepEqual(reopenedInvalidated.get(depositId), invalidated)

    const recovered = await verifyAndRecordBtcsL1Deposit(
      makeRpc(),
      reopenedInvalidated,
      request(replacementBlockHash),
    )
    assert.equal(recovered.state, 'confirmed')
    assert.equal(recovered.blockHash, replacementBlockHash)
    assert.equal(recovered.blockHeight, 101)
    assert.equal(recovered.lastInvalidatedBlockHash, originalBlockHash)

    const reopenedRecovered = await BtcsL1DepositStore.open(directory)
    assert.deepEqual(reopenedRecovered.get(depositId), recovered)
  })
})

test('stale reorg invalidation cannot invalidate a different inclusion', async () => {
  await withStore(async (_directory, store) => {
    await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    await assert.rejects(
      invalidateBtcsL1DepositAfterConfirmedReorg(store, depositId, replacementBlockHash),
      /inclusion changed before invalidation/,
    )
    assert.equal(store.get(depositId)?.state, 'confirmed')
  })
})

test('confirmation updates preserve recipient and amount and reject regressions', async () => {
  await withStore(async (_directory, store) => {
    const original = await verifyAndRecordBtcsL1Deposit(makeRpc(), store, request())
    const advanced = await verifyAndRecordBtcsL1Deposit(
      makeRpc({ confirmations: 9 }),
      store,
      request(),
    )
    assert.equal(advanced.confirmations, 9)
    await assert.rejects(
      verifyAndRecordBtcsL1Deposit(makeRpc({ confirmations: 7 }), store, request()),
      /confirmation count cannot regress/,
    )
    assert.equal(store.get(depositId)?.blockHash, original.blockHash)
    assert.equal(store.get(depositId)?.confirmations, 9)
  })
})
