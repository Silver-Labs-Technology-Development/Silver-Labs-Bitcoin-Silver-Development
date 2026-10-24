/**
 * Local development object store.
 *
 * Objects are content addressed by their SHA-256 digest and written to disk
 * under the configured data directory. The URIs produced by this provider are
 * served by the asset service itself on the loopback interface.
 *
 * A URI produced here is **local-only**: it resolves on the machine that
 * created it, while the development server runs, and nowhere else. It must not
 * be presented as durable or as portable to another machine.
 */

import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { AssetServiceError } from '../errors.js'
import type { PutObjectInput, ReadableObject, StorageProvider, StoredObject } from './provider.js'

export type LocalObjectStoreOptions = {
  /** Directory that holds the stored objects. */
  dataDirectory: string
  /**
   * Base URL used to build object URIs, e.g. `http://127.0.0.1:8787`.
   * The service appends `/assets/objects/<sha256>.<ext>`.
   */
  publicBaseUrl: string
}

export function sha256ContentHash(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

export class LocalObjectStore implements StorageProvider {
  readonly id = 'local-dev'
  readonly durability = 'local-only' as const
  readonly portable = false

  readonly dataDirectory: string
  readonly publicBaseUrl: string
  readonly objectsDirectory: string

  constructor(options: LocalObjectStoreOptions) {
    this.dataDirectory = options.dataDirectory
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, '')
    this.objectsDirectory = join(options.dataDirectory, 'objects')
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const digest = input.contentHash.replace(/^sha256:/, '')
    if (!/^[0-9a-f]{64}$/.test(digest)) {
      throw AssetServiceError.storageFailure('the content hash is not a sha256 digest', {
        contentHash: input.contentHash,
      })
    }
    const fileName = `${digest}.${input.extension}`
    const target = join(this.objectsDirectory, fileName)
    try {
      mkdirSync(this.objectsDirectory, { recursive: true })
      if (!existsSync(target)) {
        const temporary = `${target}.${process.pid}.tmp`
        writeFileSync(temporary, input.data)
        renameSync(temporary, target)
      }
    } catch (error) {
      throw AssetServiceError.storageFailure(
        `the local object store could not persist the object: ${error instanceof Error ? error.message : 'unknown error'}`,
        { provider: this.id },
      )
    }
    return {
      uri: `${this.publicBaseUrl}/assets/objects/${fileName}`,
      provider: this.id,
      durability: this.durability,
      portable: this.portable,
      verified: true,
    }
  }

  /**
   * Read a stored object back by its SHA-256 digest.
   *
   * Used by the local development server to serve object URIs and by tests to
   * verify that a returned URI resolves to the bytes that were uploaded.
   */
  readObjectByDigest(digest: string): ReadableObject | undefined {
    if (!/^[0-9a-f]{64}$/.test(digest)) return undefined
    let fileNames: string[]
    try {
      fileNames = readdirSync(this.objectsDirectory)
    } catch {
      return undefined
    }
    const match = fileNames.find((fileName) => fileName.startsWith(`${digest}.`))
    if (match === undefined) return undefined
    const data = readFileSync(join(this.objectsDirectory, match))
    const extension = match.slice(digest.length + 1)
    return {
      data: new Uint8Array(data),
      mimeType: extension === 'json' ? 'application/json' : mimeTypeForExtension(extension),
    }
  }
}

function mimeTypeForExtension(extension: string): string {
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    default:
      return 'application/octet-stream'
  }
}
