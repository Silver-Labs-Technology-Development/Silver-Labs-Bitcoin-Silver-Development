import {
  DEFAULT_MAX_FEE_PER_GAS,
  DEFAULT_MAX_PRIORITY_FEE_PER_GAS,
} from '../transactions.js'
import { AssetEngineError } from './errors.js'
import { type NetworkProfile } from './networks.js'

export type FeeObservation = {
  /** Present when the latest block reports `baseFeePerGas`, including zero. */
  baseFeePerGas: bigint | undefined
  gasPrice: bigint | undefined
  priorityFee: bigint | undefined
}

export type FeeFields = {
  networkId: string
  chainId: number
  nativeSymbol: string
  nativeDecimals: 18
  model: 'eip-1559' | 'legacy'
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
}

/**
 * Choose the fee fields for one network from that network's rules and the
 * block the caller observed. BTCS L2 local stays on its EIP-1559 signer
 * defaults. Ethereum and BNB Smart Chain follow the connected block and keep
 * their own native symbols.
 */
export function feeFieldsForProfile(profile: NetworkProfile, observation: FeeObservation): FeeFields {
  const base = {
    networkId: profile.id,
    chainId: profile.chainId,
    nativeSymbol: profile.nativeGas.symbol,
    nativeDecimals: 18 as const,
  }
  if (profile.feeMarket === 'eip-1559-only') {
    if (observation.baseFeePerGas === undefined) {
      throw new AssetEngineError(`${profile.id} gas is EIP-1559 only and the block did not report a base fee`)
    }
    let maxPriorityFeePerGas = DEFAULT_MAX_PRIORITY_FEE_PER_GAS
    let maxFeePerGas = DEFAULT_MAX_FEE_PER_GAS
    const required = observation.baseFeePerGas + maxPriorityFeePerGas
    if (maxFeePerGas < required) maxFeePerGas = required
    if (maxPriorityFeePerGas > maxFeePerGas) maxPriorityFeePerGas = maxFeePerGas
    return { ...base, model: 'eip-1559', maxFeePerGas, maxPriorityFeePerGas }
  }

  if (observation.baseFeePerGas !== undefined) {
    const priority = observation.priorityFee ?? profile.fallbackPriorityFee
    if (priority === null || priority === undefined) {
      throw new AssetEngineError(`${profile.id} has a base fee and no priority fee`)
    }
    if (priority < 0n) throw new AssetEngineError(`${profile.id} priority fee is negative`)
    const maxFeePerGas = observation.baseFeePerGas * 2n + priority
    if (maxFeePerGas < observation.baseFeePerGas) {
      throw new AssetEngineError(`${profile.id} max fee is below the block base fee`)
    }
    return {
      ...base,
      model: 'eip-1559',
      maxFeePerGas,
      maxPriorityFeePerGas: priority,
    }
  }

  if (observation.gasPrice === undefined || observation.gasPrice <= 0n) {
    throw new AssetEngineError(`${profile.id} legacy gas requires eth_gasPrice above zero`)
  }
  return { ...base, model: 'legacy', gasPrice: observation.gasPrice }
}

export function nativeFeeCeiling(fields: FeeFields, gasLimit: bigint): bigint {
  if (gasLimit <= 0n) throw new AssetEngineError('gas limit must be positive')
  const price = fields.model === 'legacy' ? fields.gasPrice : fields.maxFeePerGas
  if (price === undefined) throw new AssetEngineError(`${fields.networkId} fee quote is incomplete`)
  return gasLimit * price
}
