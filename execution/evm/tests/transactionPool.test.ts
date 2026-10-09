import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import {
  bytesToHex,
  createAddressFromPrivateKey,
  createContractAddress,
  hexToBytes,
} from '@ethereumjs/util'
import type { Address } from '@ethereumjs/util'
import { compileCounter } from '../src/compile.js'
import {
  BLOCK_GAS_LIMIT,
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
} from '../src/blockProcessor.js'
import {
  EVM_CHAIN_ID,
  SENDER_ADDRESS,
  SENDER_PRIVATE_KEY,
  createHarnessCommon,
} from '../src/config.js'
import { signFeeMarketTransaction } from '../src/transactions.js'
import {
  DevelopmentSequencer,
  MAX_PENDING_BYTES,
  MAX_PENDING_TRANSACTIONS,
  MAX_PENDING_TRANSACTIONS_PER_SENDER,
  MAX_RAW_TRANSACTION_BYTES,
  TransactionPoolError,
} from '../src/transactionPool.js'

const ONE_ETHER = 10n ** 18n

function signedBy(
  privateKey: Uint8Array,
  options: Readonly<{
    nonce: bigint
    to?: Address
    value?: bigint
    data?: Uint8Array
    gasLimit?: bigint
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
  }>,
) {
  return createFeeMarket1559Tx({
    chainId: EVM_CHAIN_ID,
    nonce: options.nonce,
    gasLimit: options.gasLimit ?? 21_000n,
    maxFeePerGas: options.maxFeePerGas ?? 2_000_000_000n,
    maxPriorityFeePerGas: options.maxPriorityFeePerGas ?? 1_000_000_000n,
    to: options.to,
    value: options.value ?? 0n,
    data: options.data ?? new Uint8Array(),
  }, { common: createHarnessCommon() }).sign(privateKey)
}

function asHex(bytes: Uint8Array): string {
  return bytesToHex(bytes).toLowerCase()
}

function hashOf(tx: ReturnType<typeof signFeeMarketTransaction>): string {
  return asHex(tx.hash())
}

async function withStore<T>(run: (directory: string, chain: PersistentBlockProcessor) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-v014-pool-'))
  try {
    const chain = await PersistentBlockProcessor.open(directory)
    return await run(directory, chain)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function assertPoolCode(code: number) {
  return (error: unknown) => error instanceof TransactionPoolError && error.code === code
}

test('admits signed transactions in contiguous nonce order and rejects invalid, duplicate, and unaffordable inputs', async () => {
  await withStore(async (_directory, chain) => {
    const sequencer = new DevelopmentSequencer(chain)
    const nonceOne = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    await assert.rejects(sequencer.submit(nonceOne.serialize()), assertPoolCode(-32010))

    const wrongChainCommon = createCustomCommon(
      { name: 'wrong-chain-test', chainId: Number(EVM_CHAIN_ID + 1n) },
      Mainnet,
      { hardfork: Hardfork.Osaka },
    )
    const wrongChain = createFeeMarket1559Tx({
      chainId: EVM_CHAIN_ID + 1n,
      nonce: 0n,
      gasLimit: 21_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      to: SENDER_ADDRESS,
    }, { common: wrongChainCommon }).sign(SENDER_PRIVATE_KEY)
    await assert.rejects(sequencer.submit(wrongChain.serialize()), assertPoolCode(-32010))

    const unsigned = createFeeMarket1559Tx({
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 21_000n,
      maxFeePerGas: 2_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      to: SENDER_ADDRESS,
    }, { common: createHarnessCommon() })
    await assert.rejects(sequencer.submit(unsigned.serialize()), assertPoolCode(-32010))

    const badSignature = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS }).serialize()
    badSignature[badSignature.length - 1] ^= 1
    await assert.rejects(sequencer.submit(badSignature), assertPoolCode(-32010))

    const unsupportedType = Uint8Array.of(0x03, 0xc0)
    await assert.rejects(sequencer.submit(unsupportedType), assertPoolCode(-32010))
    await assert.rejects(
      sequencer.submit(new Uint8Array(MAX_RAW_TRANSACTION_BYTES + 1)),
      assertPoolCode(-32005),
    )

    const underpriced = signFeeMarketTransaction({
      nonce: 0n,
      maxFeePerGas: 500_000_000n,
      maxPriorityFeePerGas: 100_000_000n,
    })
    await assert.rejects(sequencer.submit(underpriced.serialize()), assertPoolCode(-32010))

    const belowIntrinsicGas = signFeeMarketTransaction({ nonce: 0n, gasLimit: 1_000n })
    await assert.rejects(sequencer.submit(belowIntrinsicGas.serialize()), assertPoolCode(-32010))

    const overBalance = signFeeMarketTransaction({ nonce: 0n, value: 20_000n * ONE_ETHER })
    await assert.rejects(sequencer.submit(overBalance.serialize()), assertPoolCode(-32010))

    const transaction = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    const transactionHash = await sequencer.submit(transaction.serialize())
    assert.equal(transactionHash, hashOf(transaction))
    await assert.rejects(sequencer.submit(transaction.serialize()), assertPoolCode(-32010))
    assert.equal(chain.tip.number, 0n)
    const next = await sequencer.submit(nonceOne.serialize())
    assert.equal(next, hashOf(nonceOne))
  })
})

test('replaces only with the configured fee bump and preserves the prior transaction on failure', async () => {
  await withStore(async (_directory, chain) => {
    const sequencer = new DevelopmentSequencer(chain)
    const original = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    await sequencer.submit(original.serialize())
    const underbumped = signFeeMarketTransaction({
      nonce: 0n,
      value: 1n,
      maxFeePerGas: 2_199_999_999n,
      maxPriorityFeePerGas: 1_100_000_000n,
    })
    await assert.rejects(sequencer.submit(underbumped.serialize()), assertPoolCode(-32011))
    const nextNonce = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    await sequencer.submit(nextNonce.serialize())

    const replacement = signFeeMarketTransaction({
      nonce: 0n,
      value: 1n,
      maxFeePerGas: 2_200_000_000n,
      maxPriorityFeePerGas: 1_100_000_000n,
    })
    const replacementHash = await sequencer.submit(replacement.serialize())
    assert.equal(replacementHash, hashOf(replacement))
    const block = await sequencer.produceBlock()
    assert.deepEqual(block.includedTransactions, [replacementHash, hashOf(nextNonce)])
    assert.equal(block.block.receipts[0]?.transactionHash, replacementHash)
    assert.notEqual(replacementHash, hashOf(original))
  })
})

test('enforces transaction-count, per-sender, aggregate-byte, and single-transaction limits', async () => {
  await withStore(async (_directory, chain) => {
    const first = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    const second = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    const countPool = new DevelopmentSequencer(chain, { maxPendingTransactions: 1 })
    await countPool.submit(first.serialize())
    await assert.rejects(countPool.submit(second.serialize()), assertPoolCode(-32005))
    assert.throws(
      () => new DevelopmentSequencer(chain, { maxPendingTransactions: MAX_PENDING_TRANSACTIONS + 1 }),
      RangeError,
    )

    const senderPool = new DevelopmentSequencer(chain, {
      maxPendingTransactionsPerSender: 1,
    })
    await senderPool.submit(first.serialize())
    await assert.rejects(senderPool.submit(second.serialize()), assertPoolCode(-32005))
    assert.throws(
      () => new DevelopmentSequencer(chain, {
        maxPendingTransactionsPerSender: MAX_PENDING_TRANSACTIONS_PER_SENDER + 1,
      }),
      RangeError,
    )

    const bytePool = new DevelopmentSequencer(chain, {
      maxPendingBytes: first.serialize().length - 1,
    })
    await assert.rejects(bytePool.submit(first.serialize()), assertPoolCode(-32005))
    assert.throws(
      () => new DevelopmentSequencer(chain, { maxPendingBytes: MAX_PENDING_BYTES + 1 }),
      RangeError,
    )
  })
})

test('selects senders in deterministic address-sorted round-robin order', async () => {
  await withStore(async (_directory, chain) => {
    const keyA = hexToBytes(`0x${'22'.repeat(32)}`)
    const keyB = hexToBytes(`0x${'33'.repeat(32)}`)
    const addressA = createAddressFromPrivateKey(keyA)
    const addressB = createAddressFromPrivateKey(keyB)
    await chain.buildNextBlock([
      signFeeMarketTransaction({ nonce: 0n, to: addressA, value: 100n * ONE_ETHER, gasLimit: 21_000n }),
      signFeeMarketTransaction({ nonce: 1n, to: addressB, value: 100n * ONE_ETHER, gasLimit: 21_000n }),
    ], GENESIS_TIMESTAMP + 1n)

    const sequencer = new DevelopmentSequencer(chain)
    const a0 = signedBy(keyA, { nonce: 0n, to: addressA })
    const a1 = signedBy(keyA, { nonce: 1n, to: addressA })
    const b0 = signedBy(keyB, { nonce: 0n, to: addressB })
    const b1 = signedBy(keyB, { nonce: 1n, to: addressB })
    await assert.rejects(sequencer.submit(a1.serialize()), assertPoolCode(-32010))
    for (const transaction of [a0, a1, b0, b1]) await sequencer.submit(transaction.serialize())

    const firstAddress = addressA.toString().toLowerCase() < addressB.toString().toLowerCase()
      ? [a0, b0, a1, b1]
      : [b0, a0, b1, a1]
    const result = await sequencer.produceBlock()
    assert.deepEqual(result.includedTransactions, firstAddress.map(hashOf))
    assert.equal(result.block.receipts.length, 4)
  })
})

test('conservatively schedules gas-limited transactions across explicit blocks', async () => {
  await withStore(async (_directory, chain) => {
    const sequencer = new DevelopmentSequencer(chain)
    const gasLimit = 16_777_216n
    const first = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit })
    const second = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS, gasLimit })
    assert.ok(gasLimit * 2n > BLOCK_GAS_LIMIT)
    await sequencer.submit(first.serialize())
    await sequencer.submit(second.serialize())
    const block1 = await sequencer.produceBlock()
    assert.deepEqual(block1.includedTransactions, [hashOf(first)])
    const block2 = await sequencer.produceBlock()
    assert.deepEqual(block2.includedTransactions, [hashOf(second)])
  })
})

test('recovers a committed block when append reports failure after the canonical tip update', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-v014-post-tip-'))
  try {
    let failOnce = true
    const chain = await PersistentBlockProcessor.open(directory, {
      persistenceTestHook: (stage) => {
        if (stage === 'after-tip-commit' && failOnce) {
          failOnce = false
          throw new Error('injected post-commit failure')
        }
      },
    })
    const sequencer = new DevelopmentSequencer(chain)
    const first = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    const firstHash = await sequencer.submit(first.serialize())
    const result = await sequencer.produceBlock()
    assert.deepEqual(result.includedTransactions, [firstHash])
    assert.equal(result.block.number, '1')
    assert.equal(chain.tip.number, 1n)

    const second = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    await sequencer.submit(second.serialize())
    const next = await sequencer.produceBlock()
    assert.deepEqual(next.includedTransactions, [hashOf(second)])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('reconciles externally consumed pending nonces and returns the discarded hashes', async () => {
  await withStore(async (_directory, chain) => {
    const sequencer = new DevelopmentSequencer(chain)
    const pending = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    const pendingHash = await sequencer.submit(pending.serialize())

    const external = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, value: 1n })
    await chain.buildNextBlock([external], GENESIS_TIMESTAMP + 1n)
    const nextPending = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    await assert.rejects(sequencer.submit(nextPending.serialize()), assertPoolCode(-32012))

    const reconciliation = await sequencer.produceBlock()
    assert.deepEqual(reconciliation.includedTransactions, [])
    assert.deepEqual(reconciliation.discardedTransactions, [{
      transactionHash: pendingHash,
      reason: 'nonce-consumed-by-canonical-chain',
    }])
    assert.equal(reconciliation.block.number, '2')
    assert.equal((await sequencer.submit(nextPending.serialize())), hashOf(nextPending))
  })
})

test('retains pending transactions after a pre-tip failure and loses them on process restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-v014-restart-'))
  try {
    let failOnce = true
    const chain = await PersistentBlockProcessor.open(directory, {
      persistenceTestHook: (stage) => {
        if (stage === 'before-tip-update' && failOnce) {
          failOnce = false
          throw new Error('injected pre-tip failure')
        }
      },
    })
    const sequencer = new DevelopmentSequencer(chain)
    const transaction = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    const transactionHash = await sequencer.submit(transaction.serialize())
    await assert.rejects(sequencer.produceBlock(), assertPoolCode(-32013))
    assert.equal(chain.tip.number, 0n)
    const retried = await sequencer.produceBlock()
    assert.deepEqual(retried.includedTransactions, [transactionHash])

    const pending = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    const pendingHash = await sequencer.submit(pending.serialize())
    const reopened = await PersistentBlockProcessor.open(directory)
    const restartedSequencer = new DevelopmentSequencer(reopened)
    const empty = await restartedSequencer.produceBlock()
    assert.deepEqual(empty.includedTransactions, [])
    assert.equal(empty.block.receipts.length, 0)
    assert.ok(!empty.block.receipts.some((receipt) => receipt.transactionHash === pendingHash))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('executes deployment, successful calls, and reverted calls through explicit production', async () => {
  await withStore(async (_directory, chain) => {
    const compiled = compileCounter()
    const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
    const sequencer = new DevelopmentSequencer(chain)
    const deployment = signFeeMarketTransaction({
      nonce: 0n,
      data: compiled.creationBytecode,
      gasLimit: 500_000n,
    })
    const deploymentHash = await sequencer.submit(deployment.serialize())
    assert.equal(chain.tip.number, 0n)
    const deploymentBlock = await sequencer.produceBlock()
    assert.deepEqual(deploymentBlock.includedTransactions, [deploymentHash])
    assert.equal(deploymentBlock.block.receipts[0]?.status, 1)
    assert.ok((await chain.getCode(contractAddress)).length > 0)

    const incrementSelector = compiled.methodIdentifiers['increment()']
    const revertSelector = compiled.methodIdentifiers['incrementThenRevert()']
    assert.ok(incrementSelector)
    assert.ok(revertSelector)
    const increment = signFeeMarketTransaction({
      nonce: 1n,
      to: contractAddress,
      data: hexToBytes(`0x${incrementSelector}`),
      gasLimit: 150_000n,
    })
    await sequencer.submit(increment.serialize())
    const incremented = await sequencer.produceBlock()
    assert.equal(incremented.block.receipts[0]?.status, 1)
    assert.equal(incremented.block.receipts[0]?.logs.length, 1)
    assert.equal(BigInt(`0x${Buffer.from(await chain.getStorage(contractAddress, new Uint8Array(32))).toString('hex')}`), 1n)

    const revert = signFeeMarketTransaction({
      nonce: 2n,
      to: contractAddress,
      data: hexToBytes(`0x${revertSelector}`),
      gasLimit: 150_000n,
    })
    await sequencer.submit(revert.serialize())
    const reverted = await sequencer.produceBlock()
    assert.equal(reverted.block.receipts[0]?.status, 0)
    assert.deepEqual(reverted.block.receipts[0]?.logs, [])
    assert.equal(BigInt(`0x${Buffer.from(await chain.getStorage(contractAddress, new Uint8Array(32))).toString('hex')}`), 1n)
  })
})
