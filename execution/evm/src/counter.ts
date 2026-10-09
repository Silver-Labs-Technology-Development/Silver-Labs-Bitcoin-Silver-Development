import { createContractAddress } from '@ethereumjs/util'
import { hexToBytes } from '@ethereumjs/util'
import { FIXED_BLOCK_CONTEXT, SENDER_ADDRESS } from './config.js'
import { compileCounter } from './compile.js'
import { executeOrderedTransactions } from './harness.js'
import { signFeeMarketTransaction } from './transactions.js'

export async function runCounterPrototype() {
  const compiled = compileCounter()
  const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
  const increment = compiled.methodIdentifiers['increment()']
  const incrementThenRevert = compiled.methodIdentifiers['incrementThenRevert()']
  if (increment === undefined || incrementThenRevert === undefined) {
    throw new Error('Counter compiler output is missing a required method selector')
  }

  const transactions = [
    {
      label: 'deploy Counter',
      tx: signFeeMarketTransaction({
        nonce: 0n,
        data: compiled.creationBytecode,
        gasLimit: 500_000n,
      }),
    },
    {
      label: 'increment',
      tx: signFeeMarketTransaction({
        nonce: 1n,
        to: contractAddress,
        data: hexToBytes(`0x${increment}`),
        gasLimit: 150_000n,
      }),
    },
    {
      label: 'increment then revert',
      tx: signFeeMarketTransaction({
        nonce: 2n,
        to: contractAddress,
        data: hexToBytes(`0x${incrementThenRevert}`),
        gasLimit: 150_000n,
      }),
    },
  ] as const

  const report = await executeOrderedTransactions(transactions, FIXED_BLOCK_CONTEXT)
  return { contractAddress: contractAddress.toString(), report, compilerVersion: compiled.compilerVersion }
}
