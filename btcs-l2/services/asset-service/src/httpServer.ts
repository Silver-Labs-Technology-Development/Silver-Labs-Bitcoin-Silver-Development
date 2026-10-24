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
import { AssetEngineService, createAssetEngineServiceFromEnv } from './assetEngineService.js'
import { AssetEngineError } from 'btcs-l2-v010-evm-harness/assetEngine/errors.js'
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

// Asset Engine routes
export const ENGINE_NETWORKS_PATH = '/api/asset-engine/networks'
export const ENGINE_CONNECT_PATH = '/api/asset-engine/connect'
export const ENGINE_CONNECTION_PATH = '/api/asset-engine/connection'
export const ENGINE_ESTIMATE_FEES_PATH = '/api/asset-engine/estimate-fees'
export const ENGINE_DEPLOY_PATH = '/api/asset-engine/deploy'
export const ENGINE_DEPLOYMENTS_PATH = '/api/asset-engine/deployments'
export const ENGINE_ATTACH_LOGO_PATH = '/api/asset-engine/attach-logo'
export const ENGINE_MINT_PATH = '/api/asset-engine/mint'
export const ENGINE_LOGOS_PATH_PREFIX = '/api/asset-engine/logos/'

export type AssetServerOptions = {
  service: AssetService
  /** Local object store used to serve `GET /assets/objects/<digest>`. */
  localObjectStore?: LocalObjectStore | undefined
  /** Asset engine service for deployment and registry operations. */
  assetEngineService?: AssetEngineService | undefined
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
  const serialized = JSON.stringify(body, (_key, value) => (typeof value === 'bigint' ? value.toString(10) : value));
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

async function handleEngineNetworks(
  options: AssetServerOptions,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const networks = await engine.getNetworks()
  sendJson(response, 200, { ok: true, networks }, options.allowedOrigins)
}

async function handleEngineConnect(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const body = await readBody(request, options.maxRequestBytes)
  const parsed = JSON.parse(body.toString('utf8')) as { networkId?: string; rpcUrl?: string }
  if (!parsed.networkId) {
    throw AssetServiceError.invalidRequest('networkId is required', { field: 'networkId' })
  }
  const connection = await engine.connect(parsed.networkId, parsed.rpcUrl)
  sendJson(response, 200, { ok: true, connection }, options.allowedOrigins)
}

async function handleEngineConnection(
  options: AssetServerOptions,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const connection = engine.getConnection()
  sendJson(response, 200, { ok: true, connection }, options.allowedOrigins)
}

async function handleEngineEstimateFees(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const body = await readBody(request, options.maxRequestBytes)
  const parsed = JSON.parse(body.toString('utf8')) as {
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
  if (!parsed.networkId || !parsed.name || !parsed.symbol || parsed.decimals === undefined || !parsed.initialSupply) {
    throw AssetServiceError.invalidRequest('networkId, name, symbol, decimals, and initialSupply are required')
  }
  const estimate = await engine.estimateDeploymentFees(parsed)
  // Convert bigints to strings for JSON serialization
  const serializable = {
    ...estimate,
    gasLimit: estimate.gasLimit.toString(),
    estimatedNativeFee: estimate.estimatedNativeFee.toString(),
    maxFeePerGas: estimate.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: estimate.maxPriorityFeePerGas?.toString(),
    gasPrice: estimate.gasPrice?.toString(),
  }
  sendJson(response, 200, { ok: true, estimate: serializable }, options.allowedOrigins)
}

async function handleEngineDeploy(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const body = await readBody(request, options.maxRequestBytes)
  const parsed = JSON.parse(body.toString('utf8')) as {
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
    description?: string
    externalUrl?: string
    logoBase64?: string
    allowMainnet?: boolean
  }
  if (!parsed.networkId || !parsed.name || !parsed.symbol || parsed.decimals === undefined || !parsed.initialSupply) {
    throw AssetServiceError.invalidRequest('networkId, name, symbol, decimals, and initialSupply are required')
  }
  if (!parsed.logoBase64) {
    throw AssetServiceError.invalidRequest(
      'logoBase64 is required for token deployment',
    )
  }
  const logoBytes = Buffer.from(parsed.logoBase64, 'base64')
  if (logoBytes.byteLength === 0) {
    throw AssetServiceError.invalidRequest(
      'logoBase64 must contain non-empty image bytes',
    )
  }
  const result = await engine.deployFungible({
    networkId: parsed.networkId,
    standard: parsed.standard,
    name: parsed.name,
    symbol: parsed.symbol,
    decimals: parsed.decimals,
    initialSupply: parsed.initialSupply,
    maxSupply: parsed.maxSupply,
    supplyPolicy: parsed.supplyPolicy,
    burnPolicy: parsed.burnPolicy,
    pausePolicy: parsed.pausePolicy,
    metadataMutable: parsed.metadataMutable,
    metadataUri: parsed.metadataUri,
    metadataHash: parsed.metadataHash,
    description: parsed.description,
    externalUrl: parsed.externalUrl,
    logoBytes,
    allowMainnet: parsed.allowMainnet,
  })
  // Convert bigints to strings for JSON serialization
  const serializableDeployment = {
    ...result.deployment,
    // DeploymentRecord doesn't have bigints in the current schema
  }
  const serializableFeeQuote = {
    ...result.feeQuote,
    gasLimit: result.feeQuote.gasLimit.toString(),
    estimatedNativeFee: result.feeQuote.estimatedNativeFee.toString(),
    maxFeePerGas: result.feeQuote.maxFeePerGas?.toString(),
    maxPriorityFeePerGas: result.feeQuote.maxPriorityFeePerGas?.toString(),
    gasPrice: result.feeQuote.gasPrice?.toString(),
  }
  sendJson(response, 200, { ok: true, deployment: serializableDeployment, connection: result.connection, feeQuote: serializableFeeQuote }, options.allowedOrigins)
}

async function handleEngineDeployments(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const url = new URL(request.url ?? '/', 'http://localhost')
  const networkId = url.searchParams.get('networkId') || undefined
  const deployments = await engine.listDeployments(networkId)
  sendJson(response, 200, { ok: true, deployments }, options.allowedOrigins)
}

async function handleEngineLogo(
  options: AssetServerOptions,
  response: ServerResponse,
  pathname: string,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const sha256 = pathname.slice(ENGINE_LOGOS_PATH_PREFIX.length)
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw AssetServiceError.notFound('logo digest is not valid')
  }
  let logo: { data: Uint8Array; mediaType: string }
  try {
    logo = await engine.readDeploymentLogo(sha256)
  } catch {
    throw AssetServiceError.notFound(`no stored logo matches ${sha256}`)
  }
  setCommonHeaders(response, options.allowedOrigins)
  response.setHeader('Content-Type', logo.mediaType)
  response.setHeader('Content-Length', String(logo.data.length))
  response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.writeHead(200)
  response.end(Buffer.from(logo.data))
}

async function handleEngineMint(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const body = await readBody(request, options.maxRequestBytes)
  const parsed = JSON.parse(body.toString('utf8')) as {
    networkId?: string
    assetId?: string
    to?: string
    atomicAmount?: string
    allowMainnet?: boolean
  }
  if (!parsed.assetId || !parsed.to || parsed.atomicAmount === undefined) {
    throw AssetServiceError.invalidRequest('assetId, to, and atomicAmount are required')
  }
  const result = await engine.mintFts1({
    networkId: parsed.networkId,
    assetId: parsed.assetId,
    to: parsed.to,
    atomicAmount: parsed.atomicAmount,
    allowMainnet: parsed.allowMainnet ?? false,
  })
  sendJson(response, 200, {
    ok: true,
    transactionHash: result.mined.transactionHash,
    setupTransactionHash: result.setupTransactionHash,
    receipt: {
      ...result.mined.receipt,
      gasUsed: result.mined.receipt.gasUsed.toString(10),
      effectiveGasPrice: result.mined.receipt.effectiveGasPrice.toString(10),
    },
    onChain: {
      totalSupply: result.onChain.totalSupply.toString(10),
      maxSupply: result.onChain.maxSupply.toString(10),
      paused: result.onChain.paused,
    },
  }, options.allowedOrigins)
}

async function handleEngineAttachLogo(
  options: AssetServerOptions,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const engine = options.assetEngineService
  if (engine === undefined) {
    throw AssetServiceError.internal('asset engine service is not configured')
  }
  const body = await readBody(request, options.maxRequestBytes)
  const parsed = JSON.parse(body.toString('utf8')) as { assetId: string; logoBase64: string }
  if (!parsed.assetId || !parsed.logoBase64) {
    throw AssetServiceError.invalidRequest('assetId and logoBase64 are required')
  }
  const logoBytes = Buffer.from(parsed.logoBase64, 'base64')
  const deployment = await engine.attachLogo(parsed.assetId, logoBytes)
  sendJson(response, 200, { ok: true, deployment }, options.allowedOrigins)
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
      if (error instanceof AssetEngineError) {
        sendError(response, AssetServiceError.invalidRequest(error.message), options.allowedOrigins)
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

  // Asset Engine routes
  if (pathname === ENGINE_NETWORKS_PATH) {
    if (method !== 'GET') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_NETWORKS_PATH} only accepts GET requests`)
    }
    await handleEngineNetworks(options, response)
    return
  }

  if (pathname === ENGINE_CONNECT_PATH) {
    if (method !== 'POST') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_CONNECT_PATH} only accepts POST requests`)
    }
    await handleEngineConnect(options, request, response)
    return
  }

  if (pathname === ENGINE_CONNECTION_PATH) {
    if (method !== 'GET') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_CONNECTION_PATH} only accepts GET requests`)
    }
    await handleEngineConnection(options, response)
    return
  }

  if (pathname === ENGINE_ESTIMATE_FEES_PATH) {
    if (method !== 'POST') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_ESTIMATE_FEES_PATH} only accepts POST requests`)
    }
    await handleEngineEstimateFees(options, request, response)
    return
  }

  if (pathname === ENGINE_DEPLOY_PATH) {
    if (method !== 'POST') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_DEPLOY_PATH} only accepts POST requests`)
    }
    await handleEngineDeploy(options, request, response)
    return
  }

  if (pathname === ENGINE_DEPLOYMENTS_PATH) {
    if (method !== 'GET') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_DEPLOYMENTS_PATH} only accepts GET requests`)
    }
    await handleEngineDeployments(options, request, response)
    return
  }

  if (pathname === ENGINE_ATTACH_LOGO_PATH) {
    if (method !== 'POST') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_ATTACH_LOGO_PATH} only accepts POST requests`)
    }
    await handleEngineAttachLogo(options, request, response)
    return
  }

  if (pathname === ENGINE_MINT_PATH) {
    if (method !== 'POST') {
      request.resume()
      throw AssetServiceError.methodNotAllowed(`${ENGINE_MINT_PATH} only accepts POST requests`)
    }
    await handleEngineMint(options, request, response)
    return
  }

  if (pathname.startsWith(ENGINE_LOGOS_PATH_PREFIX)) {
    if (method !== 'GET' && method !== 'HEAD') {
      request.resume()
      throw AssetServiceError.methodNotAllowed('deployment logos are served with GET requests')
    }
    request.resume()
    await handleEngineLogo(options, response, pathname)
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
  const assetEngineService = createAssetEngineServiceFromEnv(env)
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
        assetEngineService,
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
