import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { SENDER_PRIVATE_KEY } from '../src/config.js'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { startLocalRpcServer } from '../src/rpc.js'
import {
  AssetDevelopmentSession,
  DeploymentRegistry,
  NETWORKS,
  PrivateKeySigner,
  assetIdFor,
} from '../src/assetEngine/index.js'

const RECIPIENT = `0x${'aa'.repeat(20)}`
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

test('BSNA-FTS1 deploys, reads back, transfers, and persists its registry record', { timeout: 120_000 }, async () => {
  const chainDirectory = await mkdtemp(join(tmpdir(), 'btcs-fts1-engine-'))
  const registryDirectory = await mkdtemp(join(tmpdir(), 'btcs-fts1-registry-'))
  const chain = await PersistentBlockProcessor.open(chainDirectory)
  const server = await startLocalRpcServer(chain, { port: 0, enableDevelopmentSequencer: true })
  const rpcUrl = `http://${server.host}:${server.port}`

  async function rpc<T>(method: string, params: unknown[]): Promise<T> {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const body = await response.json() as { result?: T; error?: { message: string } }
    if (body.error !== undefined) throw new Error(`${method}: ${body.error.message}`)
    return body.result as T
  }

  async function gasCharge(transactionHash: string): Promise<bigint> {
    const receipt = await rpc<{ gasUsed: string; effectiveGasPrice: string }>(
      'eth_getTransactionReceipt',
      [transactionHash],
    )
    return BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)
  }

  try {
    const registry = new DeploymentRegistry(registryDirectory)
    const session = await AssetDevelopmentSession.connect({
      profile: NETWORKS.btcsL2Local,
      rpcUrl,
      signer: new PrivateKeySigner(SENDER_PRIVATE_KEY),
      registry,
      devSequencer: true,
    })

    const nativeBeforeDeploy = await session.nativeBalance()
    const record = await session.deployFts1({
      name: 'FTS Probe',
      symbol: 'FTSP',
      decimals: 6,
      atomicSupply: 1_500_000n,
      maxSupply: 1_500_000n,
      supplyPolicy: 'fixed',
      burnPolicy: 'holder-burn',
      pausePolicy: 'admin-pause',
      metadataMutable: true,
      metadataUri: 'local-only://metadata/fts-probe',
      metadataHash: 0x1234n,
      admin: session.signerAddress,
      description: 'local BSNA-FTS1 probe',
      externalUrl: 'https://example.invalid/fts',
      logoBytes: new Uint8Array(PNG),
    })
    const nativeAfterDeploy = await session.nativeBalance()

    // Section 10 item 16: deployment debits native BTCS by exactly
    // gasUsed * effectiveGasPrice. No token balance pays for gas.
    assert.equal(
      nativeBeforeDeploy - nativeAfterDeploy,
      await gasCharge(record.creationTransactionHash),
      'deployment native debit did not equal the receipt gas charge',
    )
    assert.equal(
      await session.nativeBalance(record.contractAddress),
      0n,
      'the token contract received or paid native value',
    )

    assert.equal(record.standard, 'BSNA-FTS1')
    assert.equal(record.interfaceConvention, 'erc-20')
    assert.equal(record.nativeGas.symbol, 'BTCS')
    assert.equal(record.supplyAtomic, '1500000')
    assert.equal(record.permissions.supplyPolicy, 'fixed')
    assert.equal(record.permissions.mint, 'none')
    assert.equal(record.permissions.burn, 'holder')
    assert.equal(record.permissions.pause, 'admin')
    assert.equal(record.permissions.metadataMutable, true)
    assert.equal(record.metadata.uri, 'local-only://metadata/fts-probe')
    assert.equal(record.metadata.hash, `0x${'0'.repeat(60)}1234`)
    assert.equal(record.metadata.logo?.mediaType, 'image/png')
    assert.equal(record.verification, 'unsupported')
    assert.equal(record.explorerTransactionUrl, null)
    assert.deepEqual(record.sameAssetOnOtherNetworks, [])
    assert.equal(record.assetId, assetIdFor('btcs-l2-local', record.contractAddress))

    const onChain = await session.readFts1(record.assetId)
    assert.deepEqual(onChain, {
      standard: 'BSNA-FTS1',
      version: '1',
      name: 'FTS Probe',
      symbol: 'FTSP',
      decimals: 6,
      totalSupply: 1_500_000n,
      admin: session.signerAddress,
      minter: '0x0000000000000000000000000000000000000000',
      supplyPolicy: 0,
      burnPolicy: 1,
      pausePolicy: 1,
      maxSupply: 1_500_000n,
      metadataMutable: true,
      metadataUri: 'local-only://metadata/fts-probe',
      metadataHash: 0x1234n,
      paused: false,
    })

    const nativeBeforeTransfer = await session.nativeBalance()
    const transferred = await session.transfer(record.assetId, RECIPIENT, 7n)
    const nativeAfterTransfer = await session.nativeBalance()
    assert.equal(transferred.receipt.status, '0x1')
    assert.equal(
      nativeBeforeTransfer - nativeAfterTransfer,
      await gasCharge(transferred.transactionHash),
      'transfer native debit did not equal the receipt gas charge',
    )
    assert.equal(
      await session.nativeBalance(record.contractAddress),
      0n,
      'the token contract received or paid native value on transfer',
    )
    assert.equal(await session.balanceOf(record.assetId, RECIPIENT), 7n)
    assert.equal(await session.balanceOf(record.assetId, session.signerAddress), 1_499_993n)

    const listed = await new DeploymentRegistry(registryDirectory).list('btcs-l2-local')
    assert.equal(listed.length, 1)
    assert.equal(listed[0]?.assetId, record.assetId)
    assert.equal(listed[0]?.standard, 'BSNA-FTS1')

    const authorized = await session.deployFts1({
      name: 'Mintable Probe',
      symbol: 'MNT',
      decimals: 0,
      atomicSupply: 10n,
      maxSupply: 0n,
      supplyPolicy: 'authorized-mint',
      burnPolicy: 'disabled',
      pausePolicy: 'disabled',
      metadataMutable: false,
      metadataUri: '',
      metadataHash: 0n,
      admin: session.signerAddress,
    })
    assert.equal(authorized.permissions.supplyPolicy, 'authorized-mint')
    assert.equal(authorized.permissions.mint, 'minter')
    assert.equal((await session.readFts1(authorized.assetId)).maxSupply, 0n)
    const minted = await session.mintFts1(authorized.assetId, RECIPIENT, 5n)
    assert.ok(minted.setupTransactionHash, 'the engine authorizes the minter before the first mint')
    assert.equal(minted.mined.receipt.status, '0x1')
    const afterMint = await session.readFts1(authorized.assetId)
    assert.equal(afterMint.totalSupply, 15n)
    assert.equal(afterMint.minter, session.signerAddress)
    assert.equal(await session.balanceOf(authorized.assetId, RECIPIENT), 5n)
  } finally {
    await server.close()
    await rm(chainDirectory, { recursive: true, force: true })
    await rm(registryDirectory, { recursive: true, force: true })
  }
})
