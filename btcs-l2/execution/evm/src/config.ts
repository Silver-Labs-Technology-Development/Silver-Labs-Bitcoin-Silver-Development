import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { createAddressFromPrivateKey, createZeroAddress, hexToBytes } from '@ethereumjs/util'

export const EVM_CHAIN_ID = 31337n
export const EVM_HARDFORK = Hardfork.Osaka
export const SENDER_PRIVATE_KEY_HEX = `0x${'11'.repeat(32)}`
export const SENDER_PRIVATE_KEY = hexToBytes(SENDER_PRIVATE_KEY_HEX as `0x${string}`)
export const SENDER_ADDRESS = createAddressFromPrivateKey(SENDER_PRIVATE_KEY)

export const GENESIS_BALANCE = 10_000n * 10n ** 18n
export const FIXED_BLOCK_CONTEXT = Object.freeze({
  parentHash: new Uint8Array(32),
  number: 1n,
  timestamp: 1_750_000_000n,
  gasLimit: 30_000_000n,
  baseFeePerGas: 1_000_000_000n,
  difficulty: 0n,
  coinbase: createZeroAddress(),
  mixHash: new Uint8Array(32),
  blobGasUsed: 0n,
  excessBlobGas: 0n,
  parentBeaconBlockRoot: new Uint8Array(32),
})

export type BlockContext = Readonly<{
  parentHash: Uint8Array
  number: bigint
  timestamp: bigint
  gasLimit: bigint
  baseFeePerGas: bigint
  difficulty: bigint
  coinbase: ReturnType<typeof createZeroAddress>
  mixHash: Uint8Array
  blobGasUsed: bigint
  excessBlobGas: bigint
  parentBeaconBlockRoot: Uint8Array
}>

export function createHarnessCommon() {
  return createCustomCommon(
    {
      name: 'btcs-l2-local-evm-harness',
      chainId: Number(EVM_CHAIN_ID),
    },
    Mainnet,
    { hardfork: EVM_HARDFORK },
  )
}
