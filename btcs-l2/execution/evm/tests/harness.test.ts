import assert from 'node:assert/strict'
import { test } from 'node:test'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { MerklePatriciaTrie } from '@ethereumjs/mpt'
import { RLP } from '@ethereumjs/rlp'
import { createFeeMarket1559Tx, createLegacyTx } from '@ethereumjs/tx'
import { createContractAddress, bytesToHex, hexToBytes, utf8ToBytes } from '@ethereumjs/util'
import {
  EVM_CHAIN_ID,
  FIXED_BLOCK_CONTEXT,
  GENESIS_BALANCE,
  SENDER_ADDRESS,
  SENDER_PRIVATE_KEY,
  createHarnessCommon,
} from '../src/config.js'
import { compileCounter } from '../src/compile.js'
import { runCounterPrototype } from '../src/counter.js'
import { executeOrderedTransactions } from '../src/harness.js'
import { signFeeMarketTransaction } from '../src/transactions.js'

function eventTopic(signature: string): string {
  return bytesToHex(keccak_256(utf8ToBytes(signature)))
}

test('Counter deploy, call, revert, roots, receipts, and deterministic replay', async () => {
  const first = await runCounterPrototype()
  const replay = await runCounterPrototype()
  const [deployment, increment, reverted] = first.report.transactions

  assert.ok(deployment)
  assert.ok(increment)
  assert.ok(reverted)
  assert.equal(first.contractAddress, deployment.createdAddress)
  assert.equal(deployment.status, 1)
  assert.equal(deployment.counterSlot0After, '0')
  assert.equal(increment.status, 1)
  assert.equal(increment.counterSlot0After, '1')
  assert.equal(increment.senderAddress, SENDER_ADDRESS.toString())
  assert.equal(deployment.senderNonceAfter, '1')
  assert.equal(increment.senderNonceAfter, '2')
  assert.ok(BigInt(increment.gasUsed) > 0n)
  assert.equal(increment.logs.length, 1)
  assert.deepEqual(increment.logs[0]?.topics, [eventTopic('Incremented(uint256)')])
  assert.equal(increment.logs[0]?.data, `0x${'00'.repeat(31)}01`)
  assert.equal(reverted.status, 0)
  assert.equal(reverted.counterSlot0After, '1')
  assert.deepEqual(reverted.logs, [])
  assert.equal(reverted.senderNonceAfter, '3')
  assert.ok(BigInt(reverted.senderBalanceAfter) < BigInt(increment.senderBalanceAfter))
  assert.notEqual(reverted.stateRootAfter, increment.stateRootAfter)
  assert.match(first.report.transactionsTrieRoot, /^0x[0-9a-f]{64}$/)
  assert.match(first.report.stateRoot, /^0x[0-9a-f]{64}$/)
  assert.equal(first.report.chainId, '31337')
  assert.equal(first.report.hardfork, 'osaka')

  assert.equal(first.report.genesisStateRoot, replay.report.genesisStateRoot)
  assert.deepEqual(first.report.blockContext, replay.report.blockContext)
  assert.equal(first.report.transactionsTrieRoot, replay.report.transactionsTrieRoot)
  assert.equal(first.report.stateRoot, replay.report.stateRoot)
  assert.equal(first.report.totalGasUsed, replay.report.totalGasUsed)
  assert.deepEqual(first.report.transactions, replay.report.transactions)

  const compiled = compileCounter()
  const incrementSelector = compiled.methodIdentifiers['increment()']
  const revertSelector = compiled.methodIdentifiers['incrementThenRevert()']
  assert.ok(incrementSelector)
  assert.ok(revertSelector)
  const orderedSignedTransactions = [
    signFeeMarketTransaction({ nonce: 0n, data: compiled.creationBytecode, gasLimit: 500_000n }),
    signFeeMarketTransaction({
      nonce: 1n,
      to: createContractAddress(SENDER_ADDRESS, 0n),
      data: hexToBytes(`0x${incrementSelector}`),
      gasLimit: 150_000n,
    }),
    signFeeMarketTransaction({
      nonce: 2n,
      to: createContractAddress(SENDER_ADDRESS, 0n),
      data: hexToBytes(`0x${revertSelector}`),
      gasLimit: 150_000n,
    }),
  ]
  const independentTransactionsTrie = new MerklePatriciaTrie()
  for (const [index, tx] of orderedSignedTransactions.entries()) {
    await independentTransactionsTrie.put(RLP.encode(index), tx.serialize())
  }
  assert.equal(first.report.transactionsTrieRoot, bytesToHex(independentTransactionsTrie.root()))
})

test('rejects a signed transaction for a different EVM chain ID', async () => {
  const wrongChainCommon = createCustomCommon(
    { name: 'btcs-l2-wrong-chain-test', chainId: Number(EVM_CHAIN_ID + 1n) },
    Mainnet,
    { hardfork: Hardfork.Osaka },
  )
  const wrongChainTransaction = createFeeMarket1559Tx(
    {
      chainId: EVM_CHAIN_ID + 1n,
      nonce: 0n,
      gasLimit: 21_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      to: SENDER_ADDRESS,
      value: 0n,
    },
    { common: wrongChainCommon },
  ).sign(SENDER_PRIVATE_KEY)

  await assert.rejects(
    executeOrderedTransactions(
      [{ label: 'wrong chain id', tx: wrongChainTransaction }],
      FIXED_BLOCK_CONTEXT,
    ),
    /chain ID/,
  )
})

test('rejects a signed transaction with an invalid nonce', async () => {
  const invalidNonce = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS, gasLimit: 21_000n })
  await assert.rejects(
    executeOrderedTransactions([{ label: 'nonce gap', tx: invalidNonce }], FIXED_BLOCK_CONTEXT),
  )
})

test('executes transactions in supplied order and does not sort by nonce', async () => {
  const contract = createContractAddress(SENDER_ADDRESS, 0n)
  const nonceOne = signFeeMarketTransaction({ nonce: 1n, to: contract })
  const nonceZero = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })

  await assert.rejects(
    executeOrderedTransactions(
      [
        { label: 'later nonce first', tx: nonceOne },
        { label: 'earlier nonce second', tx: nonceZero },
      ],
      FIXED_BLOCK_CONTEXT,
    ),
  )
})

test('uses an explicit block context for each execution', async () => {
  const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
  const report = await executeOrderedTransactions(
    [{ label: 'fixed transfer', tx }],
    {
      ...FIXED_BLOCK_CONTEXT,
      number: 9n,
      timestamp: 1_750_000_009n,
      gasLimit: 25_000n,
      baseFeePerGas: 1_000_000_000n,
    },
  )
  assert.deepEqual(report.blockContext, {
    parentHash: `0x${'00'.repeat(32)}`,
    coinbase: '0x0000000000000000000000000000000000000000',
    difficulty: '0',
    number: '9',
    timestamp: '1750000009',
    gasLimit: '25000',
    baseFeePerGas: '1000000000',
    mixHash: `0x${'00'.repeat(32)}`,
    blobGasUsed: '0',
    excessBlobGas: '0',
    parentBeaconBlockRoot: `0x${'00'.repeat(32)}`,
    withdrawalsRoot: '0x56e81f171bcc55a6ff8345e692c0f86e5b48e01b996cadc001622fb5e363b421',
    requestsHash: '0xe3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  })
  assert.match(report.stateRoot, /^0x[0-9a-f]{64}$/)
})

test('re-decodes a transaction under the pinned Common instead of trusting its Common', async () => {
  const alteredCommon = createHarnessCommon()
  const foreignCommonTx = createFeeMarket1559Tx(
    {
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 30_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      to: SENDER_ADDRESS,
      value: 0n,
      data: Uint8Array.of(1),
    },
    { common: alteredCommon },
  )
  // Simulate a caller Common that retains a non-protocol calldata gas price.
  foreignCommonTx.common.updateParams({ 1679: { txDataNonZeroGas: 1 } })
  assert.equal(foreignCommonTx.common.param('txDataNonZeroGas'), 1n)
  const foreignCommonSigned = foreignCommonTx.sign(SENDER_PRIVATE_KEY)
  const canonicalSigned = signFeeMarketTransaction({
    nonce: 0n,
    to: SENDER_ADDRESS,
    gasLimit: 30_000n,
    data: Uint8Array.of(1),
  })

  const foreignReport = await executeOrderedTransactions(
    [{ label: 'foreign Common bytes', tx: foreignCommonSigned }],
    FIXED_BLOCK_CONTEXT,
  )
  const canonicalReport = await executeOrderedTransactions(
    [{ label: 'canonical Common bytes', tx: canonicalSigned }],
    FIXED_BLOCK_CONTEXT,
  )
  assert.equal(foreignReport.transactions[0]?.gasUsed, canonicalReport.transactions[0]?.gasUsed)
  assert.equal(foreignReport.stateRoot, canonicalReport.stateRoot)
  assert.equal(foreignReport.transactionsTrieRoot, canonicalReport.transactionsTrieRoot)
})

test('rejects unsigned, malformed, and non-type-2 transaction encodings', async () => {
  const unsigned = createFeeMarket1559Tx(
    {
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 21_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      to: SENDER_ADDRESS,
      value: 0n,
    },
    { common: createHarnessCommon() },
  )
  await assert.rejects(
    executeOrderedTransactions([{ label: 'unsigned', tx: unsigned }], FIXED_BLOCK_CONTEXT),
    /no signature/,
  )

  const invalidSignature = createFeeMarket1559Tx(
    {
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 21_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      to: SENDER_ADDRESS,
      value: 0n,
      v: 0n,
      r: 0n,
      s: 1n,
    },
    { common: createHarnessCommon() },
  )
  await assert.rejects(
    executeOrderedTransactions([{ label: 'invalid signature', tx: invalidSignature }], FIXED_BLOCK_CONTEXT),
    /invalid signature/,
  )

  const malformed = {
    type: 2,
    serialize: () => Uint8Array.of(0x02, 0xff),
  } as unknown as ReturnType<typeof signFeeMarketTransaction>
  await assert.rejects(
    executeOrderedTransactions([{ label: 'malformed', tx: malformed }], FIXED_BLOCK_CONTEXT),
    /invalid EIP-1559 encoding or fields/,
  )

  const legacy = createLegacyTx(
    {
      nonce: 0n,
      gasPrice: 2_000_000_000n,
      gasLimit: 21_000n,
      to: SENDER_ADDRESS,
      value: 0n,
    },
    { common: createHarnessCommon() },
  )
  await assert.rejects(
    executeOrderedTransactions(
      [{ label: 'legacy type', tx: legacy as unknown as ReturnType<typeof signFeeMarketTransaction> }],
      FIXED_BLOCK_CONTEXT,
    ),
    /not an EIP-1559 type-2 transaction/,
  )
})

test('rejects intrinsic-gas, base-fee, and insufficient-balance transactions', async () => {
  const lowIntrinsicGas = signFeeMarketTransaction({
    nonce: 0n,
    to: SENDER_ADDRESS,
    gasLimit: 20_999n,
  })
  await assert.rejects(
    executeOrderedTransactions([{ label: 'below intrinsic gas', tx: lowIntrinsicGas }], FIXED_BLOCK_CONTEXT),
    /invalid|minimum gas|gasLimit/i,
  )

  const normalTx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
  await assert.rejects(
    executeOrderedTransactions(
      [{ label: 'fee below base fee', tx: normalTx }],
      { ...FIXED_BLOCK_CONTEXT, baseFeePerGas: 2_000_000_001n },
    ),
    /base fee/,
  )

  const overdraw = signFeeMarketTransaction({
    nonce: 0n,
    to: SENDER_ADDRESS,
    gasLimit: 21_000n,
    value: GENESIS_BALANCE,
  })
  await assert.rejects(
    executeOrderedTransactions([{ label: 'insufficient upfront balance', tx: overdraw }], FIXED_BLOCK_CONTEXT),
    /balance|fund|cost/i,
  )
})

test('rejects a transaction whose reserved gas exceeds remaining Osaka block gas', async () => {
  const first = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 25_000n })
  const second = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS, gasLimit: 25_000n })
  await assert.rejects(
    executeOrderedTransactions(
      [
        { label: 'first transaction', tx: first },
        { label: 'reserved gas over limit', tx: second },
      ],
      { ...FIXED_BLOCK_CONTEXT, gasLimit: 42_000n },
    ),
    /remaining block gas limit/,
  )
})

test('enforces Osaka transaction-gas and initcode protocol maxima', async () => {
  const preOsakaCommon = () =>
    createCustomCommon(
      { name: 'pre-osaka-limit-vector', chainId: Number(EVM_CHAIN_ID) },
      Mainnet,
      { hardfork: Hardfork.Paris },
    )
  const overTransactionGasLimit = createFeeMarket1559Tx(
    {
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 16_777_217n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      to: SENDER_ADDRESS,
      value: 0n,
    },
    { common: preOsakaCommon() },
  ).sign(SENDER_PRIVATE_KEY)
  await assert.rejects(
    executeOrderedTransactions(
      [{ label: 'above EIP-7825 transaction gas maximum', tx: overTransactionGasLimit }],
      FIXED_BLOCK_CONTEXT,
    ),
    /maximum allowed by EIP-7825 \(16777216\)/,
  )

  const oversizedInitcode = createFeeMarket1559Tx(
    {
      chainId: EVM_CHAIN_ID,
      nonce: 0n,
      gasLimit: 1_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      maxFeePerGas: 2_000_000_000n,
      value: 0n,
      data: new Uint8Array(49_153),
    },
    { common: preOsakaCommon() },
  ).sign(SENDER_PRIVATE_KEY)
  await assert.rejects(
    executeOrderedTransactions(
      [{ label: 'above EIP-3860 initcode maximum', tx: oversizedInitcode }],
      FIXED_BLOCK_CONTEXT,
    ),
    /initcode size .* too large.*max is 49152/,
  )
})

test('failed Counter deployment consumes nonce and gas without leaving code', async () => {
  const compiled = compileCounter()
  const normallyFundedDeployment = signFeeMarketTransaction({
    nonce: 0n,
    data: compiled.creationBytecode,
    gasLimit: 500_000n,
  })
  const almostIntrinsicOnlyDeployment = signFeeMarketTransaction({
    nonce: 0n,
    data: compiled.creationBytecode,
    gasLimit: normallyFundedDeployment.getIntrinsicGas() + 500n,
  })
  const report = await executeOrderedTransactions(
    [{ label: 'out-of-gas deployment', tx: almostIntrinsicOnlyDeployment }],
    FIXED_BLOCK_CONTEXT,
  )
  const deployment = report.transactions[0]
  assert.ok(deployment)
  assert.equal(deployment.status, 0)
  assert.equal(deployment.deploymentCodeBytesAfter, 0)
  assert.equal(deployment.senderNonceAfter, '1')
  assert.equal(deployment.gasUsed, almostIntrinsicOnlyDeployment.gasLimit.toString())
  assert.deepEqual(deployment.logs, [])
})

test('out-of-gas Counter call rolls back storage and logs but keeps nonce and gas effects', async () => {
  const compiled = compileCounter()
  const contract = createContractAddress(SENDER_ADDRESS, 0n)
  const increment = compiled.methodIdentifiers['increment()']
  assert.ok(increment)
  const report = await executeOrderedTransactions(
    [
      {
        label: 'deploy Counter',
        tx: signFeeMarketTransaction({ nonce: 0n, data: compiled.creationBytecode, gasLimit: 500_000n }),
      },
      {
        label: 'out-of-gas increment',
        tx: signFeeMarketTransaction({
          nonce: 1n,
          to: contract,
          data: hexToBytes(`0x${increment}`),
          gasLimit: 23_000n,
        }),
      },
    ],
    FIXED_BLOCK_CONTEXT,
  )
  const failedCall = report.transactions[1]
  assert.ok(failedCall)
  assert.equal(failedCall.status, 0)
  assert.equal(failedCall.counterSlot0After, '0')
  assert.deepEqual(failedCall.logs, [])
  assert.equal(failedCall.senderNonceAfter, '2')
  assert.equal(failedCall.gasUsed, '23000')
  assert.ok(BigInt(failedCall.senderBalanceAfter) < BigInt(report.transactions[0]!.senderBalanceAfter))
})
