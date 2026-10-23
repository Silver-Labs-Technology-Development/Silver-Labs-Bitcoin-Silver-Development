import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import type { FeeMarket1559Tx } from '@ethereumjs/tx'
import type { Address } from '@ethereumjs/util'
import { EVM_CHAIN_ID, SENDER_PRIVATE_KEY, createHarnessCommon } from './config.js'

/** Local signer defaults. Simulations use these when a call omits fees. */
export const DEFAULT_MAX_PRIORITY_FEE_PER_GAS = 1_000_000_000n
export const DEFAULT_MAX_FEE_PER_GAS = 2_000_000_000n

export type FeeMarketTransactionOptions = Readonly<{
  nonce: bigint
  to?: Address
  data?: Uint8Array
  chainId?: bigint
  gasLimit?: bigint
  value?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  /** Test/local signing key. Defaults to the funded local development key. */
  privateKey?: Uint8Array
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
      maxPriorityFeePerGas: options.maxPriorityFeePerGas ?? DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
      maxFeePerGas: options.maxFeePerGas ?? DEFAULT_MAX_FEE_PER_GAS,
      to: options.to,
      value: options.value ?? 0n,
      data: options.data ?? new Uint8Array(),
    },
    { common },
  ).sign(options.privateKey ?? SENDER_PRIVATE_KEY)
}
