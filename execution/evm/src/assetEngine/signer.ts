import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { createFeeMarket1559Tx, createLegacyTx } from '@ethereumjs/tx'
import { bytesToHex, createAddressFromPrivateKey, createAddressFromString } from '@ethereumjs/util'
import { createHarnessCommon } from '../config.js'
import { type FeeFields } from './fees.js'
import { AssetEngineError } from './errors.js'
import { type NetworkProfile } from './networks.js'

export type UnsignedCall = {
  nonce: bigint
  gasLimit: bigint
  to?: string
  data: Uint8Array
  fees: FeeFields
}

export type SignedCall = {
  raw: Uint8Array
  hash: string
  chainId: bigint
  type: number
  gasPrice?: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
}

function legacyChainId(v: bigint | undefined): bigint {
  if (v === undefined || v < 35n) {
    throw new AssetEngineError('legacy transaction is missing an EIP-155 chain id')
  }
  return (v - 35n) / 2n
}

export class PrivateKeySigner {
  readonly address: string

  constructor(private readonly privateKey: Uint8Array) {
    if (privateKey.length !== 32) throw new AssetEngineError('private key must be 32 bytes')
    this.address = createAddressFromPrivateKey(privateKey).toString().toLowerCase()
  }

  sign(profile: NetworkProfile, unsigned: UnsignedCall): SignedCall {
    if (unsigned.fees.networkId !== profile.id || unsigned.fees.chainId !== profile.chainId) {
      throw new AssetEngineError('refusing to sign a fee quote for a different network')
    }
    if (unsigned.fees.nativeSymbol !== profile.nativeGas.symbol) {
      throw new AssetEngineError('refusing to sign a fee quote with the wrong gas symbol')
    }
    const to = unsigned.to === undefined ? undefined : createAddressFromString(unsigned.to)
    if (profile.kind === 'btcs-l2-local') {
      if (unsigned.fees.model !== 'eip-1559' || unsigned.fees.maxFeePerGas === undefined || unsigned.fees.maxPriorityFeePerGas === undefined) {
        throw new AssetEngineError('BTCS L2 local transactions are EIP-1559 type 2')
      }
      const tx = createFeeMarket1559Tx({
        chainId: BigInt(profile.chainId),
        nonce: unsigned.nonce,
        gasLimit: unsigned.gasLimit,
        maxFeePerGas: unsigned.fees.maxFeePerGas,
        maxPriorityFeePerGas: unsigned.fees.maxPriorityFeePerGas,
        value: 0n,
        data: unsigned.data,
        ...(to === undefined ? {} : { to }),
      }, { common: createHarnessCommon() }).sign(this.privateKey)
      return {
        raw: tx.serialize(),
        hash: bytesToHex(tx.hash()).toLowerCase(),
        chainId: tx.chainId,
        type: tx.type,
        maxFeePerGas: tx.maxFeePerGas,
        maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
      }
    }

    const common = createCustomCommon(
      { name: profile.id, chainId: profile.chainId },
      Mainnet,
      { hardfork: Hardfork.London },
    )
    if (unsigned.fees.model === 'legacy') {
      if (unsigned.fees.gasPrice === undefined) throw new AssetEngineError(`${profile.id} legacy fee is missing gasPrice`)
      const tx = createLegacyTx({
        nonce: unsigned.nonce,
        gasPrice: unsigned.fees.gasPrice,
        gasLimit: unsigned.gasLimit,
        value: 0n,
        data: unsigned.data,
        ...(to === undefined ? {} : { to }),
      }, { common }).sign(this.privateKey)
      const chainId = legacyChainId(tx.v)
      if (chainId !== BigInt(profile.chainId)) {
        throw new AssetEngineError(`${profile.id} signed a legacy transaction for chain ${chainId}`)
      }
      return {
        raw: tx.serialize(),
        hash: bytesToHex(tx.hash()).toLowerCase(),
        chainId,
        type: tx.type,
        gasPrice: tx.gasPrice,
      }
    }

    if (unsigned.fees.maxFeePerGas === undefined || unsigned.fees.maxPriorityFeePerGas === undefined) {
      throw new AssetEngineError(`${profile.id} EIP-1559 fee is incomplete`)
    }
    const tx = createFeeMarket1559Tx({
      chainId: BigInt(profile.chainId),
      nonce: unsigned.nonce,
      gasLimit: unsigned.gasLimit,
      maxFeePerGas: unsigned.fees.maxFeePerGas,
      maxPriorityFeePerGas: unsigned.fees.maxPriorityFeePerGas,
      value: 0n,
      data: unsigned.data,
      ...(to === undefined ? {} : { to }),
    }, { common }).sign(this.privateKey)
    if (tx.chainId !== BigInt(profile.chainId)) {
      throw new AssetEngineError(`${profile.id} signed a transaction for chain ${tx.chainId}`)
    }
    return {
      raw: tx.serialize(),
      hash: bytesToHex(tx.hash()).toLowerCase(),
      chainId: tx.chainId,
      type: tx.type,
      maxFeePerGas: tx.maxFeePerGas,
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas,
    }
  }
}
