/**
 * Integrated HTTP evidence for the BSNA-FTS1 asset-engine path.
 *
 * This starts the real local BTCS L2 processor, the real asset engine service,
 * and the real asset HTTP server. It covers the browser-facing routes that the
 * Studio uses: connect, fee estimate, ERC-20 deploy, BSNA-FTS1 deploy, registry
 * list, digest-backed logo serving, authorized mint, and fail-closed requests.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { PersistentBlockProcessor } from '../../../execution/evm/src/blockProcessor.js'
import { startLocalRpcServer, type LocalRpcServer } from '../../../execution/evm/src/rpc.js'
import { AssetEngineService } from '../src/assetEngineService.js'
import type { AssetServiceLimits } from '../src/config.js'
import { startAssetServer, type AssetServer } from '../src/httpServer.js'
import { AssetService } from '../src/service.js'
import { LocalObjectStore } from '../src/storage/localStore.js'

const LIMITS: AssetServiceLimits = {
  maxFileBytes: 4096,
  maxRequestBytes: 8192,
  maxImageWidth: 1024,
  maxImageHeight: 1024,
  maxImagePixels: 1024 * 1024,
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const RECIPIENT = '0x00000000000000000000000000000000000000cc'

describe('asset-engine BSNA-FTS1 HTTP workflow', () => {
  let chainDirectory: string
  let registryDirectory: string
  let objectDirectory: string
  let chain: PersistentBlockProcessor
  let rpcServer: LocalRpcServer
  let assetServer: AssetServer
  let engine: AssetEngineService

  before(async () => {
    chainDirectory = await mkdtemp(join(tmpdir(), 'btcs-fts1-http-chain-'))
    registryDirectory = await mkdtemp(join(tmpdir(), 'btcs-fts1-http-registry-'))
    objectDirectory = await mkdtemp(join(tmpdir(), 'btcs-fts1-http-objects-'))
    chain = await PersistentBlockProcessor.open(chainDirectory)
    rpcServer = await startLocalRpcServer(chain, { port: 0, enableDevelopmentSequencer: true })
    engine = new AssetEngineService({ registryDirectory, devSequencer: true })
    assetServer = await startAssetServer(
      (publicBaseUrl) => {
        const store = new LocalObjectStore({ dataDirectory: objectDirectory, publicBaseUrl })
        return {
          service: new AssetService({ provider: store, limits: LIMITS }),
          localObjectStore: store,
          assetEngineService: engine,
          allowedOrigins: ['http://localhost:3000'],
          maxRequestBytes: LIMITS.maxRequestBytes,
        }
      },
      { host: '127.0.0.1', port: 0 },
    )
  })

  after(async () => {
    await assetServer?.close()
    await engine?.close()
    await rpcServer?.close()
    await rm(chainDirectory, { recursive: true, force: true })
    await rm(registryDirectory, { recursive: true, force: true })
    await rm(objectDirectory, { recursive: true, force: true })
  })

  async function request(
    path: string,
    method: 'GET' | 'POST',
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const response = await fetch(`${assetServer.url}${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    }
  }

  it('connects by profile id, estimates FTS1 fees, deploys ERC-20 and BSNA-FTS1, serves the logo, and mints', async () => {
    const networks = await request('/api/asset-engine/networks', 'GET')
    assert.equal(networks.status, 200)
    const listedNetworks = networks.body.networks as Array<{ id: string; configured: boolean }>
    assert.ok(listedNetworks.some((network) => network.id === 'btcs-l2-local' && network.configured))

    const connected = await request('/api/asset-engine/connect', 'POST', {
      networkId: 'btcs-l2-local',
      rpcUrl: `http://${rpcServer.host}:${rpcServer.port}`,
    })
    assert.equal(connected.status, 200, JSON.stringify(connected.body))
    assert.equal(connected.body.ok, true)

    const estimate = await request('/api/asset-engine/estimate-fees', 'POST', {
      networkId: 'btcs-l2-local',
      standard: 'BSNA-FTS1',
      name: 'Estimate Probe',
      symbol: 'EST',
      decimals: 6,
      initialSupply: '100',
      maxSupply: '100',
      supplyPolicy: 'fixed',
      burnPolicy: 'disabled',
      pausePolicy: 'disabled',
      metadataMutable: false,
    })
    assert.equal(estimate.status, 200, JSON.stringify(estimate.body))
    const estimateBody = estimate.body.estimate as Record<string, unknown>
    assert.equal(estimateBody.networkId, 'btcs-l2-local')
    assert.equal(estimateBody.chainId, 31337)
    assert.equal(estimateBody.nativeSymbol, 'BTCS')
    assert.equal(typeof estimateBody.gasLimit, 'string')
    assert.equal(typeof estimateBody.estimatedNativeFee, 'string')

    const erc20 = await request('/api/asset-engine/deploy', 'POST', {
      networkId: 'btcs-l2-local',
      standard: 'ERC-20',
      name: 'Legacy Probe',
      symbol: 'LEG',
      decimals: 18,
      initialSupply: '1000',
      logoBase64: PNG.toString('base64'),
      allowMainnet: false,
    })
    assert.equal(erc20.status, 200, JSON.stringify(erc20.body))
    const erc20Deployment = erc20.body.deployment as Record<string, unknown>
    assert.equal(erc20Deployment.standard, 'ERC-20')
    assert.equal(erc20Deployment.supplyAtomic, '1000')
    assert.equal(erc20Deployment.nativeGas && (erc20Deployment.nativeGas as Record<string, unknown>).symbol, 'BTCS')

    const fts1 = await request('/api/asset-engine/deploy', 'POST', {
      networkId: 'btcs-l2-local',
      standard: 'BSNA-FTS1',
      name: 'Mintable Probe',
      symbol: 'MNT',
      decimals: 0,
      initialSupply: '10',
      maxSupply: '0',
      supplyPolicy: 'authorized-mint',
      burnPolicy: 'disabled',
      pausePolicy: 'disabled',
      metadataMutable: false,
      metadataUri: '',
      metadataHash: '0',
      description: 'HTTP FTS1 probe',
      logoBase64: PNG.toString('base64'),
      allowMainnet: false,
    })
    assert.equal(fts1.status, 200, JSON.stringify(fts1.body))
    const fts1Deployment = fts1.body.deployment as Record<string, unknown>
    assert.equal(fts1Deployment.standard, 'BSNA-FTS1')
    assert.equal(fts1Deployment.supplyAtomic, '10')
    assert.equal(fts1Deployment.interfaceConvention, 'erc-20')
    const permissions = fts1Deployment.permissions as Record<string, unknown>
    assert.equal(permissions.supplyPolicy, 'authorized-mint')
    assert.equal(permissions.mint, 'minter')
    const metadata = fts1Deployment.metadata as Record<string, unknown>
    const logo = metadata.logo as Record<string, unknown>
    assert.equal(logo.mediaType, 'image/png')
    assert.equal(logo.sha256, createHash('sha256').update(PNG).digest('hex'))

    const logoResponse = await fetch(`${assetServer.url}/api/asset-engine/logos/${String(logo.sha256)}`)
    assert.equal(logoResponse.status, 200)
    assert.equal(logoResponse.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await logoResponse.arrayBuffer()), PNG)

    const deployments = await request('/api/asset-engine/deployments?networkId=btcs-l2-local', 'GET')
    assert.equal(deployments.status, 200)
    const listed = deployments.body.deployments as Array<Record<string, unknown>>
    assert.equal(listed.length, 2)
    assert.deepEqual(listed.map((deployment) => deployment.standard).sort(), ['BSNA-FTS1', 'ERC-20'])

    const minted = await request('/api/asset-engine/mint', 'POST', {
      networkId: 'btcs-l2-local',
      assetId: fts1Deployment.assetId,
      to: RECIPIENT,
      atomicAmount: '5',
    })
    assert.equal(minted.status, 200, JSON.stringify(minted.body))
    assert.equal(typeof minted.body.transactionHash, 'string')
    assert.equal(typeof minted.body.setupTransactionHash, 'string')
    const onChain = minted.body.onChain as Record<string, unknown>
    assert.equal(onChain.totalSupply, '15')
    assert.equal(onChain.maxSupply, '0')
    assert.equal(onChain.paused, false)

    const connection = await request('/api/asset-engine/connection', 'GET')
    assert.equal(connection.status, 200)
    assert.equal((connection.body.connection as Record<string, unknown>).networkId, 'btcs-l2-local')
  })

  it('rejects deployment without a logo and fails closed for fixed-supply mint, invalid amount, and a cross-network asset', async () => {
    const noLogo = await request('/api/asset-engine/deploy', 'POST', {
      networkId: 'btcs-l2-local',
      standard: 'ERC-20',
      name: 'No Logo Probe',
      symbol: 'NOL',
      decimals: 18,
      initialSupply: '1000',
      allowMainnet: false,
    })
    assert.equal(noLogo.status, 400)
    assert.match(
      String((noLogo.body.error as Record<string, unknown>).message),
      /logoBase64 is required/i,
    )

    const fixed = await request('/api/asset-engine/deploy', 'POST', {
      networkId: 'btcs-l2-local',
      standard: 'BSNA-FTS1',
      name: 'Fixed Probe',
      symbol: 'FIX',
      decimals: 0,
      initialSupply: '3',
      maxSupply: '3',
      supplyPolicy: 'fixed',
      burnPolicy: 'disabled',
      pausePolicy: 'disabled',
      metadataMutable: false,
      logoBase64: PNG.toString('base64'),
      allowMainnet: false,
    })
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body))
    const fixedDeployment = fixed.body.deployment as Record<string, unknown>

    const fixedMint = await request('/api/asset-engine/mint', 'POST', {
      networkId: 'btcs-l2-local',
      assetId: fixedDeployment.assetId,
      to: RECIPIENT,
      atomicAmount: '1',
    })
    assert.equal(fixedMint.status, 400)
    assert.match(String((fixedMint.body.error as Record<string, unknown>).message), /fixed supply/i)

    const invalidAmount = await request('/api/asset-engine/mint', 'POST', {
      networkId: 'btcs-l2-local',
      assetId: fixedDeployment.assetId,
      to: RECIPIENT,
      atomicAmount: '1.5',
    })
    assert.equal(invalidAmount.status, 400)

    const wrongNetwork = await request('/api/asset-engine/mint', 'POST', {
      networkId: 'ethereum-sepolia',
      assetId: fixedDeployment.assetId,
      to: RECIPIENT,
      atomicAmount: '1',
    })
    assert.equal(wrongNetwork.status, 400)

    const missing = await request('/api/asset-engine/mint', 'POST', {
      networkId: 'btcs-l2-local',
      assetId: 'btcs-l2-local:0x0000000000000000000000000000000000000001',
      to: RECIPIENT,
      atomicAmount: '1',
    })
    assert.equal(missing.status, 400)
  })
})
