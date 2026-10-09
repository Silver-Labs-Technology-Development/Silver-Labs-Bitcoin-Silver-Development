import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import type { FeeMarket1559Tx } from '@ethereumjs/tx'
import type { Address } from '@ethereumjs/util'
import { EVM_CHAIN_ID, SENDER_PRIVATE_KEY, createHarnessCommon } from './config.js'

export type FeeMarketTransactionOptions = Readonly<{
  nonce: bigint
  to?: Address
  data?: Uint8Array
  chainId?: bigint
  gasLimit?: bigint
  value?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}>

export function signFeeMarketTransaction(
  options: FeeMarketTransactionOptions,
): FeeMarket1559Tx {
  const common = createHarnessCommon()
  return createFeeMarket1559Tx(
    {
      chainId: options.chainId ?? EVM_CHAIN_ID,
      nonce: options.nonce,
      gasLimit: options.gasLimit ?? 200_000n,
      maxPriorityFeePerGas: options.maxPriorityFeePerGas ?? 1_000_000_000n,
      maxFeePerGas: options.maxFeePerGas ?? 2_000_000_000n,
      to: options.to,
      value: options.value ?? 0n,
      data: options.data ?? new Uint8Array(),
    },
    { common },
  ).sign(SENDER_PRIVATE_KEY)
}
