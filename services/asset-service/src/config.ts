/**
 * Environment driven configuration for the asset service.
 *
 * Storage credentials are read from the process environment only. They are
 * never written to disk, never returned to the browser, and never included in
 * the configuration summary exposed by the health endpoint.
 */

import { resolve } from 'node:path'

import { AssetServiceError } from './errors.js'

export type AssetServiceLimits = {
  /** Maximum size of a single uploaded image, in bytes. */
  maxFileBytes: number
  /** Maximum size of the whole multipart request body, in bytes. */
  maxRequestBytes: number
  /** Maximum accepted image width, in pixels. */
  maxImageWidth: number
  /** Maximum accepted image height, in pixels. */
  maxImageHeight: number
  /** Maximum accepted number of pixels, as a decompression-bomb guard. */
  maxImagePixels: number
}

export type LocalStorageConfig = {
  kind: 'local-dev'
  /** Directory that holds the stored objects. */
  dataDirectory: string
  /**
   * Base URL used to build object URIs. When omitted the server uses the
   * address it is actually listening on.
   */
  publicBaseUrl?: string | undefined
}

export type IpfsStorageConfig = {
  kind: 'ipfs'
  /** Base URL of the IPFS HTTP API. */
  apiUrl: string
  /** Optional gateway base URL. */
  gatewayUrl?: string | undefined
  /** Server-side credentials. Never sent to the browser. */
  auth?:
    | { type: 'bearer'; token: string }
    | { type: 'basic'; username: string; password: string }
    | undefined
  /** Whether the uploaded content should be pinned. */
  pin: boolean
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number
}

export type StorageConfig = LocalStorageConfig | IpfsStorageConfig

export type AssetServiceConfig = {
  host: string
  port: number
  limits: AssetServiceLimits
  allowedOrigins: readonly string[]
  /** Configured storage, or `undefined` when the deployment is not usable. */
  storage: StorageConfig | undefined
  /** Why the storage configuration is unusable, when it is. */
  storageError: AssetServiceError | undefined
}

export const DEFAULT_ASSET_PORT = 8787
export const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024
export const DEFAULT_MAX_REQUEST_BYTES = 8 * 1024 * 1024
export const DEFAULT_MAX_IMAGE_WIDTH = 4096
export const DEFAULT_MAX_IMAGE_HEIGHT = 4096
export const DEFAULT_MAX_IMAGE_PIXELS = 4096 * 4096
export const DEFAULT_ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'] as const

function readPositiveInteger(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
): number {
  const raw = env[key]
  if (raw === undefined || raw.trim().length === 0) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw AssetServiceError.invalidRequest(`${key} must be a positive integer`, { key })
  }
  return value
}

function readString(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function loadStorageConfig(
  env: NodeJS.ProcessEnv,
  port: number,
): { storage: StorageConfig | undefined; error: AssetServiceError | undefined } {
  const provider = (readString(env, 'ASSET_STORAGE_PROVIDER') ?? 'local-dev').toLowerCase()

  if (provider === 'local-dev') {
    const dataDirectory = readString(env, 'ASSET_STORAGE_DATA_DIR') ?? resolve(process.cwd(), '.asset-store')
    const publicBaseUrl = readString(env, 'ASSET_STORAGE_PUBLIC_BASE_URL')
    return {
      storage: { kind: 'local-dev', dataDirectory: resolve(dataDirectory), publicBaseUrl },
      error: undefined,
    }
  }

  if (provider === 'ipfs') {
    const apiUrl = readString(env, 'ASSET_IPFS_API_URL')
    if (apiUrl === undefined) {
      return {
        storage: undefined,
        error: AssetServiceError.storageNotConfigured(
          'ASSET_STORAGE_PROVIDER is "ipfs" but ASSET_IPFS_API_URL is not set',
          { provider: 'ipfs', requiredVariables: ['ASSET_IPFS_API_URL'] },
        ),
      }
    }
    const token = readString(env, 'ASSET_IPFS_AUTH_TOKEN')
    const username = readString(env, 'ASSET_IPFS_USERNAME')
    const password = readString(env, 'ASSET_IPFS_PASSWORD')
    let auth: IpfsStorageConfig['auth']
    if (token !== undefined) {
      auth = { type: 'bearer', token }
    } else if (username !== undefined && password !== undefined) {
      auth = { type: 'basic', username, password }
    }
    const pin = (readString(env, 'ASSET_IPFS_PIN') ?? 'true').toLowerCase() !== 'false'
    const requestTimeoutMs = readPositiveInteger(env, 'ASSET_IPFS_TIMEOUT_MS', 15_000)
    return {
      storage: {
        kind: 'ipfs',
        apiUrl,
        gatewayUrl: readString(env, 'ASSET_IPFS_GATEWAY_URL'),
        auth,
        pin,
        requestTimeoutMs,
      },
      error: undefined,
    }
  }

  return {
    storage: undefined,
    error: AssetServiceError.storageNotConfigured(
      `ASSET_STORAGE_PROVIDER must be "local-dev" or "ipfs" but was "${provider}"`,
      { provider },
    ),
  }
}

/**
 * Load the service configuration from an environment.
 *
 * `storage` is `undefined` when the deployment has no usable storage
 * configuration; `storageError` then explains why.
 */
export function loadAssetServiceConfig(env: NodeJS.ProcessEnv): AssetServiceConfig {
  const port = readPositiveInteger(env, 'ASSET_PORT', DEFAULT_ASSET_PORT)
  if (port > 65_535) {
    throw AssetServiceError.invalidRequest('ASSET_PORT must be a port from 1 through 65535')
  }
  const host = readString(env, 'ASSET_HOST') ?? '127.0.0.1'
  const limits: AssetServiceLimits = {
    maxFileBytes: readPositiveInteger(env, 'ASSET_MAX_FILE_BYTES', DEFAULT_MAX_FILE_BYTES),
    maxRequestBytes: readPositiveInteger(env, 'ASSET_MAX_REQUEST_BYTES', DEFAULT_MAX_REQUEST_BYTES),
    maxImageWidth: readPositiveInteger(env, 'ASSET_MAX_IMAGE_WIDTH', DEFAULT_MAX_IMAGE_WIDTH),
    maxImageHeight: readPositiveInteger(env, 'ASSET_MAX_IMAGE_HEIGHT', DEFAULT_MAX_IMAGE_HEIGHT),
    maxImagePixels: readPositiveInteger(env, 'ASSET_MAX_IMAGE_PIXELS', DEFAULT_MAX_IMAGE_PIXELS),
  }
  if (limits.maxRequestBytes < limits.maxFileBytes) {
    throw AssetServiceError.invalidRequest(
      'ASSET_MAX_REQUEST_BYTES must be greater than or equal to ASSET_MAX_FILE_BYTES',
    )
  }
  const allowedOrigins = (readString(env, 'ASSET_ALLOWED_ORIGINS') ?? DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)

  const { storage, error } = loadStorageConfig(env, port)
  return {
    host,
    port,
    limits,
    allowedOrigins,
    storage,
    storageError: error,
  }
}

/**
 * Configuration summary safe to expose over HTTP.
 *
 * Credentials are represented only by their presence, never by their value.
 */
export function describeAssetServiceConfig(config: AssetServiceConfig): Record<string, unknown> {
  const storage = config.storage
  return {
    host: config.host,
    port: config.port,
    limits: { ...config.limits },
    allowedOrigins: [...config.allowedOrigins],
    storage:
      storage === undefined
        ? { configured: false }
        : {
            configured: true,
            kind: storage.kind,
            durability: storage.kind === 'ipfs' ? 'durable' : 'local-only',
            portable: storage.kind === 'ipfs',
            dataDirectory: storage.kind === 'local-dev' ? storage.dataDirectory : undefined,
            publicBaseUrl: storage.kind === 'local-dev' ? storage.publicBaseUrl : undefined,
            apiUrl: storage.kind === 'ipfs' ? storage.apiUrl : undefined,
            gatewayUrl: storage.kind === 'ipfs' ? storage.gatewayUrl : undefined,
            pin: storage.kind === 'ipfs' ? storage.pin : undefined,
            credentialsConfigured:
              storage.kind === 'ipfs' ? storage.auth !== undefined : false,
          },
  }
}
