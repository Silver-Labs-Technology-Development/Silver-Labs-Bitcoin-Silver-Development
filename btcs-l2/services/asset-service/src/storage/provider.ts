/**
 * Storage provider abstraction.
 *
 * Two implementations ship with the service:
 * - `local-dev` — a local development object store. Its URIs are only valid on
 *   the machine that produced them and are explicitly reported as `local-only`.
 * - `ipfs` — an IPFS compatible provider. Its URIs are reported as `durable`
 *   only after the provider has positively verified the stored bytes and the
 *   content pin.
 */

import type { StorageDurability } from '../types.js'

export type PutObjectInput = {
  /** Exact bytes to persist. */
  data: Uint8Array
  /** MIME type of the object. */
  mimeType: string
  /** `sha256:<hex>` digest of `data`. */
  contentHash: string
  /** File extension to use, without a leading dot. */
  extension: string
  /** Purpose of the object, used for file naming only. */
  kind: 'image' | 'metadata'
}

export type StoredObject = {
  /** URI of the stored object. */
  uri: string
  /** Identifier of the provider. */
  provider: string
  /** Durability class of the URI. */
  durability: StorageDurability
  /** True only when the URI resolves independently of this host. */
  portable: boolean
  /** True only when the provider verified the stored bytes against the upload. */
  verified: boolean
}

export interface StorageProvider {
  /** Stable identifier reported to clients, e.g. `local-dev` or `ipfs`. */
  readonly id: string
  /** Durability class of every URI produced by this provider. */
  readonly durability: StorageDurability
  /** True only when the produced URIs resolve independently of this host. */
  readonly portable: boolean
  /**
   * Persist an object and return its URI.
   *
   * Implementations must throw an {@link AssetServiceError} when the object
   * cannot be stored, and must not report a `durable` URI for content they
   * could not verify.
   */
  putObject(input: PutObjectInput): Promise<StoredObject>
}

/** A stored object that can be read back by the local development server. */
export type ReadableObject = {
  data: Uint8Array
  mimeType: string
}
