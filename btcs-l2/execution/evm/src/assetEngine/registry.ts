import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AssetEngineError, refuseCrossChainLink } from './errors.js'
import { assetIdFor, type InterfaceConvention, normalizeAddress } from './networks.js'

export type LogoMediaType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/** The token standard whose rules the deployed contract was checked against. */
export type AssetStandard = 'ERC-20' | 'BSNA-FTS1'

export type StoredLogo = {
  sha256: string
  mediaType: LogoMediaType
  uri: string
  byteLength: number
}

export type DeploymentRecord = {
  version: 1
  assetId: string
  networkId: string
  networkName: string
  chainId: number
  interfaceConvention: InterfaceConvention
  /** Absent on records written before BSNA-FTS1 support existed. Treat those as ERC-20. */
  standard?: AssetStandard
  contractAddress: string
  deployer: string
  creationTransactionHash: string
  creationBytecodeSha256: string
  compilerEvmVersion: 'london'
  name: string
  symbol: string
  decimals: number
  supplyAtomic: string
  supplyUnit: 'atomic'
  permissions: {
    owner: string
    supplyPolicy: 'fixed' | 'authorized-mint'
    mint: 'none' | 'minter'
    burn: 'none' | 'holder'
    transfer: 'holder'
    /** BSNA-FTS1 only. Absent on ERC-20 records. */
    pause?: 'none' | 'admin'
    /** BSNA-FTS1 only. */
    metadataMutable?: boolean
  }
  metadata: {
    description: string
    externalUrl: string | null
    logo: StoredLogo | null
    /** BSNA-FTS1 only. The contract stores the URI and sha256 hash. */
    uri?: string
    hash?: string
  }
  nativeGas: { symbol: string; name: string; decimals: 18 }
  explorerTransactionUrl: string | null
  verification: 'not-submitted' | 'unsupported'
  /** Always empty. A non-empty list would claim a cross-chain identity this engine does not create. */
  sameAssetOnOtherNetworks: []
}

type RegistryFile = {
  version: 1
  deployments: DeploymentRecord[]
}

export class DeploymentRegistry {
  constructor(private readonly directory: string) {}

  async list(networkId?: string): Promise<DeploymentRecord[]> {
    const file = await this.load()
    return networkId === undefined
      ? file.deployments
      : file.deployments.filter((record) => record.networkId === networkId)
  }

  async get(networkId: string, contractAddress: string): Promise<DeploymentRecord | undefined> {
    const assetId = assetIdFor(networkId, contractAddress)
    const file = await this.load()
    return file.deployments.find((record) => record.assetId === assetId)
  }

  async put(record: DeploymentRecord): Promise<void> {
    assertUnlinked(record)
    if (record.assetId !== assetIdFor(record.networkId, record.contractAddress)) {
      throw new AssetEngineError('asset id does not match its network and contract address')
    }
    const file = await this.load()
    if (file.deployments.some((existing) => existing.assetId === record.assetId)) {
      throw new AssetEngineError(`deployment ${record.assetId} is already recorded`)
    }
    file.deployments.push(record)
    await this.store(file)
  }

  async replace(record: DeploymentRecord): Promise<void> {
    assertUnlinked(record)
    const file = await this.load()
    const index = file.deployments.findIndex((existing) => existing.assetId === record.assetId)
    if (index < 0) throw new AssetEngineError(`deployment ${record.assetId} is not recorded`)
    const current = file.deployments[index]
    if (current === undefined || current.networkId !== record.networkId || current.chainId !== record.chainId) {
      refuseCrossChainLink()
    }
    file.deployments[index] = record
    await this.store(file)
  }

  async storeLogo(bytes: Uint8Array): Promise<StoredLogo> {
    const mediaType = detectImage(bytes)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const directory = join(this.directory, 'logos')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, sha256), bytes)
    return {
      sha256,
      mediaType,
      uri: `registry-local:${sha256}`,
      byteLength: bytes.length,
    }
  }

  /** Read a stored logo by its sha256 digest. The digest is not a path. */
  async readLogo(sha256: string): Promise<{ data: Uint8Array; mediaType: LogoMediaType }> {
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new AssetEngineError('logo digest must be 64 lowercase hex characters')
    }
    try {
      const data = new Uint8Array(await readFile(join(this.directory, 'logos', sha256)))
      return { data, mediaType: detectImage(data) }
    } catch (error) {
      if (error instanceof AssetEngineError) throw error
      throw new AssetEngineError(`logo ${sha256} is not stored`)
    }
  }

  private async load(): Promise<RegistryFile> {
    await mkdir(this.directory, { recursive: true })
    try {
      const parsed = JSON.parse(await readFile(join(this.directory, 'deployments.json'), 'utf8')) as RegistryFile
      if (parsed.version !== 1 || !Array.isArray(parsed.deployments)) {
        throw new AssetEngineError('deployment registry is not version 1')
      }
      return parsed
    } catch (error) {
      if (error instanceof AssetEngineError) throw error
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined
      if (code === 'ENOENT') return { version: 1, deployments: [] }
      throw error
    }
  }

  private async store(file: RegistryFile): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    const target = join(this.directory, 'deployments.json')
    const temporary = `${target}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`)
    await rename(temporary, target)
  }
}

export function requireSameNetwork(sessionNetworkId: string, record: DeploymentRecord): void {
  if (record.networkId !== sessionNetworkId) {
    throw new AssetEngineError(
      `${record.assetId} is recorded on ${record.networkId}. The connected network is ${sessionNetworkId}. This engine will not send that asset's call on a different network.`,
    )
  }
}

function assertUnlinked(record: DeploymentRecord): void {
  const links: readonly unknown[] = record.sameAssetOnOtherNetworks
  if (links.length !== 0) refuseCrossChainLink()
}

function detectImage(bytes: Uint8Array): LogoMediaType {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  throw new AssetEngineError('logo must be a png, jpeg, gif, or webp image')
}
