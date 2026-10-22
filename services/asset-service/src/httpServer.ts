/**
 * HTTP adapter for the asset service.
 *
 * Routes:
 * - `POST /api/assets/images`      multipart image upload
 * - `GET  /api/assets/images/limits`  limits and accepted values (no credentials)
 * - `GET  /assets/objects/<digest>`   stored objects served by the local provider
 * - `GET  /healthz`                 deployment status
 *
 * The upload route accepts a `multipart/form-data` body. The image part is
 * named `image` (the alias `file` is also accepted) and must be the only file
 * part in the body.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import { describeAssetServiceConfig, loadAssetServiceConfig, type AssetServiceConfig } from './config.js'
import { AssetServiceError, isAssetServiceError } from './errors.js'
import { AssetService } from './service.js'
import { IpfsStorageProvider } from './storage/ipfsProvider.js'
import { LocalObjectStore } from './storage/localStore.js'
import type { StorageProvider } from './storage/provider.js'
import {
  SUPPORTED_ASSET_IMAGE_KINDS,
  SUPPORTED_IMAGE_FORMATS,
  type AssetImageContext,
  type AssetUploadResponse,
  type MetadataAttribute,
} from './types.js'

export const UPLOAD_PATH = '/api/assets/images'
export const LIMITS_PATH = '/api/assets/images/limits'
export const OBJECT_PATH_PREFIX = '/assets/objects/'
export const HEALTH_PATH = '/healthz'

export type AssetServerOptions = {
  service: AssetService
  /** Local object store used to serve `GET /assets/objects/<digest>`. */
  localObjectStore?: LocalObjectStore | undefined
  /** Origins allowed to call the API from a browser. */
  allowedOrigins: readonly string[]
  /** Maximum accepted request body size. */
  maxRequestBytes: number
}

export type AssetServer = {
  host: string
  port: number
  url: string
  /** Identifier of the configured storage provider, or `null` when unconfigured. */
  storageProvider: string | null
  /** Durability class of the URIs the service produces. */
  storageDurability: 'local-only' | 'durable' | null
  /** Whether the produced URIs resolve independently of this host. */
  storagePortable: boolean | null
  /** Why the service has no usable storage, when it has none. */
  storageConfigurationError: string | null
  close: () => Promise<void>
}

function setCommonHeaders(response: ServerResponse, allowedOrigins: readonly string[]): void {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Cache-Control', 'no-store')
  const origin = response.req?.headers.origin
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Vary', 'Origin')
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  allowedOrigins: readonly string[],
): void {
  if (response.headersSent || response.destroyed) return
  setCommonHeaders(response, allowedOrigins)
  const serialized = JSON.stringify(body)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(serialized),
  })
  response.end(serialized)
}

function sendError(response: ServerResponse, error: AssetServiceError, allowedOrigins: readonly string[]): void {
  sendJson(
    response,
    error.httpStatus,
    { ok: false, error: { code: error.code, message: error.message, details: error.details } },
    allowedOrigins,
  )
}

async function readBody(request: IncomingMessage, maxRequestBytes: number): Promise<Buffer> {
  const declaredLength = request.headers['content-length']
  if (declaredLength !== undefined && Number(declaredLength) > maxRequestBytes) {
    request.resume()
    throw AssetServiceError.payloadTooLarge(
      `the request body is larger than the ${maxRequestBytes} byte limit`,
      { maxRequestBytes },
    )
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    request.on('data', (chunk: Buffer | Uint8Array) => {
      if (settled) return
      size += chunk.length
      if (size > maxRequestBytes) {
        settled = true
        chunks.length = 0
        reject(
          AssetServiceError.payloadTooLarge(
            `the request body is larger than the ${maxRequestBytes} byte limit`,
            { maxRequestBytes },
          ),
        )
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    request.once('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks, size))
    })
    request.once('error', (error: Error) => {
      if (settled) return
      settled = true
      reject(error)
    })
  })
}

function readTextField(form: FormData, name: string): string | undefined {
  const value = form.get(name)
  if (value === null) return undefined
  if (typeof value !== 'string') {
    throw AssetServiceError.invalidRequest(`the "${name}" field must be a text field`, { field: name })
  }
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function parseAttributes(raw: string | undefined): MetadataAttribute[] | undefined {
  if (raw === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw AssetServiceError.invalidRequest('attributes must be a JSON array of trait objects', {
      field: 'attributes',
    })
  }
  if (!Array.isArray(parsed)) {
    throw AssetServiceError.invalidRequest('attributes must be a JSON array of trait objects', {
      field: 'attributes',
    })
  }
  return parsed.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw AssetServiceError.invalidRequest('each attribute must be an object', { field: 'attributes' })
    }
    const record = entry as Record<string, unknown>
    const traitType = record.trait_type ?? record.traitType
    const value = record.value
    if (typeof traitType !== 'string' || typeof value !== 'string') {
      throw AssetServiceError.invalidRequest(
        'each attribute must have a string trait_type and a string value',
        { field: 'attributes' },
      )
    }
    return { trait_type: traitType, value }
  })
}

async function parseMultipart(body: Buffer, contentType: string): Promise<FormData> {
  let form: FormData
  try {
    const request = new Request('http://localhost/', {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: new Uint8Array(body),
    })
    form = await request.formData()
  } catch (error) {
    throw AssetServiceError.invalidRequest(
      `the multipart body could not be parsed: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }
  return form
}

async function handleUpload(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const contentType = request.headers['content-type']
  if (contentType === undefined || !contentType.toLowerCase().startsWith('multipart/form-data')) {
    request.resume()
    throw AssetServiceError.unsupportedMediaType(
      'the request body must be multipart/form-data with an image part',
    )
  }
  const body = await readBody(request, options.maxRequestBytes)
  const form = await parseMultipart(body, contentType)

  const candidates = [...form.getAll('image'), ...form.getAll('file')].filter(
    (value): value is File => typeof value === 'object' && value !== null && 'arrayBuffer' in value,
  )
  if (candidates.length === 0) {
    throw AssetServiceError.missingFile('the multipart body contains no "image" part')
  }
  if (candidates.length > 1) {
    throw AssetServiceError.invalidRequest('the multipart body must contain exactly one image part', {
      field: 'image',
      parts: candidates.length,
    })
  }
  const image = candidates[0] as File
  const data = new Uint8Array(await image.arrayBuffer())

  const chainIdRaw = readTextField(form, 'chainId')
  let chainId: number | undefined
  if (chainIdRaw !== undefined) {
    chainId = Number(chainIdRaw)
    if (!Number.isSafeInteger(chainId)) {
      throw AssetServiceError.invalidRequest('chainId must be an integer', { field: 'chainId' })
    }
  }

  const context: AssetImageContext = {
    assetKind: readTextField(form, 'assetKind') as AssetImageContext['assetKind'],
    bsnaProfile: readTextField(form, 'bsnaProfile') as AssetImageContext['bsnaProfile'],
    bsnaVersion: readTextField(form, 'bsnaVersion'),
    name: readTextField(form, 'name'),
    description: readTextField(form, 'description'),
    externalUrl: readTextField(form, 'externalUrl'),
    chainId,
    contractAddress: readTextField(form, 'contractAddress'),
    tokenId: readTextField(form, 'tokenId'),
    attributes: parseAttributes(readTextField(form, 'attributes')),
  }

  const result = await options.service.uploadImage({
    image: {
      data,
      declaredMimeType: image.type.length > 0 ? image.type : undefined,
      filename: image.name.length > 0 ? image.name : undefined,
    },
    context,
  })
  const body2: AssetUploadResponse = { ok: true, ...result }
  sendJson(response, 200, body2, options.allowedOrigins)
}

function handleLimits(options: AssetServerOptions, response: ServerResponse): void {
  sendJson(
    response,
    200,
    {
      ok: true,
      limits: { ...options.service.limits },
      supportedAssetKinds: [...SUPPORTED_ASSET_IMAGE_KINDS],
      supportedImageFormats: [...SUPPORTED_IMAGE_FORMATS],
      storageProvider: options.service.provider?.id ?? null,
      storageDurability: options.service.provider?.durability ?? null,
    },
    options.allowedOrigins,
  )
}

async function handleObject(
  options: AssetServerOptions,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const store = options.localObjectStore
  if (store === undefined) {
    throw AssetServiceError.notFound('this deployment does not serve stored objects')
  }
  const remainder = pathname.slice(OBJECT_PATH_PREFIX.length)
  const digest = remainder.split('.')[0] ?? ''
  const object = store.readObjectByDigest(digest)
  if (object === undefined) {
    throw AssetServiceError.notFound('the requested object does not exist')
  }
  setCommonHeaders(response, options.allowedOrigins)
  response.writeHead(200, {
    'Content-Type': object.mimeType,
    'Content-Length': object.data.byteLength,
  })
  response.end(Buffer.from(object.data))
}

/**
 * Build the service options once the listener address is known.
 *
 * The builder receives the base URL the server is actually listening on so
 * that local development object URIs point at the running server.
 */
export type AssetServerOptionsBuilder = (publicBaseUrl: string) => AssetServerOptions

/**
 * Start the asset HTTP server.
 */
export async function startAssetServer(
  buildOptions: AssetServerOptionsBuilder,
  listen: { host: string; port: number },
): Promise<AssetServer> {
  return listenAssetServer(buildOptions, listen)
}

function createHttpServer(getOptions: () => AssetServerOptions | undefined): Server {
  return createServer((request, response) => {
    const options = getOptions()
    if (options === undefined) {
      request.resume()
      sendError(response, AssetServiceError.internal('the asset service is still starting'), [])
      return
    }
    void handleRequest(options, request, response).catch((error: unknown) => {
      if (isAssetServiceError(error)) {
        sendError(response, error, options.allowedOrigins)
        return
      }
      sendError(response, AssetServiceError.internal(), options.allowedOrigins)
    })
  })
}

async function listenAssetServer(
  buildOptions: AssetServerOptionsBuilder,
  listen: { host: string; port: number },
): Promise<AssetServer> {
  let current: AssetServerOptions | undefined
  const server = createHttpServer(() => current)
  server.maxHeadersCount = 64
  server.headersTimeout = 10_000
  server.requestTimeout = 60_000
  server.keepAliveTimeout = 5_000

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ host: listen.host, port: listen.port, exclusive: true })
  })

  const address = server.address() as AddressInfo
  current = buildOptions(`http://${listen.host}:${address.port}`)
  const provider = current.service.provider
  return {
    host: listen.host,
    port: address.port,
    url: `http://${listen.host}:${address.port}`,
    storageProvider: provider?.id ?? null,
    storageDurability: provider?.durability ?? null,
    storagePortable: provider?.portable ?? null,
    storageConfigurationError: current.service.storageError?.message ?? null,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

async function handleRequest(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? 'GET'
  const origin = request.headers.origin
  const allowedOrigin =
    typeof origin === 'string' && options.allowedOrigins.includes(origin) ? origin : undefined

  if (method === 'OPTIONS') {
    request.resume()
    setCommonHeaders(response, options.allowedOrigins)
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (allowedOrigin !== undefined) {
      response.setHeader('Access-Control-Max-Age', '600')
    }
    response.writeHead(204)
    response.end()
    return
  }

  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname

  if (pathname === HEALTH_PATH) {
    request.resume()
    const configured = options.service.provider !== undefined
    sendJson(
      response,
      configured ? 200 : 503,
      {
        ok: configured,
        status: configured ? 'ready' : 'storage-not-configured',
        storageProvider: options.service.provider?.id ?? null,
        storageDurability: options.service.provider?.durability ?? null,
        storagePortable: options.service.provider?.portable ?? null,
        reason: configured ? undefined : options.service.storageError?.message,
      },
      options.allowedOrigins,
    )
    return
  }

  if (pathname === UPLOAD_PATH) {
    if (method !== 'POST') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${UPLOAD_PATH} only accepts POST requests`)
    }
    await handleUpload(options, request, response)
    return
  }

  if (pathname === LIMITS_PATH) {
    if (method !== 'GET') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${LIMITS_PATH} only accepts GET requests`)
    }
    request.resume()
    handleLimits(options, response)
    return
  }

  if (pathname.startsWith(OBJECT_PATH_PREFIX)) {
    if (method !== 'GET' && method !== 'HEAD') {
      request.resume()
      throw AssetServiceError.methodNotAllowed('stored objects are served with GET requests')
    }
    await handleObject(options, response, pathname)
    return
  }

  request.resume()
  throw AssetServiceError.notFound(`no route matches ${pathname}`)
}

/**
 * Build and start the asset service from an environment.
 *
 * The storage provider is created after the listener is bound so that local
 * development URIs can use the address the server actually listens on.
 */
export async function startAssetServerFromEnv(env: NodeJS.ProcessEnv): Promise<AssetServer> {
  const config: AssetServiceConfig = loadAssetServiceConfig(env)
  return startAssetServer(
    (defaultBaseUrl) => {
      const publicBaseUrl =
        config.storage?.kind === 'local-dev' && config.storage.publicBaseUrl !== undefined
          ? config.storage.publicBaseUrl
          : defaultBaseUrl
      const provider: StorageProvider | undefined = createProvider(config, publicBaseUrl)
      const localObjectStore = provider instanceof LocalObjectStore ? provider : undefined
      const service = new AssetService({
        provider,
        limits: config.limits,
        storageError: config.storageError,
      })
      return {
        service,
        localObjectStore,
        allowedOrigins: config.allowedOrigins,
        maxRequestBytes: config.limits.maxRequestBytes,
      }
    },
    { host: config.host, port: config.port },
  )
}

function createProvider(
  config: AssetServiceConfig,
  publicBaseUrl: string,
): StorageProvider | undefined {
  const storage = config.storage
  if (storage === undefined) return undefined
  if (storage.kind === 'local-dev') {
    return new LocalObjectStore({
      dataDirectory: storage.dataDirectory,
      publicBaseUrl,
    })
  }
  return new IpfsStorageProvider({
    apiUrl: storage.apiUrl,
    gatewayUrl: storage.gatewayUrl,
    auth: storage.auth,
    pin: storage.pin,
    requestTimeoutMs: storage.requestTimeoutMs,
  })
}

export { describeAssetServiceConfig }
