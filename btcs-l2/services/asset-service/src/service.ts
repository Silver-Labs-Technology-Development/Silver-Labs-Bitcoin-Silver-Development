/**
 * Asset service: validation, storage and BSNA metadata generation.
 *
 * The service is transport agnostic. The HTTP layer in `httpServer.ts` is a thin
 * adapter over this class, so the same rules apply to every caller.
 */

import { AssetServiceError } from './errors.js'
import { assertDeclaredMimeTypeMatches, inspectImage } from './imageInspection.js'
import { buildBsnaMetadata, metadataTargetForAssetKind, serializeMetadata } from './metadata.js'
import { sha256ContentHash } from './storage/localStore.js'
import type { StorageProvider } from './storage/provider.js'
import {
  SUPPORTED_ASSET_IMAGE_KINDS,
  assetTypeForAssetKind,
  bsnaProfileForAssetKind,
  type AssetImageContext,
  type AssetUploadSuccess,
  type BsnaProfile,
  type ImageUploadRequest,
  type MetadataAttribute,
} from './types.js'
import type { AssetServiceLimits } from './config.js'

export const DEFAULT_BSNA_VERSION = '1.0'
const MAX_NAME_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 2_000
const MAX_ATTRIBUTE_COUNT = 64
const MAX_ATTRIBUTE_TEXT_LENGTH = 500

export type AssetServiceOptions = {
  /** Storage provider. When absent every upload fails with `storage-not-configured`. */
  provider?: StorageProvider | undefined
  /** Upload limits. */
  limits: AssetServiceLimits
  /** Reason the service has no usable storage, when it has none. */
  storageError?: AssetServiceError | undefined
}

export class AssetService {
  readonly provider: StorageProvider | undefined
  readonly limits: AssetServiceLimits
  readonly storageError: AssetServiceError | undefined

  constructor(options: AssetServiceOptions) {
    this.provider = options.provider
    this.limits = options.limits
    this.storageError =
      options.storageError ??
      (options.provider === undefined
        ? AssetServiceError.storageNotConfigured('no storage provider is configured for this deployment')
        : undefined)
  }

  /**
   * Validate, store and describe an uploaded image.
   *
   * @throws {AssetServiceError} for every rejected upload.
   */
  async uploadImage(request: ImageUploadRequest): Promise<AssetUploadSuccess> {
    const provider = this.provider
    if (provider === undefined) {
      throw (
        this.storageError ??
        AssetServiceError.storageNotConfigured('no storage provider is configured for this deployment')
      )
    }

    const context = normalizeContext(request.context)
    const data = request.image.data

    if (data.byteLength === 0) {
      throw AssetServiceError.invalidImage('the uploaded image is empty')
    }
    if (data.byteLength > this.limits.maxFileBytes) {
      throw AssetServiceError.fileTooLarge(
        `the uploaded image is ${data.byteLength} bytes which exceeds the ${this.limits.maxFileBytes} byte limit`,
        { sizeBytes: data.byteLength, maxFileBytes: this.limits.maxFileBytes },
      )
    }

    const inspected = inspectImage(data)
    assertDeclaredMimeTypeMatches(inspected.mimeType, request.image.declaredMimeType)

    if (inspected.width > this.limits.maxImageWidth || inspected.height > this.limits.maxImageHeight) {
      throw AssetServiceError.dimensionsOutOfRange(
        `the image is ${inspected.width}x${inspected.height} which exceeds the ` +
          `${this.limits.maxImageWidth}x${this.limits.maxImageHeight} limit`,
        {
          width: inspected.width,
          height: inspected.height,
          maxImageWidth: this.limits.maxImageWidth,
          maxImageHeight: this.limits.maxImageHeight,
        },
      )
    }
    if (inspected.width * inspected.height > this.limits.maxImagePixels) {
      throw AssetServiceError.dimensionsOutOfRange(
        `the image has ${inspected.width * inspected.height} pixels which exceeds the ` +
          `${this.limits.maxImagePixels} pixel limit`,
        {
          width: inspected.width,
          height: inspected.height,
          maxImagePixels: this.limits.maxImagePixels,
        },
      )
    }

    const contentHash = sha256ContentHash(data)
    const extension = extensionForMimeType(inspected.mimeType)
    const storedImage = await provider.putObject({
      data,
      mimeType: inspected.mimeType,
      contentHash,
      extension,
      kind: 'image',
    })

    const metadata = buildBsnaMetadata({
      assetKind: context.assetKind,
      bsnaVersion: context.bsnaVersion ?? DEFAULT_BSNA_VERSION,
      name: context.name,
      description: context.description,
      externalUrl: context.externalUrl,
      imageUri: storedImage.uri,
      attributes: context.attributes,
      chainId: context.chainId,
      contractAddress: context.contractAddress,
      tokenId: context.tokenId,
      contentHash,
      mimeType: inspected.mimeType,
      width: inspected.width,
      height: inspected.height,
    })
    const metadataBytes = Buffer.from(serializeMetadata(metadata), 'utf8')
    const metadataContentHash = sha256ContentHash(new Uint8Array(metadataBytes))
    const storedMetadata = await provider.putObject({
      data: new Uint8Array(metadataBytes),
      mimeType: 'application/json',
      contentHash: metadataContentHash,
      extension: 'json',
      kind: 'metadata',
    })

    const warnings: string[] = []
    if (storedImage.durability === 'local-only') {
      warnings.push(
        'The image URI is local-only. It resolves on the machine that produced it, is not portable to ' +
          'other machines, and is lost when the local object store is deleted.',
      )
    }
    if (storedMetadata.durability === 'local-only') {
      warnings.push(
        'The metadata URI is local-only. It resolves on the machine that produced it, is not portable to ' +
          'other machines, and is lost when the local object store is deleted.',
      )
    }

    const bsnaProfile: BsnaProfile = bsnaProfileForAssetKind(context.assetKind)
    return {
      imageUri: storedImage.uri,
      contentHash,
      mimeType: inspected.mimeType,
      sizeBytes: inspected.sizeBytes,
      storageProvider: storedImage.provider,
      durability: storedImage.durability,
      portable: storedImage.portable,
      width: inspected.width,
      height: inspected.height,
      format: inspected.format,
      metadataUri: storedMetadata.uri,
      metadataContentHash,
      metadataStorageProvider: storedMetadata.provider,
      metadataDurability: storedMetadata.durability,
      metadataPortable: storedMetadata.portable,
      metadata,
      bsnaProfile,
      assetType: assetTypeForAssetKind(context.assetKind),
      metadataTarget: metadataTargetForAssetKind(context.assetKind),
      warnings,
    }
  }
}

function extensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return 'png'
    case 'image/jpeg':
      return 'jpg'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}

/**
 * Validate and normalise the asset/profile context.
 *
 * @throws {AssetServiceError} with code `invalid-request`.
 */
export function normalizeContext(context: AssetImageContext): AssetImageContext {
  if (!SUPPORTED_ASSET_IMAGE_KINDS.includes(context.assetKind)) {
    throw AssetServiceError.invalidRequest(
      `assetKind must be one of ${SUPPORTED_ASSET_IMAGE_KINDS.join(', ')}`,
      { field: 'assetKind', value: context.assetKind },
    )
  }
  const expectedProfile = bsnaProfileForAssetKind(context.assetKind)
  if (context.bsnaProfile !== undefined && context.bsnaProfile !== expectedProfile) {
    throw AssetServiceError.invalidRequest(
      `bsnaProfile "${context.bsnaProfile}" contradicts assetKind "${context.assetKind}" which implies ` +
        `"${expectedProfile}"`,
      { field: 'bsnaProfile', value: context.bsnaProfile, expected: expectedProfile },
    )
  }
  const bsnaVersion = context.bsnaVersion ?? DEFAULT_BSNA_VERSION
  if (!/^\d+\.\d+(\.\d+)?$/.test(bsnaVersion)) {
    throw AssetServiceError.invalidRequest('bsnaVersion must be a semantic version such as "1.0"', {
      field: 'bsnaVersion',
      value: bsnaVersion,
    })
  }
  if (context.name !== undefined) {
    const name = context.name.trim()
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      throw AssetServiceError.invalidRequest(
        `name must be between 1 and ${MAX_NAME_LENGTH} characters`,
        { field: 'name' },
      )
    }
  }
  if (context.description !== undefined && context.description.length > MAX_DESCRIPTION_LENGTH) {
    throw AssetServiceError.invalidRequest(
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      { field: 'description' },
    )
  }
  if (context.externalUrl !== undefined) {
    const externalUrl = context.externalUrl.trim()
    if (externalUrl.length === 0) {
      throw AssetServiceError.invalidRequest('externalUrl must not be empty', { field: 'externalUrl' })
    }
    let parsed: URL
    try {
      parsed = new URL(externalUrl)
    } catch {
      throw AssetServiceError.invalidRequest('externalUrl must be an absolute http(s) URL', {
        field: 'externalUrl',
        value: externalUrl,
      })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw AssetServiceError.invalidRequest('externalUrl must use the http or https scheme', {
        field: 'externalUrl',
        value: externalUrl,
      })
    }
  }
  if (context.chainId !== undefined && (!Number.isSafeInteger(context.chainId) || context.chainId < 0)) {
    throw AssetServiceError.invalidRequest('chainId must be a non-negative integer', {
      field: 'chainId',
      value: context.chainId,
    })
  }
  if (context.contractAddress !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(context.contractAddress)) {
    throw AssetServiceError.invalidRequest('contractAddress must be a 20 byte hex address', {
      field: 'contractAddress',
      value: context.contractAddress,
    })
  }
  if (context.tokenId !== undefined && !/^\d+$/.test(context.tokenId.trim())) {
    throw AssetServiceError.invalidRequest('tokenId must be a decimal integer', {
      field: 'tokenId',
      value: context.tokenId,
    })
  }
  const attributes = context.attributes === undefined ? undefined : normalizeAttributes(context.attributes)

  return {
    assetKind: context.assetKind,
    bsnaProfile: expectedProfile,
    bsnaVersion,
    name: context.name?.trim(),
    description: context.description,
    externalUrl: context.externalUrl?.trim(),
    chainId: context.chainId,
    contractAddress: context.contractAddress,
    tokenId: context.tokenId?.trim(),
    attributes,
  }
}

function normalizeAttributes(attributes: readonly MetadataAttribute[]): MetadataAttribute[] {
  if (attributes.length > MAX_ATTRIBUTE_COUNT) {
    throw AssetServiceError.invalidRequest(
      `at most ${MAX_ATTRIBUTE_COUNT} attributes are accepted`,
      { field: 'attributes' },
    )
  }
  return attributes.map((attribute, index) => {
    const traitType = String(attribute.trait_type ?? '').trim()
    const value = String(attribute.value ?? '').trim()
    if (traitType.length === 0 || traitType.length > MAX_ATTRIBUTE_TEXT_LENGTH) {
      throw AssetServiceError.invalidRequest(
        `attributes[${index}].trait_type must be between 1 and ${MAX_ATTRIBUTE_TEXT_LENGTH} characters`,
        { field: `attributes[${index}].trait_type` },
      )
    }
    if (value.length > MAX_ATTRIBUTE_TEXT_LENGTH) {
      throw AssetServiceError.invalidRequest(
        `attributes[${index}].value must be at most ${MAX_ATTRIBUTE_TEXT_LENGTH} characters`,
        { field: `attributes[${index}].value` },
      )
    }
    return { trait_type: traitType, value }
  })
}
