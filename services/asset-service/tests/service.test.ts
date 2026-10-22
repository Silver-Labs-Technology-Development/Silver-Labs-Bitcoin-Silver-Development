import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { AssetServiceError } from '../src/errors.js'
import { AssetService } from '../src/service.js'
import { LocalObjectStore, sha256ContentHash } from '../src/storage/localStore.js'
import type { AssetServiceLimits } from '../src/config.js'
import { buildDisguisedText, buildNonImage, buildPng } from './helpers/imageFixtures.js'

const LIMITS: AssetServiceLimits = {
  maxFileBytes: 4096,
  maxRequestBytes: 8192,
  maxImageWidth: 1024,
  maxImageHeight: 1024,
  maxImagePixels: 1024 * 1024,
}

describe('asset service uploads', () => {
  let dataDirectory: string
  let store: LocalObjectStore
  let service: AssetService

  before(() => {
    dataDirectory = mkdtempSync(join(tmpdir(), 'btcs-asset-service-'))
    store = new LocalObjectStore({
      dataDirectory,
      publicBaseUrl: 'http://127.0.0.1:8787',
    })
    service = new AssetService({ provider: store, limits: LIMITS })
  })

  after(() => {
    rmSync(dataDirectory, { recursive: true, force: true })
  })

  it('stores a valid image and reports a structured result', async () => {
    const png = buildPng(64, 64)
    const result = await service.uploadImage({
      image: { data: new Uint8Array(png), declaredMimeType: 'image/png', filename: 'logo.png' },
      context: { assetKind: 'bsna20-logo', name: 'Silver Coin' },
    })

    assert.equal(result.imageUri.startsWith('http://127.0.0.1:8787/assets/objects/'), true)
    assert.equal(result.mimeType, 'image/png')
    assert.equal(result.sizeBytes, png.byteLength)
    assert.equal(result.storageProvider, 'local-dev')
    assert.equal(result.format, 'png')
    assert.equal(result.width, 64)
    assert.equal(result.height, 64)
    assert.equal(result.bsnaProfile, 'BSNA-20')
    assert.equal(result.assetType, 'fungible')
    assert.equal(result.metadataTarget, 'bsna20-metadata-uri')
  })

  it('reports the sha256 content hash of the uploaded bytes', async () => {
    const png = buildPng(10, 10)
    const result = await service.uploadImage({
      image: { data: new Uint8Array(png) },
      context: { assetKind: 'bsna20-logo' },
    })
    const expected = `sha256:${createHash('sha256').update(png).digest('hex')}`
    assert.equal(result.contentHash, expected)
    assert.equal(result.contentHash, sha256ContentHash(new Uint8Array(png)))
  })

  it('labels a local development uri as local-only and not portable', async () => {
    const result = await service.uploadImage({
      image: { data: new Uint8Array(buildPng(8, 8)) },
      context: { assetKind: 'bsna20-logo' },
    })
    assert.equal(result.durability, 'local-only')
    assert.equal(result.portable, false)
    assert.equal(result.metadataDurability, 'local-only')
    assert.equal(result.metadataPortable, false)
    assert.equal(result.warnings.length, 2)
    assert.match(result.warnings[0] ?? '', /local-only/)
    assert.match(result.warnings[0] ?? '', /not portable to other machines/)
  })

  it('keeps uri integrity: the stored object is byte identical to the upload', async () => {
    const png = buildPng(48, 24)
    const result = await service.uploadImage({
      image: { data: new Uint8Array(png) },
      context: { assetKind: 'bsna721-collection-image' },
    })
    const digest = result.contentHash.replace('sha256:', '')
    const stored = store.readObjectByDigest(digest)
    assert.ok(stored !== undefined)
    assert.deepEqual(Buffer.from(stored.data), png)
    assert.equal(stored.mimeType, 'image/png')
    assert.ok(result.imageUri.endsWith(`${digest}.png`))
  })

  it('keeps uri integrity: the stored metadata document is byte identical to the reported hash', async () => {
    const result = await service.uploadImage({
      image: { data: new Uint8Array(buildPng(16, 16)) },
      context: { assetKind: 'bsna721-token-image', name: 'Token #1', tokenId: '1' },
    })
    const digest = result.metadataContentHash.replace('sha256:', '')
    const stored = store.readObjectByDigest(digest)
    assert.ok(stored !== undefined)
    const bytes = Buffer.from(stored.data)
    assert.equal(sha256ContentHash(new Uint8Array(bytes)), result.metadataContentHash)
    assert.equal(stored.mimeType, 'application/json')
    const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
    assert.equal(parsed.image, result.imageUri)
    assert.deepEqual(parsed, result.metadata as unknown as Record<string, unknown>)
  })

  it('stores the metadata document next to the image and links them', async () => {
    const result = await service.uploadImage({
      image: { data: new Uint8Array(buildPng(16, 16)) },
      context: { assetKind: 'bsna20-logo' },
    })
    assert.equal(result.metadata.image, result.imageUri)
    assert.notEqual(result.metadataUri, result.imageUri)
    assert.ok(result.metadataUri.endsWith('.json'))
  })

  it('rejects bytes that are not an image', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildNonImage()) },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError && error.code === 'invalid-image',
    )
  })

  it('rejects an empty upload', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(0) },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) => error instanceof AssetServiceError && error.code === 'invalid-image',
    )
  })

  it('rejects a browser mime type that contradicts the file signature', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng()), declaredMimeType: 'image/gif' },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError && error.code === 'content-type-mismatch',
    )
  })

  it('rejects bytes that only look like an image in the browser', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildDisguisedText()), declaredMimeType: 'image/png' },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) => error instanceof AssetServiceError && error.code === 'invalid-image',
    )
  })

  it('rejects an oversized file', async () => {
    const oversized = Buffer.concat([buildPng(64, 64), Buffer.alloc(LIMITS.maxFileBytes)])
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(oversized) },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'file-too-large' &&
        error.details.maxFileBytes === LIMITS.maxFileBytes,
    )
  })

  it('rejects an image whose dimensions exceed the configured bounds', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng(2048, 16)) },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError && error.code === 'dimensions-out-of-range',
    )
  })

  it('rejects an unknown asset kind', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng()) },
          context: { assetKind: 'not-a-kind' as never },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'invalid-request' &&
        error.details.field === 'assetKind',
    )
  })

  it('rejects a bsna profile that contradicts the asset kind', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng()) },
          context: { assetKind: 'bsna20-logo', bsnaProfile: 'BSNA-721' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'invalid-request' &&
        error.details.field === 'bsnaProfile',
    )
  })

  it('rejects a malformed contract address', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng()) },
          context: { assetKind: 'bsna20-logo', contractAddress: '0x1234' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'invalid-request' &&
        error.details.field === 'contractAddress',
    )
  })

  it('rejects a non http external url', async () => {
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng()) },
          context: { assetKind: 'bsna20-logo', externalUrl: 'javascript:alert(1)' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'invalid-request' &&
        error.details.field === 'externalUrl',
    )
  })
})

describe('asset service without storage configuration', () => {
  it('refuses to upload and reports that storage is not configured', async () => {
    const service = new AssetService({ provider: undefined, limits: LIMITS })
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng()) },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError && error.code === 'storage-not-configured',
    )
  })

  it('reports the configuration reason supplied by the caller', async () => {
    const reason = AssetServiceError.storageNotConfigured('ASSET_IPFS_API_URL is not set')
    const service = new AssetService({ provider: undefined, limits: LIMITS, storageError: reason })
    await assert.rejects(
      () =>
        service.uploadImage({
          image: { data: new Uint8Array(buildPng()) },
          context: { assetKind: 'bsna20-logo' },
        }),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'storage-not-configured' &&
        error.message === 'ASSET_IPFS_API_URL is not set',
    )
  })
})
