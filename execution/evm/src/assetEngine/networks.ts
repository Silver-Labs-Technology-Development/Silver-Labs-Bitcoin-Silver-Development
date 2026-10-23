import { EVM_CHAIN_ID } from '../config.js'
import { AssetEngineError } from './errors.js'

/** ERC-20 and BEP-20 name the same function selectors. They do not name the same asset. */
export type InterfaceConvention = 'erc-20' | 'bep-20'

export type DeploymentPolicy = 'local' | 'testnet' | 'mainnet-disabled'

export type FeeMarket = 'eip-1559-only' | 'follow-block'

export type NativeGas = {
  /** Symbol charged for gas on this network. It is not reused for another network. */
  symbol: string
  name: string
  decimals: 18
}

export type ExplorerLinks = {
  origin: string
  transactionUrl: (hash: string) => string
  addressUrl: (address: string) => string
  /** Verification is described, not performed, unless a later call has an API response. */
  verification: 'api-key-required'
  apiHost: string
}

export type NetworkProfile = {
  id: string
  name: string
  chainId: number
  kind: 'btcs-l2-local' | 'ethereum' | 'bnb-smart-chain'
  nativeGas: NativeGas
  interfaceConvention: InterfaceConvention
  feeMarket: FeeMarket
  /**
   * Tip used only when this profile follows the connected block and the RPC
   * does not implement `eth_maxPriorityFeePerGas`. BTCS local gas does not use it.
   */
  fallbackPriorityFee: bigint | null
  deploymentPolicy: DeploymentPolicy
  explorer: ExplorerLinks | null
  /** Environment variable a caller may set. The profile stores the name, never a URL. */
  rpcUrlEnv: string
}

export type WalletRpcRequest = {
  method: 'wallet_switchEthereumChain' | 'wallet_addEthereumChain'
  params: readonly [Record<string, unknown>]
}

const BTCS_CHAIN_ID = Number(EVM_CHAIN_ID)
const BNB_TESTNET_CHAIN_ID = 97
const BNB_MAINNET_CHAIN_ID = 56
const ETHEREUM_MAINNET_CHAIN_ID = 1
const ETHEREUM_SEPOLIA_CHAIN_ID = 11_155_111

function explorer(origin: string, apiHost: string): ExplorerLinks {
  const base = origin.replace(/\/$/, '')
  return {
    origin: base,
    transactionUrl: (hash) => `${base}/tx/${hash}`,
    addressUrl: (address) => `${base}/address/${address}`,
    verification: 'api-key-required',
    apiHost,
  }
}

export const NETWORKS = {
  btcsL2Local: {
    id: 'btcs-l2-local',
    name: 'BTCS L2 local development',
    chainId: BTCS_CHAIN_ID,
    kind: 'btcs-l2-local',
    nativeGas: {
      symbol: 'BTCS',
      name: 'BTCS L2 native balance',
      decimals: 18,
    },
    interfaceConvention: 'erc-20',
    feeMarket: 'eip-1559-only',
    fallbackPriorityFee: null,
    deploymentPolicy: 'local',
    explorer: null,
    rpcUrlEnv: 'BTCS_L2_RPC_URL',
  },
  ethereumMainnet: {
    id: 'ethereum-mainnet',
    name: 'Ethereum mainnet',
    chainId: ETHEREUM_MAINNET_CHAIN_ID,
    kind: 'ethereum',
    nativeGas: { symbol: 'ETH', name: 'Ether', decimals: 18 },
    interfaceConvention: 'erc-20',
    feeMarket: 'follow-block',
    fallbackPriorityFee: 1_500_000_000n,
    deploymentPolicy: 'mainnet-disabled',
    explorer: explorer('https://etherscan.io', 'https://api.etherscan.io'),
    rpcUrlEnv: 'ETH_MAINNET_RPC_URL',
  },
  ethereumSepolia: {
    id: 'ethereum-sepolia',
    name: 'Ethereum Sepolia',
    chainId: ETHEREUM_SEPOLIA_CHAIN_ID,
    kind: 'ethereum',
    nativeGas: { symbol: 'ETH', name: 'Sepolia Ether', decimals: 18 },
    interfaceConvention: 'erc-20',
    feeMarket: 'follow-block',
    fallbackPriorityFee: 1_500_000_000n,
    deploymentPolicy: 'testnet',
    explorer: explorer('https://sepolia.etherscan.io', 'https://api-sepolia.etherscan.io'),
    rpcUrlEnv: 'ETH_SEPOLIA_RPC_URL',
  },
  bnbTestnet: {
    id: 'bnb-smart-chain-testnet',
    name: 'BNB Smart Chain testnet',
    chainId: BNB_TESTNET_CHAIN_ID,
    kind: 'bnb-smart-chain',
    nativeGas: { symbol: 'tBNB', name: 'BNB Smart Chain testnet gas', decimals: 18 },
    interfaceConvention: 'bep-20',
    feeMarket: 'follow-block',
    fallbackPriorityFee: 100_000_000n,
    deploymentPolicy: 'testnet',
    explorer: explorer('https://testnet.bscscan.com', 'https://api-testnet.bscscan.com'),
    rpcUrlEnv: 'BNB_TESTNET_RPC_URL',
  },
  bnbMainnet: {
    id: 'bnb-smart-chain-mainnet',
    name: 'BNB Smart Chain',
    chainId: BNB_MAINNET_CHAIN_ID,
    kind: 'bnb-smart-chain',
    nativeGas: { symbol: 'BNB', name: 'BNB', decimals: 18 },
    interfaceConvention: 'bep-20',
    feeMarket: 'follow-block',
    fallbackPriorityFee: 100_000_000n,
    deploymentPolicy: 'mainnet-disabled',
    explorer: explorer('https://bscscan.com', 'https://api.bscscan.com'),
    rpcUrlEnv: 'BNB_MAINNET_RPC_URL',
  },
} as const satisfies Record<string, NetworkProfile>

const RESERVED_CHAIN_IDS = new Map<number, string>([
  [NETWORKS.btcsL2Local.chainId, NETWORKS.btcsL2Local.id],
  [NETWORKS.ethereumMainnet.chainId, NETWORKS.ethereumMainnet.id],
  [NETWORKS.ethereumSepolia.chainId, NETWORKS.ethereumSepolia.id],
  [NETWORKS.bnbTestnet.chainId, NETWORKS.bnbTestnet.id],
  [NETWORKS.bnbMainnet.chainId, NETWORKS.bnbMainnet.id],
])

/**
 * An additional Ethereum-compatible network whose gas token is ETH.
 * BNB Smart Chain and BTCS L2 keep their own profiles and gas symbols.
 */
export function defineEthereumCompatibleNetwork(options: {
  id: string
  name: string
  chainId: number
  deploymentPolicy: 'testnet' | 'mainnet-disabled'
  explorerOrigin?: string
  explorerApiHost?: string
  rpcUrlEnv: string
}): NetworkProfile {
  if (!Number.isInteger(options.chainId) || options.chainId <= 0) {
    throw new AssetEngineError('chain id must be a positive integer')
  }
  const reserved = RESERVED_CHAIN_IDS.get(options.chainId)
  if (reserved !== undefined) {
    throw new AssetEngineError(`chain id ${options.chainId} belongs to ${reserved} and keeps that network's gas token`)
  }
  if (!/^[A-Z0-9_]+$/.test(options.rpcUrlEnv)) {
    throw new AssetEngineError('rpcUrlEnv must name an environment variable')
  }
  const links = options.explorerOrigin === undefined
    ? null
    : explorer(options.explorerOrigin, options.explorerApiHost ?? options.explorerOrigin)
  return {
    id: options.id,
    name: options.name,
    chainId: options.chainId,
    kind: 'ethereum',
    nativeGas: { symbol: 'ETH', name: 'Ether', decimals: 18 },
    interfaceConvention: 'erc-20',
    feeMarket: 'follow-block',
    fallbackPriorityFee: 1_500_000_000n,
    deploymentPolicy: options.deploymentPolicy,
    explorer: links,
    rpcUrlEnv: options.rpcUrlEnv,
  }
}

export function resolveRpcUrl(profile: NetworkProfile, explicit?: string): string {
  const raw = explicit ?? process.env[profile.rpcUrlEnv]
  if (raw === undefined || raw.trim() === '') {
    throw new AssetEngineError(
      `${profile.id} requires an RPC URL argument or ${profile.rpcUrlEnv}. No RPC endpoint is built in.`,
    )
  }
  const value = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new AssetEngineError(`${profile.id} RPC URL is not a valid URL`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AssetEngineError(`${profile.id} RPC URL must use http or https`)
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw new AssetEngineError(`${profile.id} RPC URL must not carry userinfo`)
  }
  return value
}

export function walletSwitchParams(profile: NetworkProfile): WalletRpcRequest {
  return {
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: quantity(BigInt(profile.chainId)) }],
  }
}

/** Wallet add-chain parameters. The RPC URL is the one the caller already resolved. */
export function walletAddParams(profile: NetworkProfile, rpcUrl: string): WalletRpcRequest {
  const resolved = resolveRpcUrl(profile, rpcUrl)
  return {
    method: 'wallet_addEthereumChain',
    params: [{
      chainId: quantity(BigInt(profile.chainId)),
      chainName: profile.name,
      nativeCurrency: {
        name: profile.nativeGas.name,
        symbol: profile.nativeGas.symbol,
        decimals: profile.nativeGas.decimals,
      },
      rpcUrls: [resolved],
      blockExplorerUrls: profile.explorer === null ? [] : [profile.explorer.origin],
    }],
  }
}

export function quantity(value: bigint): string {
  if (value < 0n) throw new AssetEngineError('quantity is negative')
  return value === 0n ? '0x0' : `0x${value.toString(16)}`
}

export function parseQuantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new AssetEngineError(`${label} is not a hex quantity`)
  }
  return BigInt(value)
}

export function normalizeAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new AssetEngineError('address must be 20 bytes of hex')
  }
  return value.toLowerCase()
}

export function assetIdFor(networkId: string, contractAddress: string): string {
  return `${networkId}:${normalizeAddress(contractAddress)}`
}
