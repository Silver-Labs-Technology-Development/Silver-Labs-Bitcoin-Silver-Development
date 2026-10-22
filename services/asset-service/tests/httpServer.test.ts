import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import type { AssetServiceLimits } from '../src/config.js'
import { AssetService } from '../src/service.js'
import { startAssetServer, type AssetServer } from '../src/httpServer.js'
import { LocalObjectStore } from '../src/storage/localStore.js'
import { buildNonImage, buildPng } from './helpers/imageFixtures.js'

const LIMITS: AssetServiceLimits = {
  maxFileBytes: 4096,
  maxRequestBytes: 8192,
  maxImageWidth: 1024,
  maxImageHeight: 1024,
  maxImagePixels: 1024 * 1024,
}

const BOUNDARY = '----btcsassettestboundary'

type MultipartFile = {
  fieldName?: string
  filename: string
  contentType: string
  data: Buffer<ArrayBuffer>
}

function buildMultipart(
  fields: Record<string, string>,
  file?: MultipartFile,
): { body: Buffer<ArrayBuffer>; contentType: string } {
  const parts: Buffer<ArrayBuffer>[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    )
  }
  if (file !== undefined) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${file.fieldName ?? 'image'}"; ` +
          `filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      file.data,
      Buffer.from('\r\n', 'utf8'),
    )
  }
  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'))
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${BOUNDARY}`,
  }
}

async function postUpload(
  server: AssetServer,
  body: Buffer<ArrayBuffer>,
  contentType: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${server.url}/api/assets/images`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body,
  })
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('POST /api/assets/images', () => {
  let dataDirectory: string
  let server: AssetServer

  before(async () => {
    dataDirectory = mkdtempSync(join(tmpdir(), 'btcs-asset-http-'))
    server = await startAssetServer(
      (publicBaseUrl) => {
        const store = new LocalObjectStore({ dataDirectory, publicBaseUrl })
        const service = new AssetService({ provider: store, limits: LIMITS })
        return {
          service,
          localObjectStore: store,
          allowedOrigins: ['http://localhost:3000'],
          maxRequestBytes: LIMITS.maxRequestBytes,
        }
      },
      { host: '127.0.0.1', port: 0 },
    )
  })

  after(async () => {
    await server.close()
    rmSync(dataDirectory, { recursive: true, force: true })
  })

  it('accepts a valid upload and returns the documented response shape', async () => {
    const png = buildPng(64, 32)
    const multipart = buildMultipart(
      { assetKind: 'bsna20-logo', name: 'Silver Coin', description: 'A test asset' },
      { filename: 'logo.png', contentType: 'image/png', data: png },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)

    assert.equal(status, 200)
    assert.equal(body.ok, true)
    assert.equal(typeof body.imageUri, 'string')
    assert.equal(typeof body.contentHash, 'string')
    assert.equal(typeof body.mimeType, 'string')
    assert.equal(typeof body.sizeBytes, 'number')
    assert.equal(typeof body.storageProvider, 'string')

    assert.equal(body.mimeType, 'image/png')
    assert.equal(body.sizeBytes, png.byteLength)
    assert.equal(body.storageProvider, 'local-dev')
    assert.equal(body.durability, 'local-only')
    assert.equal(body.portable, false)
    assert.equal(body.width, 64)
    assert.equal(body.height, 32)
    assert.equal(
      body.contentHash,
      `sha256:${createHash('sha256').update(png).digest('hex')}`,
    )
    assert.equal(body.bsnaProfile, 'BSNA-20')
    assert.equal(body.assetType, 'fungible')
    assert.equal(body.metadataTarget, 'bsna20-metadata-uri')
  })

  it('returns a metadata document that only uses the BSNA standard fields', async () => {
    const multipart = buildMultipart(
      { assetKind: 'bsna721-collection-image', name: 'Silver Collection' },
      { filename: 'collection.png', contentType: 'image/png', data: buildPng(16, 16) },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 200)
    const metadata = body.metadata as Record<string, unknown>
    assert.deepEqual(Object.keys(metadata).sort(), [
      'attributes',
      'description',
      'external_url',
      'image',
      'name',
    ])
    assert.equal(metadata.image, body.imageUri)
    assert.equal(body.metadataTarget, 'bsna721-collection-metadata-uri')
  })

  it('serves the image uri it returns', async () => {
    const png = buildPng(20, 20)
    const multipart = buildMultipart(
      { assetKind: 'bsna721-token-image', name: 'Token #3', tokenId: '3' },
      { filename: 'token.png', contentType: 'image/png', data: png },
    )
    const { body } = await postUpload(server, multipart.body, multipart.contentType)
    const imageUri = String(body.imageUri)
    const digest = String(body.contentHash).replace('sha256:', '')
    assert.ok(imageUri.endsWith(`/${digest}.png`))

    const response = await fetch(imageUri)
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
  })

  it('serves the metadata uri it returns', async () => {
    const multipart = buildMultipart(
      { assetKind: 'bsna20-logo' },
      { filename: 'logo.png', contentType: 'image/png', data: buildPng(20, 20) },
    )
    const { body } = await postUpload(server, multipart.body, multipart.contentType)
    const response = await fetch(String(body.metadataUri))
    assert.equal(response.status, 200)
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(
      `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
      body.metadataContentHash,
    )
    assert.deepEqual(JSON.parse(bytes.toString('utf8')), body.metadata)
  })

  it('rejects a file that is not an image with a structured error', async () => {
    const multipart = buildMultipart(
      { assetKind: 'bsna20-logo' },
      { filename: 'evil.png', contentType: 'image/png', data: buildNonImage() },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 422)
    assert.equal(body.ok, false)
    const error = body.error as Record<string, unknown>
    assert.equal(error.code, 'invalid-image')
    assert.equal(typeof error.message, 'string')
    assert.equal(typeof error.details, 'object')
  })

  it('rejects a browser mime type that contradicts the file signature', async () => {
    const multipart = buildMultipart(
      { assetKind: 'bsna20-logo' },
      { filename: 'logo.gif', contentType: 'image/gif', data: buildPng(8, 8) },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 415)
    const error = body.error as Record<string, unknown>
    assert.equal(error.code, 'content-type-mismatch')
  })

  it('rejects an oversized file', async () => {
    const oversized = Buffer.concat([buildPng(64, 64), Buffer.alloc(LIMITS.maxFileBytes)])
    const multipart = buildMultipart(
      { assetKind: 'bsna20-logo' },
      { filename: 'huge.png', contentType: 'image/png', data: oversized },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 413)
    const error = body.error as Record<string, unknown>
    assert.equal(error.code, 'file-too-large')
  })

  it('rejects a request body larger than the request limit', async () => {
    const multipart = buildMultipart(
      { assetKind: 'bsna20-logo' },
      { filename: 'huge.png', contentType: 'image/png', data: Buffer.alloc(LIMITS.maxRequestBytes + 512) },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 413)
    const error = body.error as Record<string, unknown>
    assert.equal(error.code, 'payload-too-large')
  })

  it('rejects a multipart body without an image part', async () => {
    const multipart = buildMultipart({ assetKind: 'bsna20-logo' })
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 400)
    const error = body.error as Record<string, unknown>
    assert.equal(error.code, 'missing-file')
  })

  it('rejects a request that is not multipart', async () => {
    const response = await fetch(`${server.url}/api/assets/images`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assetKind: 'bsna20-logo' }),
    })
    assert.equal(response.status, 415)
    const body = (await response.json()) as Record<string, unknown>
    assert.equal((body.error as Record<string, unknown>).code, 'unsupported-media-type')
  })

  it('rejects an unknown asset kind', async () => {
    const multipart = buildMultipart(
      { assetKind: 'bsna20-watermark' },
      { filename: 'logo.png', contentType: 'image/png', data: buildPng(8, 8) },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 400)
    const error = body.error as Record<string, unknown>
    assert.equal(error.code, 'invalid-request')
  })

  it('accepts caller supplied attributes as a json field', async () => {
    const multipart = buildMultipart(
      {
        assetKind: 'bsna721-token-image',
        attributes: JSON.stringify([{ trait_type: 'Metal', value: 'Silver' }]),
      },
      { filename: 'token.png', contentType: 'image/png', data: buildPng(8, 8) },
    )
    const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
    assert.equal(status, 200)
    const attributes = (body.metadata as Record<string, unknown>).attributes as Array<{
      trait_type: string
      value: string
    }>
    assert.equal(attributes[0]?.trait_type, 'Metal')
    assert.equal(attributes[0]?.value, 'Silver')
  })

  it('answers preflight requests for an allowed origin', async () => {
    const response = await fetch(`${server.url}/api/assets/images`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000' },
    })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:3000')
  })

  it('does not grant cors to an unknown origin', async () => {
    const response = await fetch(`${server.url}/api/assets/images`, {
      method: 'OPTIONS',
      headers: { origin: 'http://evil.example' },
    })
    assert.equal(response.status, 204)
    assert.equal(response.headers.get('access-control-allow-origin'), null)
  })
})

describe('asset service routes', () => {
  let server: AssetServer

  before(async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), 'btcs-asset-routes-'))
    server = await startAssetServer(
      (publicBaseUrl) => {
        const store = new LocalObjectStore({ dataDirectory, publicBaseUrl })
        const service = new AssetService({ provider: store, limits: LIMITS })
        return {
          service,
          localObjectStore: store,
          allowedOrigins: [],
          maxRequestBytes: LIMITS.maxRequestBytes,
        }
      },
      { host: '127.0.0.1', port: 0 },
    )
  })

  after(async () => {
    await server.close()
  })

  it('exposes the upload limits without credentials', async () => {
    const response = await fetch(`${server.url}/api/assets/images/limits`)
    assert.equal(response.status, 200)
    const body = (await response.json()) as Record<string, unknown>
    assert.equal(body.ok, true)
    assert.deepEqual(body.supportedImageFormats, ['png', 'jpeg', 'gif', 'webp'])
    assert.deepEqual(body.supportedAssetKinds, [
      'bsna20-logo',
      'bsna721-collection-image',
      'bsna721-token-image',
    ])
    assert.equal(body.storageProvider, 'local-dev')
    assert.equal(body.storageDurability, 'local-only')
    assert.equal(JSON.stringify(body).includes('Bearer'), false)
    assert.equal(JSON.stringify(body).includes('password'), false)
  })

  it('reports health and the storage provider', async () => {
    const response = await fetch(`${server.url}/healthz`)
    assert.equal(response.status, 200)
    const body = (await response.json()) as Record<string, unknown>
    assert.equal(body.ok, true)
    assert.equal(body.storageProvider, 'local-dev')
    assert.equal(body.storageDurability, 'local-only')
    assert.equal(body.storagePortable, false)
  })

  it('rejects a GET on the upload route', async () => {
    const response = await fetch(`${server.url}/api/assets/images`)
    assert.equal(response.status, 405)
    const body = (await response.json()) as Record<string, unknown>
    assert.equal((body.error as Record<string, unknown>).code, 'method-not-allowed')
  })

  it('reports a structured error for an unknown route', async () => {
    const response = await fetch(`${server.url}/nope`)
    assert.equal(response.status, 404)
    const body = (await response.json()) as Record<string, unknown>
    assert.equal(body.ok, false)
    assert.equal((body.error as Record<string, unknown>).code, 'not-found')
  })

  it('reports a structured error for a missing object', async () => {
    const response = await fetch(`${server.url}/assets/objects/${'0'.repeat(64)}.png`)
    assert.equal(response.status, 404)
    const body = (await response.json()) as Record<string, unknown>
    assert.equal((body.error as Record<string, unknown>).code, 'not-found')
  })
})

describe('asset service without storage configuration', () => {
  it('refuses uploads with a structured error and reports unhealthy', async () => {
    const service = new AssetService({ provider: undefined, limits: LIMITS })
    const server = await startAssetServer(
      () => ({
        service,
        allowedOrigins: [],
        maxRequestBytes: LIMITS.maxRequestBytes,
      }),
      { host: '127.0.0.1', port: 0 },
    )
    try {
      const multipart = buildMultipart(
        { assetKind: 'bsna20-logo' },
        { filename: 'logo.png', contentType: 'image/png', data: buildPng(8, 8) },
      )
      const { status, body } = await postUpload(server, multipart.body, multipart.contentType)
      assert.equal(status, 503)
      assert.equal(body.ok, false)
      assert.equal((body.error as Record<string, unknown>).code, 'storage-not-configured')

      const health = await fetch(`${server.url}/healthz`)
      assert.equal(health.status, 503)
      const healthBody = (await health.json()) as Record<string, unknown>
      assert.equal(healthBody.status, 'storage-not-configured')
    } finally {
      await server.close()
    }
  })
})
