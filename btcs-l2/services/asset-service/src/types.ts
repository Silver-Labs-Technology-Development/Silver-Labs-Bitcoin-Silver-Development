/**
 * Public type contract for the BTCS asset upload service.
 *
 * These types are the source of truth for the HTTP API described in
 * `docs/BSNA-ASSET-UPLOAD-API.md`. The Studio (React) consumes the JSON shape
 * produced by {@link AssetUploadSuccess}; the metadata document produced by
 * {@link BsnaMetadata} follows the field set declared by
 * `docs/BSNA-STANDARD-PROPOSAL.md` (name, description, image, external_url,
 * attributes) and nothing else.
 */

/** BSNA asset profiles recognised by the service. */
export type BsnaProfile = 'BSNA-20' | 'BSNA-721'

/**
 * The role an uploaded image plays.
 *
 * - `bsna20-logo` — the logo of a BSNA-20 fungible asset.
 * - `bsna721-collection-image` — the imagery of a BSNA-721 collection.
 * - `bsna721-token-image` — the image of one individual BSNA-721 token.
 */
export type AssetImageKind = 'bsna20-logo' | 'bsna721-collection-image' | 'bsna721-token-image'

/** Image formats the service accepts. Determined from file bytes, never from the request. */
export type SupportedImageFormat = 'png' | 'jpeg' | 'gif' | 'webp'

/** How durable a stored URI is. `local-only` objects are not portable off the host. */
export type StorageDurability = 'local-only' | 'durable'

/** A single ERC-721 / BSNA metadata attribute entry. */
export type MetadataAttribute = {
  trait_type: string
  value: string
}

/**
 * Where the generated metadata document is meant to be referenced.
 *
 * - `bsna20-metadata-uri` — pass to the `BSNA20` constructor, read back via `bsnaMetadata()`.
 * - `bsna721-collection-metadata-uri` — pass to the `BSNA721` constructor, read back via `bsnaMetadata()`.
 * - `bsna721-token-uri` — pass to `BSNA721.safeMint`, read back via `tokenURI(tokenId)`.
 */
export type MetadataTarget =
  | 'bsna20-metadata-uri'
  | 'bsna721-collection-metadata-uri'
  | 'bsna721-token-uri'

/**
 * BSNA metadata document.
 *
 * The top-level field set is exactly the set declared by the BSNA standard
 * proposal: `name`, `description`, `image`, `external_url`, `attributes`.
 * No additional top-level fields are emitted.
 */
export type BsnaMetadata = {
  name: string
  description: string
  image: string
  external_url: string
  attributes: MetadataAttribute[]
}

/** Asset/profile context supplied alongside the image bytes. */
export type AssetImageContext = {
  /** Required. Determines the BSNA profile and which metadata document is produced. */
  assetKind: AssetImageKind
  /**
   * Optional. When present it must agree with the profile implied by
   * `assetKind`; a contradiction is rejected instead of silently corrected.
   */
  bsnaProfile?: BsnaProfile
  /** BSNA version string recorded in the metadata attributes. Defaults to `1.0`. */
  bsnaVersion?: string
  /** Human readable asset name. Defaults to a kind-specific fallback. */
  name?: string
  /** Human readable asset description. Defaults to an empty string. */
  description?: string
  /** Optional `external_url` for the metadata document. */
  externalUrl?: string
  /** Optional EVM chain id the asset is deployed on. */
  chainId?: number
  /** Optional contract address the asset is deployed at. */
  contractAddress?: string
  /** Optional token id for `bsna721-token-image` uploads. */
  tokenId?: string
  /** Optional caller supplied metadata attributes, emitted before the BSNA attributes. */
  attributes?: readonly MetadataAttribute[]
}

/** The raw image part of an upload, before any validation. */
export type ImageUploadPart = {
  /** Raw file bytes exactly as received. */
  data: Uint8Array
  /** MIME type declared by the client. Never trusted for format detection. */
  declaredMimeType?: string | undefined
  /** File name declared by the client. Never trusted for format detection. */
  filename?: string | undefined
}

/** A validated upload request handed to the service layer. */
export type ImageUploadRequest = {
  image: ImageUploadPart
  context: AssetImageContext
}

/** Result of persisting one object in a storage provider. */
export type StoredObject = {
  /** URI of the stored object. */
  uri: string
  /** Identifier of the storage provider that produced the URI. */
  provider: string
  /** Durability class of the URI. */
  durability: StorageDurability
  /**
   * True only when the URI is expected to resolve from any host. Local
   * development storage always reports `false`.
   */
  portable: boolean
  /** True only when the provider positively verified the stored bytes. */
  verified: boolean
}

/** Description of a stored image. */
export type UploadedImage = {
  /** URI of the stored image. For local storage this is a local-only URI. */
  imageUri: string
  /** `sha256:<hex>` digest of the exact image bytes. */
  contentHash: string
  /** MIME type detected from the image bytes. */
  mimeType: string
  /** Size of the image bytes in bytes. */
  sizeBytes: number
  /** Identifier of the storage provider that stored the image. */
  storageProvider: string
  /** Durability class of {@link imageUri}. */
  durability: StorageDurability
  /** False when the URI only resolves on the machine that produced it. */
  portable: boolean
  /** Image width in pixels. */
  width: number
  /** Image height in pixels. */
  height: number
  /** Detected image format. */
  format: SupportedImageFormat
}

/** Successful upload result. */
export type AssetUploadSuccess = UploadedImage & {
  /** URI of the stored BSNA metadata document. */
  metadataUri: string
  /** `sha256:<hex>` digest of the stored metadata document bytes. */
  metadataContentHash: string
  /** Storage provider that stored the metadata document. */
  metadataStorageProvider: string
  /** Durability class of {@link metadataUri}. */
  metadataDurability: StorageDurability
  /** False when the metadata URI only resolves on the machine that produced it. */
  metadataPortable: boolean
  /** The BSNA metadata document itself. */
  metadata: BsnaMetadata
  /** BSNA profile implied by the uploaded asset kind. */
  bsnaProfile: BsnaProfile
  /** Asset type value matching the `assetType()` return value of the BSNA contracts. */
  assetType: 'fungible' | 'nonfungible'
  /** Where the metadata URI is meant to be referenced. */
  metadataTarget: MetadataTarget
  /** Non-fatal notices, e.g. that the URI is local-only. */
  warnings: readonly string[]
}

/** Structured error returned to the client. */
export type AssetUploadFailure = {
  ok: false
  error: {
    code: string
    message: string
    details: Record<string, unknown>
  }
}

/** Successful upload response body. */
export type AssetUploadSuccessBody = {
  ok: true
} & AssetUploadSuccess

/** Full response body: either a success or a structured failure. */
export type AssetUploadResponse = AssetUploadSuccessBody | AssetUploadFailure

/** Image formats the service accepts, exposed so clients can pre-validate. */
export const SUPPORTED_IMAGE_FORMATS: readonly SupportedImageFormat[] = ['png', 'jpeg', 'gif', 'webp']

/** Asset kinds the service accepts, exposed so clients can pre-validate. */
export const SUPPORTED_ASSET_IMAGE_KINDS: readonly AssetImageKind[] = [
  'bsna20-logo',
  'bsna721-collection-image',
  'bsna721-token-image',
]

/** BSNA profile implied by an asset kind. */
export function bsnaProfileForAssetKind(kind: AssetImageKind): BsnaProfile {
  return kind === 'bsna20-logo' ? 'BSNA-20' : 'BSNA-721'
}

/** Asset type implied by an asset kind. Matches `assetType()` on the BSNA contracts. */
export function assetTypeForAssetKind(kind: AssetImageKind): 'fungible' | 'nonfungible' {
  return kind === 'bsna20-logo' ? 'fungible' : 'nonfungible'
}

/** Default metadata name used when the caller does not supply one. */
export function defaultNameForAssetKind(kind: AssetImageKind): string {
  switch (kind) {
    case 'bsna20-logo':
      return 'BSNA-20 token logo'
    case 'bsna721-collection-image':
      return 'BSNA-721 collection image'
    case 'bsna721-token-image':
      return 'BSNA-721 token image'
  }
}
