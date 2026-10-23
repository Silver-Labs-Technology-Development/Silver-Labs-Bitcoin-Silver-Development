/**
 * Asset Engine Service wrapper.
 *
 * This module bridges the asset service HTTP API with the BTCS L2 asset engine
 * (`execution/evm/src/assetEngine/`). It handles network profiles, deployment,
 * fee estimation, and registry persistence.
 */

import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AssetDevelopmentSession,
  DeploymentRegistry,
  PrivateKeySigner,
  type ConnectionReport,
  type FeeQuote,
  type DeploymentRecord,
  type FungibleSpec,
  NETWORKS,
  resolveRpcUrl,
  liveBnbTestnetConfigured,
  parsePrivateKeyHex,
} from 'btcs-l2-v010-evm-harness/assetEngine/index.js'
import { compileFungibleAsset, creationCalldata } from 'btcs-l2-v010-evm-harness/assetEngine/fungible.js'
import { compileBsnaFts1, fts1CreationCalldata, type Fts1Spec } from 'btcs-l2-v010-evm-harness/assetEngine/fts1.js'
import { type NetworkProfile, type ExplorerLinks } from 'btcs-l2-v010-evm-harness/assetEngine/networks.js'
import { AssetServiceError } from './errors.js'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const DEFAULT_REGISTRY_DIR = resolve(PACKAGE_ROOT, '.asset-engine-registry')
const DEV_PRIVATE_KEY = '0x' + '11'.repeat(32)

export type AssetEngineConfig = {
  /** Base directory for the deployment registry. */
  registryDirectory: string
  /** Default network profile ID. */
  defaultNetwork: string
  /** Whether to enable the development sequencer for local deployments. */
  devSequencer: boolean
}

export type NetworkInfo = {
  id: string
  name: string
  chainId: number
  kind: 'btcs-l2-local' | 'ethereum' | 'bnb-smart-chain'
  nativeGas: { symbol: string; name: string; decimals: 18 }
  interfaceConvention: 'erc-20' | 'bep-20'
  deploymentPolicy: 'local' | 'testnet' | 'mainnet-disabled'
  explorer: ExplorerLinks | null
  configured: boolean
  requiresExplicitRpc: boolean
}

export type DeployRequest = {
  networkId: string
  /** Token rules to deploy. ERC-20 is the existing path; BSNA-FTS1 is additive. */
  standard?: 'ERC-20' | 'BSNA-FTS1'
  name: string
  symbol: string
  decimals: number
  initialSupply: string // atomic units as decimal string
  /** BSNA-FTS1 only. Atomic units. 0 means uncapped for authorized-mint. */
  maxSupply?: string
  supplyPolicy?: 'fixed' | 'authorized-mint'
  burnPolicy?: 'disabled' | 'holder-burn'
  pausePolicy?: 'disabled' | 'admin-pause'
  metadataMutable?: boolean
  metadataUri?: string
  metadataHash?: string
  description?: string
  externalUrl?: string
  logoBytes?: Uint8Array
  allowMainnet?: boolean
}

export type DeployResult = {
  deployment: DeploymentRecord
  connection: ConnectionReport
  feeQuote: FeeQuote
}

export type FeeEstimateRequest = {
  networkId: string
  standard?: 'ERC-20' | 'BSNA-FTS1'
  name: string
  symbol: string
  decimals: number
  initialSupply: string
  maxSupply?: string
  supplyPolicy?: 'fixed' | 'authorized-mint'
  burnPolicy?: 'disabled' | 'holder-burn'
  pausePolicy?: 'disabled' | 'admin-pause'
  metadataMutable?: boolean
  metadataUri?: string
  metadataHash?: string
}

export type FeeEstimateResult = {
  networkId: string
  chainId: number
  nativeSymbol: string
  nativeDecimals: 18
  gasLimit: bigint
  estimatedNativeFee: bigint
  maxFeePerGas?: bigint
  maxPriorityFeePerGas?: bigint
  gasPrice?: bigint
  model: 'eip-1559' | 'legacy'
}

export class AssetEngineService {
  private registry: DeploymentRegistry
  private config: AssetEngineConfig
  private session: AssetDevelopmentSession | null = null
  private currentNetworkId: string

  constructor(config: Partial<AssetEngineConfig> = {}) {
    this.config = {
      registryDirectory: config.registryDirectory ?? DEFAULT_REGISTRY_DIR,
      defaultNetwork: config.defaultNetwork ?? 'btcs-l2-local',
      devSequencer: config.devSequencer ?? true,
    }
    this.currentNetworkId = this.config.defaultNetwork
    this.registry = new DeploymentRegistry(this.config.registryDirectory)
  }

  /** Get the list of supported network profiles with their configuration status. */
  async getNetworks(): Promise<NetworkInfo[]> {
    const results: NetworkInfo[] = []
    for (const [key, profile] of Object.entries(NETWORKS)) {
      let configured = false
      let requiresExplicitRpc = false
      try {
        if (profile.kind === 'btcs-l2-local') {
          configured = true // Local always has a default
        } else if (profile.kind === 'bnb-smart-chain') {
          configured = liveBnbTestnetConfigured()
          requiresExplicitRpc = !configured
        } else {
          // Ethereum networks - check if RPC URL env var is set
          configured = !!process.env[profile.rpcUrlEnv]
          requiresExplicitRpc = !configured
        }
      } catch {
        configured = false
        requiresExplicitRpc = true
      }
      results.push({
        id: profile.id,
        name: profile.name,
        chainId: profile.chainId,
        kind: profile.kind,
        nativeGas: profile.nativeGas,
        interfaceConvention: profile.interfaceConvention,
        deploymentPolicy: profile.deploymentPolicy,
        explorer: profile.explorer,
        configured,
        requiresExplicitRpc,
      })
    }
    return results
  }

  /** Connect to a network profile. */
  async connect(networkId: string, rpcUrl?: string): Promise<ConnectionReport> {
    const profile = findProfile(networkId)
    if (!profile) {
      throw AssetServiceError.invalidRequest(`Unknown network: ${networkId}`, { networkId })
    }

    const resolvedRpcUrl = resolveRpcUrl(profile, rpcUrl)
    const signer = new PrivateKeySigner(parsePrivateKeyHex(DEV_PRIVATE_KEY))

    this.session = await AssetDevelopmentSession.connect({
      profile,
      rpcUrl: resolvedRpcUrl,
      signer,
      registry: this.registry,
      devSequencer: profile.kind === 'btcs-l2-local' ? this.config.devSequencer : false,
    })
    this.currentNetworkId = networkId
    return this.session.connection()
  }

  /** Get the current connection report. */
  getConnection(): ConnectionReport | null {
    return this.session?.connection() ?? null
  }

  /** Get the current network ID. */
  getCurrentNetworkId(): string {
    return this.currentNetworkId
  }

  /** Estimate deployment fees for a fungible token. */
  async estimateDeploymentFees(request: FeeEstimateRequest): Promise<FeeEstimateResult> {
    if (!this.session) {
      throw AssetServiceError.internal('Not connected to a network. Call connect() first.')
    }

    const profile = findProfile(request.networkId)
    if (!profile) {
      throw AssetServiceError.invalidRequest(`Unknown network: ${request.networkId}`, { networkId: request.networkId })
    }

    // Switch network if needed
    if (request.networkId !== this.currentNetworkId) {
      await this.connect(request.networkId)
    }

    const standard = request.standard ?? 'ERC-20'
    let data: Uint8Array
    if (standard === 'BSNA-FTS1') {
      const compiled = compileBsnaFts1()
      data = fts1CreationCalldata(compiled, this.fts1SpecFor(request, this.session.signerAddress))
    } else {
      const compiled = compileFungibleAsset()
      data = creationCalldata(compiled, {
        name: request.name,
        symbol: request.symbol,
        decimals: request.decimals,
        atomicSupply: parseAtomic(request.initialSupply, 'initialSupply'),
        owner: this.session.signerAddress,
      })
    }

    const quote = await this.session!.estimateFees({ data })

    return {
      networkId: request.networkId,
      chainId: profile.chainId,
      nativeSymbol: profile.nativeGas.symbol,
      nativeDecimals: 18,
      gasLimit: quote.gasLimit,
      estimatedNativeFee: quote.estimatedNativeFee,
      maxFeePerGas: quote.maxFeePerGas,
      maxPriorityFeePerGas: quote.maxPriorityFeePerGas,
      gasPrice: quote.gasPrice,
      model: quote.model,
    }
  }

  /** Deploy a fungible token. */
  async deployFungible(request: DeployRequest): Promise<DeployResult> {
    if (request.logoBytes === undefined || request.logoBytes.byteLength === 0) {
      throw AssetServiceError.invalidRequest(
        'logoBytes is required for token deployment',
      )
    }
    if (!this.session) {
      throw AssetServiceError.internal('Not connected to a network. Call connect() first.')
    }

    const profile = findProfile(request.networkId)
    if (!profile) {
      throw AssetServiceError.invalidRequest(`Unknown network: ${request.networkId}`, { networkId: request.networkId })
    }

    // Switch network if needed
    if (request.networkId !== this.currentNetworkId) {
      await this.connect(request.networkId)
    }

    const standard = request.standard ?? 'ERC-20'
    let deployment: DeploymentRecord
    if (standard === 'BSNA-FTS1') {
      deployment = await this.session!.deployFts1(
        this.fts1SpecFor(request, this.session!.signerAddress),
        { allowMainnet: request.allowMainnet ?? false },
      )
    } else {
      const spec: FungibleSpec = {
        name: request.name,
        symbol: request.symbol,
        decimals: request.decimals,
        atomicSupply: parseAtomic(request.initialSupply, 'initialSupply'),
        description: request.description,
        externalUrl: request.externalUrl,
        logoBytes: request.logoBytes,
      }
      deployment = await this.session!.deployFungible(spec, { allowMainnet: request.allowMainnet ?? false })
    }
    const connection = this.session!.connection()
    const feeQuote = await this.estimateDeploymentFees({
      networkId: request.networkId,
      standard,
      name: request.name,
      symbol: request.symbol,
      decimals: request.decimals,
      initialSupply: request.initialSupply,
      maxSupply: request.maxSupply,
      supplyPolicy: request.supplyPolicy,
      burnPolicy: request.burnPolicy,
      pausePolicy: request.pausePolicy,
      metadataMutable: request.metadataMutable,
      metadataUri: request.metadataUri,
      metadataHash: request.metadataHash,
    })

    return { deployment, connection, feeQuote }
  }

  /** List all deployments from the registry. */
  async listDeployments(networkId?: string): Promise<DeploymentRecord[]> {
    return this.registry.list(networkId)
  }

  /** Get a specific deployment by network and contract address. */
  async getDeployment(networkId: string, contractAddress: string): Promise<DeploymentRecord | undefined> {
    return this.registry.get(networkId, contractAddress)
  }

  /** Mint on an authorized-mint BSNA-FTS1 deployment through the asset engine. */
  async mintFts1(request: {
    networkId?: string
    assetId: string
    to: string
    atomicAmount: string
    allowMainnet?: boolean
  }): Promise<{ mined: { transactionHash: string; receipt: import('btcs-l2-v010-evm-harness/assetEngine/session.js').TransactionReceipt }; setupTransactionHash: string | null; onChain: import('btcs-l2-v010-evm-harness/assetEngine/session.js').OnChainFts1 }> {
    if (!this.session) {
      throw AssetServiceError.internal('Not connected to a network. Call connect() first.')
    }
    if (request.networkId !== undefined && request.networkId !== this.currentNetworkId) {
      await this.connect(request.networkId)
    }
    const amount = parseAtomic(request.atomicAmount, 'atomicAmount')
    const minted = await this.session.mintFts1(
      request.assetId,
      request.to,
      amount,
      { allowMainnet: request.allowMainnet ?? false },
    )
    const onChain = await this.session.readFts1(request.assetId)
    return { mined: minted.mined, setupTransactionHash: minted.setupTransactionHash, onChain }
  }

  /** Attach a logo to an existing deployment. */
  async attachLogo(assetId: string, logoBytes: Uint8Array): Promise<DeploymentRecord> {    if (!this.session) {
      throw AssetServiceError.internal('Not connected to a network. Call connect() first.')
    }
    return this.session!.attachLogo(assetId, logoBytes)
  }

  private fts1SpecFor(request: FeeEstimateRequest | DeployRequest, owner: string): Fts1Spec {
    const initial = parseAtomic(request.initialSupply, 'initialSupply')
    const supplyPolicy = request.supplyPolicy ?? 'fixed'
    const maxSupply = request.maxSupply === undefined || request.maxSupply === ''
      ? (supplyPolicy === 'fixed' ? initial : 0n)
      : parseAtomic(request.maxSupply, 'maxSupply')
    return {
      name: request.name,
      symbol: request.symbol,
      decimals: request.decimals,
      atomicSupply: initial,
      maxSupply,
      supplyPolicy,
      burnPolicy: request.burnPolicy ?? 'disabled',
      pausePolicy: request.pausePolicy ?? 'disabled',
      metadataMutable: request.metadataMutable ?? false,
      metadataUri: request.metadataUri ?? '',
      metadataHash: parseBytes32(request.metadataHash),
      admin: owner,
      ...('description' in request ? { description: request.description } : {}),
      ...('externalUrl' in request ? { externalUrl: request.externalUrl } : {}),
      ...('logoBytes' in request ? { logoBytes: request.logoBytes } : {}),
    }
  }

  /** Read a persisted deployment logo by its sha256 digest. */
  async readDeploymentLogo(sha256: string): Promise<{ data: Uint8Array; mediaType: string }> {
    return this.registry.readLogo(sha256)
  }

  /** Close the service and clean up. */
  async close(): Promise<void> {
    this.session = null
  }
}

function parseAtomic(value: string, field: string): bigint {
  if (!/^[0-9]+$/.test(value)) {
    throw AssetServiceError.invalidRequest(`${field} must be a non-negative decimal integer`, { field })
  }
  const parsed = BigInt(value)
  if (parsed >= 1n << 256n) {
    throw AssetServiceError.invalidRequest(`${field} must fit in uint256`, { field })
  }
  return parsed
}

function parseBytes32(value: string | undefined): bigint {
  if (value === undefined || value === '') return 0n
  const parsed = /^0x[0-9a-fA-F]{1,64}$/.test(value) ? BigInt(value) : (/^[0-9]+$/.test(value) ? BigInt(value) : undefined)
  if (parsed === undefined || parsed < 0n || parsed >= 1n << 256n) {
    throw AssetServiceError.invalidRequest('metadataHash must be a 32-byte hex value or a decimal uint256', { field: 'metadataHash' })
  }
  return parsed
}

function findProfile(networkId: string) {
  return Object.values(NETWORKS).find((profile) => profile.id === networkId)
}

/** Create an AssetEngineService from environment variables. */
export function createAssetEngineServiceFromEnv(env: NodeJS.ProcessEnv): AssetEngineService {
  const registryDirectory = resolve(env.ASSET_ENGINE_REGISTRY_DIR ?? DEFAULT_REGISTRY_DIR)
  const defaultNetwork = env.ASSET_ENGINE_DEFAULT_NETWORK ?? 'btcs-l2-local'
  const devSequencer = (env.ASSET_ENGINE_DEV_SEQUENCER ?? 'true').toLowerCase() !== 'false'

  return new AssetEngineService({
    registryDirectory,
    defaultNetwork,
    devSequencer,
  })
}