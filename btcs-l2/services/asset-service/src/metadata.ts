/**
 * BSNA metadata generation.
 *
 * The generated document uses exactly the field set declared by the BSNA
 * standard proposal (`docs/BSNA-STANDARD-PROPOSAL.md`, section 6):
 * `name`, `description`, `image`, `external_url`, `attributes`. No other
 * top-level field is emitted.
 *
 * Note on ERC-20: ERC-20 itself defines no metadata and no logo field. A
 * BSNA-20 logo is carried by the BSNA metadata document that the contract
 * exposes through `bsnaMetadata()`; it is not an ERC-20 concept.
 */

import {
  assetTypeForAssetKind,
  bsnaProfileForAssetKind,
  defaultNameForAssetKind,
  type AssetImageKind,
  type BsnaMetadata,
  type BsnaProfile,
  type MetadataAttribute,
  type MetadataTarget,
} from './types.js'

export type { MetadataTarget }

export type MetadataBuildInput = {
  assetKind: AssetImageKind
  bsnaVersion: string
  name?: string | undefined
  description?: string | undefined
  externalUrl?: string | undefined
  /** URI of the uploaded image, stored in the `image` field. */
  imageUri: string
  /** Caller supplied attributes, emitted first. */
  attributes?: readonly MetadataAttribute[] | undefined
  chainId?: number | undefined
  contractAddress?: string | undefined
  tokenId?: string | undefined
  /** `sha256:<hex>` digest of the uploaded image bytes. */
  contentHash: string
  mimeType: string
  width: number
  height: number
}

/** The metadata target implied by an asset kind. */
export function metadataTargetForAssetKind(kind: AssetImageKind): MetadataTarget {
  switch (kind) {
    case 'bsna20-logo':
      return 'bsna20-metadata-uri'
    case 'bsna721-collection-image':
      return 'bsna721-collection-metadata-uri'
    case 'bsna721-token-image':
      return 'bsna721-token-uri'
  }
}

/**
 * Build the BSNA metadata document for an uploaded image.
 */
export function buildBsnaMetadata(input: MetadataBuildInput): BsnaMetadata {
  const bsnaProfile: BsnaProfile = bsnaProfileForAssetKind(input.assetKind)
  const assetType = assetTypeForAssetKind(input.assetKind)
  const name = (input.name ?? defaultNameForAssetKind(input.assetKind)).trim()

  const attributes: MetadataAttribute[] = []
  for (const attribute of input.attributes ?? []) {
    attributes.push({ trait_type: attribute.trait_type, value: attribute.value })
  }
  attributes.push({ trait_type: 'BSNA Profile', value: bsnaProfile })
  attributes.push({ trait_type: 'BSNA Version', value: input.bsnaVersion })
  attributes.push({ trait_type: 'Asset Type', value: assetType })
  if (input.chainId !== undefined) {
    attributes.push({ trait_type: 'Chain ID', value: String(input.chainId) })
  }
  if (input.contractAddress !== undefined) {
    attributes.push({ trait_type: 'Contract Address', value: input.contractAddress })
  }
  if (input.tokenId !== undefined) {
    attributes.push({ trait_type: 'Token ID', value: input.tokenId })
  }
  attributes.push({ trait_type: 'Image Content Hash', value: input.contentHash })
  attributes.push({ trait_type: 'Image Media Type', value: input.mimeType })
  attributes.push({ trait_type: 'Image Dimensions', value: `${input.width}x${input.height}` })

  return {
    name,
    description: input.description ?? '',
    image: input.imageUri,
    external_url: input.externalUrl ?? '',
    attributes,
  }
}

/**
 * Serialize a metadata document to canonical JSON.
 *
 * Object keys are sorted and the output is compact, so the same document always
 * produces the same bytes and therefore the same content hash. Array order is
 * preserved because attribute order is part of the document.
 */
export function serializeMetadata(metadata: BsnaMetadata): string {
  return JSON.stringify(stableJsonValue(metadata))
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue)
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, stableJsonValue(record[key])]),
    )
  }
  return value
}
