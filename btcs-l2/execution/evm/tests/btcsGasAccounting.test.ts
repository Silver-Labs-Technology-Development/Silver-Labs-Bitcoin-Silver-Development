import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { FeeMarket1559Tx } from '@ethereumjs/tx'
import { Address, createContractAddress, createZeroAddress, hexToBytes } from '@ethereumjs/util'
import {
  GENESIS_BASE_FEE,
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
} from '../src/blockProcessor.js'
import { EVM_CHAIN_ID, GENESIS_BALANCE, SENDER_ADDRESS } from '../src/config.js'
import { compileCounter } from '../src/compile.js'
import { SATOSHI_TO_WEI } from '../src/depositPrelude.js'
import { signFeeMarketTransaction } from '../src/transactions.js'

const ONE_BTCS_SATS = 100_000_000n
const RECIPIENT = new Address(hexToBytes('0x00000000000000000000000000000000000000aa'))
const COINBASE = createZeroAddress()

function effectiveGasPrice(tx: FeeMarket1559Tx, baseFee: bigint): bigint {
  const price = baseFee + tx.getEffectivePriorityFee(baseFee)
  assert.ok(price > 0n)
  assert.ok(price <= tx.maxFeePerGas)
  return price
}

async function withStore<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-gas-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test('one L1 BTCS maps onto one 10^18 L2 native unit', () => {
  assert.equal(SATOSHI_TO_WEI, 10n ** 10n)
  assert.equal(ONE_BTCS_SATS * SATOSHI_TO_WEI, 10n ** 18n)
  assert.equal(GENESIS_BASE_FEE, 1_000_000_000n)
  assert.equal(EVM_CHAIN_ID, 31337n)
})

test('a native transfer debits BTCS-denominated gas separately from the transferred value', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const value = 10n ** 18n
    const tx = signFeeMarketTransaction({
      nonce: 0n,
      to: RECIPIENT,
      value,
      gasLimit: 21_000n,
    })
    assert.equal(tx.chainId, EVM_CHAIN_ID)

    const senderBefore = await chain.getAccountBalance(SENDER_ADDRESS)
    const coinbaseBefore = await chain.getAccountBalance(COINBASE)
    assert.equal(senderBefore, GENESIS_BALANCE)
    assert.equal(coinbaseBefore, 0n)
    assert.equal(await chain.getAccountBalance(RECIPIENT), 0n)

    const built = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const receipt = built.summary.receipts[0]
    assert.ok(receipt)
    assert.equal(receipt.status, 1)
    const gasUsed = BigInt(receipt.gasUsed)
    assert.equal(gasUsed, 21_000n)
    const baseFee = BigInt(built.summary.baseFeePerGas)
    const price = effectiveGasPrice(tx, baseFee)
    const fee = gasUsed * price
    const priorityFee = gasUsed * tx.getEffectivePriorityFee(baseFee)
    const baseFeeCharge = gasUsed * baseFee
    assert.equal(fee, priorityFee + baseFeeCharge)
    assert.ok(priorityFee > 0n)
    assert.ok(baseFeeCharge > 0n)

    const senderAfter = senderBefore - value - fee
    assert.equal(await chain.getAccountBalance(SENDER_ADDRESS), senderAfter)
    assert.equal(await chain.getAccountBalance(RECIPIENT), value)
    assert.equal(await chain.getAccountBalance(COINBASE), coinbaseBefore + priorityFee)

    const reopened = await PersistentBlockProcessor.open(directory)
    assert.equal(await reopened.getAccountBalance(SENDER_ADDRESS), senderAfter)
    assert.equal(await reopened.getAccountBalance(RECIPIENT), value)
    assert.equal(await reopened.getAccountBalance(COINBASE), priorityFee)
    assert.equal(reopened.tip.hash, built.summary.hash)
  })
})

test('contract calls and reverted calls still charge native gas and do not credit the contract', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const compiled = compileCounter()
    const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
    const revertSelector = compiled.methodIdentifiers['incrementThenRevert()']
    const incrementSelector = compiled.methodIdentifiers['increment()']
    assert.ok(revertSelector)
    assert.ok(incrementSelector)

    const deployment = signFeeMarketTransaction({
      nonce: 0n,
      data: compiled.creationBytecode,
      gasLimit: 500_000n,
    })
    const deployed = await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    assert.equal(deployed.summary.receipts[0]?.status, 1)
    const senderAfterDeploy = await chain.getAccountBalance(SENDER_ADDRESS)
    assert.ok(senderAfterDeploy < GENESIS_BALANCE)
    assert.equal(await chain.getAccountBalance(contractAddress), 0n)

    const revertCall = signFeeMarketTransaction({
      nonce: 1n,
      to: contractAddress,
      data: hexToBytes(`0x${revertSelector}`),
      gasLimit: 150_000n,
    })
    const reverted = await chain.buildNextBlock([revertCall], GENESIS_TIMESTAMP + 2n)
    const revertedReceipt = reverted.summary.receipts[0]
    assert.ok(revertedReceipt)
    assert.equal(revertedReceipt.status, 0)
    assert.deepEqual(revertedReceipt.logs, [])
    const revertGas = BigInt(revertedReceipt.gasUsed)
    assert.ok(revertGas > 0n)
    const revertFee = revertGas * effectiveGasPrice(revertCall, BigInt(reverted.summary.baseFeePerGas))
    assert.equal(await chain.getAccountBalance(SENDER_ADDRESS), senderAfterDeploy - revertFee)
    assert.equal(await chain.getAccountBalance(contractAddress), 0n)
    assert.equal(await chain.getAccountNonce(SENDER_ADDRESS), 2n)

    const senderAfterRevert = await chain.getAccountBalance(SENDER_ADDRESS)
    const increment = signFeeMarketTransaction({
      nonce: 2n,
      to: contractAddress,
      data: hexToBytes(`0x${incrementSelector}`),
      gasLimit: 150_000n,
    })
    const incremented = await chain.buildNextBlock([increment], GENESIS_TIMESTAMP + 3n)
    const incrementReceipt = incremented.summary.receipts[0]
    assert.ok(incrementReceipt)
    assert.equal(incrementReceipt.status, 1)
    const incrementGas = BigInt(incrementReceipt.gasUsed)
    const incrementFee = incrementGas * effectiveGasPrice(
      increment,
      BigInt(incremented.summary.baseFeePerGas),
    )
    assert.equal(await chain.getAccountBalance(SENDER_ADDRESS), senderAfterRevert - incrementFee)
    assert.equal(await chain.getAccountBalance(contractAddress), 0n)
    // Deployment sets the contract nonce to 1. Later calls do not spend it:
    // the sender account pays the native gas charge.
    assert.equal(await chain.getAccountNonce(contractAddress), 1n)
  })
})

test('an underfunded native transfer is rejected and does not debit gas or value', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const senderBefore = await chain.getAccountBalance(SENDER_ADDRESS)
    const tipBefore = chain.tip.hash
    const overdraw = signFeeMarketTransaction({
      nonce: 0n,
      to: RECIPIENT,
      value: GENESIS_BALANCE,
      gasLimit: 21_000n,
    })
    await assert.rejects(
      chain.buildNextBlock([overdraw], GENESIS_TIMESTAMP + 1n),
      /balance|fund|cost|insufficient/i,
    )
    assert.equal(chain.tip.hash, tipBefore)
    assert.equal(await chain.getAccountBalance(SENDER_ADDRESS), senderBefore)
    assert.equal(await chain.getAccountBalance(RECIPIENT), 0n)
    assert.equal(await chain.getAccountNonce(SENDER_ADDRESS), 0n)
  })
})
