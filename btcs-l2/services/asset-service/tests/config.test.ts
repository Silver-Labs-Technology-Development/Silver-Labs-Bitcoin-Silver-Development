import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { describeAssetServiceConfig, loadAssetServiceConfig } from '../src/config.js'
import { AssetServiceError } from '../src/errors.js'

describe('asset service configuration', () => {
  it('defaults to the local development provider', () => {
    const config = loadAssetServiceConfig({})
    assert.equal(config.storage?.kind, 'local-dev')
    assert.equal(config.storageError, undefined)
    assert.equal(config.host, '127.0.0.1')
    assert.equal(config.port, 8787)
    assert.equal(config.limits.maxFileBytes, 5 * 1024 * 1024)
    assert.deepEqual([...config.allowedOrigins], [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ])
  })

  it('reports a missing ipfs configuration instead of silently falling back', () => {
    const config = loadAssetServiceConfig({ ASSET_STORAGE_PROVIDER: 'ipfs' })
    assert.equal(config.storage, undefined)
    assert.ok(config.storageError instanceof AssetServiceError)
    assert.equal(config.storageError?.code, 'storage-not-configured')
    assert.match(config.storageError?.message ?? '', /ASSET_IPFS_API_URL/)
  })

  it('rejects an unknown storage provider', () => {
    const config = loadAssetServiceConfig({ ASSET_STORAGE_PROVIDER: 'dropbox' })
    assert.equal(config.storage, undefined)
    assert.equal(config.storageError?.code, 'storage-not-configured')
    assert.match(config.storageError?.message ?? '', /local-dev/)
  })

  it('reads ipfs configuration from the environment', () => {
    const config = loadAssetServiceConfig({
      ASSET_STORAGE_PROVIDER: 'ipfs',
      ASSET_IPFS_API_URL: 'http://127.0.0.1:5001',
      ASSET_IPFS_GATEWAY_URL: 'https://ipfs.example',
      ASSET_IPFS_AUTH_TOKEN: 'secret-token-value',
    })
    assert.equal(config.storage?.kind, 'ipfs')
    assert.equal(config.storageError, undefined)
    if (config.storage?.kind !== 'ipfs') return
    assert.equal(config.storage.apiUrl, 'http://127.0.0.1:5001')
    assert.equal(config.storage.gatewayUrl, 'https://ipfs.example')
    assert.equal(config.storage.auth?.type, 'bearer')
  })

  it('never exposes credentials in the configuration summary', () => {
    const config = loadAssetServiceConfig({
      ASSET_STORAGE_PROVIDER: 'ipfs',
      ASSET_IPFS_API_URL: 'http://127.0.0.1:5001',
      ASSET_IPFS_AUTH_TOKEN: 'secret-token-value',
    })
    const summary = JSON.stringify(describeAssetServiceConfig(config))
    assert.equal(summary.includes('secret-token-value'), false)
    assert.equal(summary.includes('Authorization'), false)
    assert.match(summary, /"credentialsConfigured":true/)
  })

  it('never exposes credentials for the local provider', () => {
    const config = loadAssetServiceConfig({})
    const summary = describeAssetServiceConfig(config)
    assert.deepEqual(summary.storage, {
      configured: true,
      kind: 'local-dev',
      durability: 'local-only',
      portable: false,
      dataDirectory: config.storage?.kind === 'local-dev' ? config.storage.dataDirectory : undefined,
      publicBaseUrl: undefined,
      apiUrl: undefined,
      gatewayUrl: undefined,
      pin: undefined,
      credentialsConfigured: false,
    })
  })

  it('rejects a malformed numeric limit', () => {
    assert.throws(
      () => loadAssetServiceConfig({ ASSET_MAX_FILE_BYTES: 'lots' }),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'invalid-request' &&
        error.details.key === 'ASSET_MAX_FILE_BYTES',
    )
  })

  it('rejects a request limit below the file limit', () => {
    assert.throws(
      () => loadAssetServiceConfig({ ASSET_MAX_FILE_BYTES: '2048', ASSET_MAX_REQUEST_BYTES: '1024' }),
      (error: unknown) =>
        error instanceof AssetServiceError && error.code === 'invalid-request',
    )
  })
})
