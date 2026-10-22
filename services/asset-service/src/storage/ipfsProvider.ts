/**
 * IPFS compatible storage provider.
 *
 * The provider talks to a Kubo compatible HTTP API. Credentials are read from
 * the server-side environment configuration and are never exposed to the
 * browser or written to disk.
 *
 * Durability is only claimed after three independent checks succeed:
 * 1. the returned CID addresses the exact SHA-256 digest of the uploaded bytes,
 * 2. the content is present in the provider's pin list,
 * 3. reading the content back returns the uploaded bytes.
 *
 * If any check fails the upload fails with `storage-verification-failed`
 * instead of returning a URI that claims to be durable.
 */

import { AssetServiceError } from '../errors.js'
import { cidAddressesDigest } from './cid.js'
import type { PutObjectInput, StorageProvider, StoredObject } from './provider.js'

export type IpfsAuth =
  | { type: 'bearer'; token: string }
  | { type: 'basic'; username: string; password: string }

export type IpfsProviderOptions = {
  /** Base URL of the IPFS HTTP API, e.g. `http://127.0.0.1:5001`. */
  apiUrl: string
  /** Optional gateway base URL used to build a convenience HTTP URI. */
  gatewayUrl?: string | undefined
  /** Server-side credentials. Never sent to the browser. */
  auth?: IpfsAuth | undefined
  /** Whether the uploaded content should be pinned. Defaults to true. */
  pin?: boolean
  /** Per-request timeout in milliseconds. Defaults to 15000. */
  requestTimeoutMs?: number
}

export class IpfsStorageProvider implements StorageProvider {
  readonly id = 'ipfs'
  readonly durability = 'durable' as const
  readonly portable = true

  readonly apiUrl: string
  readonly gatewayUrl: string | undefined
  readonly auth: IpfsAuth | undefined
  readonly pin: boolean
  readonly requestTimeoutMs: number

  constructor(options: IpfsProviderOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, '')
    this.gatewayUrl = options.gatewayUrl?.replace(/\/+$/, '')
    this.auth = options.auth
    this.pin = options.pin ?? true
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const digestHex = input.contentHash.replace(/^sha256:/, '')
    if (!/^[0-9a-f]{64}$/.test(digestHex)) {
      throw AssetServiceError.storageFailure('the content hash is not a sha256 digest', {
        contentHash: input.contentHash,
      })
    }

    const cid = await this.addObject(input)
    if (!cidAddressesDigest(cid, digestHex)) {
      throw AssetServiceError.storageVerificationFailed(
        'the ipfs cid does not address the sha256 digest of the uploaded bytes',
        { cid, contentHash: input.contentHash },
      )
    }
    if (this.pin) {
      await this.assertPinned(cid)
    }
    await this.assertContentMatches(cid, input.data)

    return {
      uri: `ipfs://${cid}`,
      provider: this.id,
      durability: this.durability,
      portable: this.portable,
      verified: true,
    }
  }

  /** Convenience HTTP URI for a stored CID, when a gateway is configured. */
  gatewayUri(cid: string): string | undefined {
    if (this.gatewayUrl === undefined) return undefined
    return `${this.gatewayUrl}/ipfs/${cid}`
  }

  private authorizationHeader(): Record<string, string> {
    if (this.auth === undefined) return {}
    if (this.auth.type === 'bearer') {
      return { Authorization: `Bearer ${this.auth.token}` }
    }
    const encoded = Buffer.from(`${this.auth.username}:${this.auth.password}`, 'utf8').toString('base64')
    return { Authorization: `Basic ${encoded}` }
  }

  private async addObject(input: PutObjectInput): Promise<string> {
    const query = new URLSearchParams()
    query.set('cid-version', '1')
    query.set('raw-leaves', 'true')
    query.set('wrap-with-directory', 'false')
    query.set('hash', 'sha2-256')
    query.set('pin', this.pin ? 'true' : 'false')

    const form = new FormData()
    const blob = new Blob([input.data as unknown as BlobPart], { type: input.mimeType })
    form.append('file', blob, `${input.kind}.${input.extension}`)

    const response = await this.request(`${this.apiUrl}/api/v0/add?${query.toString()}`, {
      method: 'POST',
      body: form,
    })
    const body = await response.text()
    const cid = parseCidFromAddResponse(body)
    if (cid === undefined) {
      throw AssetServiceError.storageFailure('the ipfs add endpoint did not return a content identifier', {
        provider: this.id,
      })
    }
    return cid
  }

  private async assertPinned(cid: string): Promise<void> {
    const query = new URLSearchParams({ arg: cid })
    const response = await this.request(`${this.apiUrl}/api/v0/pin/ls?${query.toString()}`, {
      method: 'POST',
    })
    const body = await response.text()
    let parsed: unknown
    try {
      parsed = JSON.parse(body)
    } catch {
      throw AssetServiceError.storageVerificationFailed('the ipfs pin list response is not valid json', {
        provider: this.id,
      })
    }
    const keys = (parsed as { Keys?: Record<string, unknown> } | null)?.Keys
    if (keys === undefined || keys === null || !Object.prototype.hasOwnProperty.call(keys, cid)) {
      throw AssetServiceError.storageVerificationFailed('the uploaded content is not pinned by the ipfs node', {
        provider: this.id,
        cid,
      })
    }
  }

  private async assertContentMatches(cid: string, expected: Uint8Array): Promise<void> {
    const query = new URLSearchParams({ arg: cid })
    const response = await this.request(`${this.apiUrl}/api/v0/cat?${query.toString()}`, { method: 'POST' })
    const body = Buffer.from(await response.arrayBuffer())
    if (!body.equals(Buffer.from(expected))) {
      throw AssetServiceError.storageVerificationFailed(
        'the ipfs node returned different bytes than the ones that were uploaded',
        { provider: this.id, cid },
      )
    }
  }

  private async request(url: string, init: RequestInit): Promise<Response> {
    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers: { ...this.authorizationHeader(), ...(init.headers as Record<string, string> | undefined) },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      })
    } catch (error) {
      throw AssetServiceError.storageFailure(
        `the ipfs node could not be reached: ${error instanceof Error ? error.message : 'unknown error'}`,
        { provider: this.id },
      )
    }
    if (!response.ok) {
      throw AssetServiceError.storageFailure(`the ipfs node returned http ${response.status}`, {
        provider: this.id,
        status: response.status,
      })
    }
    return response
  }
}

/** Extract the CID from the newline delimited JSON response of `/api/v0/add`. */
export function parseCidFromAddResponse(body: string): string | undefined {
  const lines = body.split('\n')
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = (lines[index] ?? '').trim()
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      return undefined
    }
    const hash = (parsed as { Hash?: unknown } | null)?.Hash
    if (typeof hash === 'string' && hash.length > 0) return hash
    return undefined
  }
  return undefined
}
