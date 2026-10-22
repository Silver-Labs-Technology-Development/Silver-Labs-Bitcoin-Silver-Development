/**
 * Contract and metadata integration test.
 *
 * The test uploads images through the real asset service, deploys the BSNA
 * reference contracts on the local development chain and verifies that the
 * contract really returns the metadata URI the service produced.
 *
 * The local development JSON-RPC server does not implement `eth_call`, so the
 * contract reads are performed by a small probe contract
 * (`contracts/test/BsnaMetadataProbe.sol`) that stores what the BSNA interface
 * returned. The probe is deployed and called with ordinary transactions.
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createAddressFromString } from '@ethereumjs/util'

import { SENDER_ADDRESS } from '../../../../execution/evm/src/config.js'
import { PersistentBlockProcessor } from '../../../../execution/evm/src/blockProcessor.js'
import { startLocalRpcServer, type LocalRpcServer } from '../../../../execution/evm/src/rpc.js'
import { signFeeMarketTransaction } from '../../../../execution/evm/src/transactions.js'

import type { AssetServiceLimits } from '../../src/config.js'
import { AssetService } from '../../src/service.js'
import { LocalObjectStore } from '../../src/storage/localStore.js'
import type { AssetImageKind, BsnaMetadata } from '../../src/types.js'
import { encodeArguments, encodeCall, functionSelector, keccak256OfString } from '../helpers/abi.js'
import { compileBsnaContracts, type CompiledBsnaContracts } from '../helpers/contractCompiler.js'
import { buildPng } from '../helpers/imageFixtures.js'

const LIMITS: AssetServiceLimits = {
  maxFileBytes: 1_048_576,
  maxRequestBytes: 2_097_152,
  maxImageWidth: 1024,
  maxImageHeight: 1024,
  maxImagePixels: 1024 * 1024,
}

const DEPLOY_GAS_LIMIT = 6_000_000n
const CALL_GAS_LIMIT = 1_000_000n

type RpcResult = {
  status: string
  contractAddress?: string | null
}

class Rpc {
  constructor(private readonly url: string) {}

  async send(method: string, params: unknown[] = []): Promise<unknown> {
    const response = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    const body = (await response.json()) as {
      result?: unknown
      error?: { code: number; message: string }
    }
    if (body.error !== undefined) {
      throw new Error(`${method} failed: ${body.error.message} (code ${body.error.code})`)
    }
    return body.result
  }
}

describe('BSNA contract metadata integration', () => {
  let dataDirectory: string
  let rpcServer: LocalRpcServer
  let rpc: Rpc
  let store: LocalObjectStore
  let service: AssetService
  let compiled: CompiledBsnaContracts
  let nonce = 0n

  before(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'btcs-asset-contract-'))
    const chain = await PersistentBlockProcessor.open(dataDirectory)
    rpcServer = await startLocalRpcServer(chain, { port: 0, enableDevelopmentSequencer: true })
    rpc = new Rpc(`http://${rpcServer.host}:${rpcServer.port}`)
    store = new LocalObjectStore({
      dataDirectory: join(dataDirectory, 'objects'),
      publicBaseUrl: `http://${rpcServer.host}:${rpcServer.port}`,
    })
    service = new AssetService({ provider: store, limits: LIMITS })
    compiled = compileBsnaContracts()
  })

  after(async () => {
    await rpcServer?.close()
    await rm(dataDirectory, { recursive: true, force: true })
  })

  async function sendTransaction(options: {
    to?: string
    data: Uint8Array
    gasLimit?: bigint
  }): Promise<RpcResult> {
    const tx = signFeeMarketTransaction({
      nonce,
      to: options.to === undefined ? undefined : createAddressFromString(options.to),
      data: options.data,
      gasLimit: options.gasLimit ?? CALL_GAS_LIMIT,
      maxFeePerGas: 5_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
    })
    nonce += 1n
    const raw = `0x${Buffer.from(tx.serialize()).toString('hex')}`
    const hash = `0x${Buffer.from(tx.hash()).toString('hex')}`
    await rpc.send('eth_sendRawTransaction', [raw])
    await rpc.send('btcs_dev_mine', [])
    const receipt = (await rpc.send('eth_getTransactionReceipt', [hash])) as RpcResult
    assert.equal(receipt.status, '0x1', `transaction ${hash} reverted`)
    return receipt
  }

  async function deploy(bytecode: Uint8Array, args: Parameters<typeof encodeArguments>[0]): Promise<string> {
    const data = Buffer.concat([Buffer.from(bytecode), encodeArguments(args)])
    const receipt = await sendTransaction({ data: new Uint8Array(data), gasLimit: DEPLOY_GAS_LIMIT })
    assert.ok(receipt.contractAddress, 'the deployment did not report a contract address')
    return receipt.contractAddress
  }

  async function readStorageSlot(address: string, slot: bigint): Promise<bigint> {
    const value = (await rpc.send('eth_getStorageAt', [
      address,
      `0x${slot.toString(16)}`,
      'latest',
    ])) as string
    return BigInt(value)
  }

  async function upload(assetKind: AssetImageKind, name: string) {
    return service.uploadImage({
      image: { data: new Uint8Array(buildPng(24, 12)), declaredMimeType: 'image/png', filename: 'logo.png' },
      context: { assetKind, name, description: `${name} description` },
    })
  }

  it('publishes the service metadata URI through bsnaMetadata() on BSNA20', async () => {
    const uploadResult = await upload('bsna20-logo', 'Silver Forge Token')
    assert.equal(uploadResult.bsnaProfile, 'BSNA-20')
    assert.equal(uploadResult.assetType, 'fungible')
    assert.equal(uploadResult.metadataTarget, 'bsna20-metadata-uri')

    const bsna20 = await deploy(compiled.BSNA20.creationBytecode, [
      { type: 'string', value: 'Silver Forge Token' },
      { type: 'string', value: 'SFT' },
      { type: 'uint256', value: 1_000n },
      { type: 'uint256', value: 10_000n },
      { type: 'string', value: uploadResult.metadataUri },
      { type: 'address', value: SENDER_ADDRESS.toString() },
    ])

    const probe = await deploy(compiled.BsnaMetadataProbe.creationBytecode, [])

    await sendTransaction({
      to: probe,
      data: new Uint8Array(encodeCall('captureMetadata(address)', [{ type: 'address', value: bsna20 }])),
    })
    await sendTransaction({
      to: probe,
      data: new Uint8Array(
        encodeCall('captureIdentity(address)', [{ type: 'address', value: bsna20 }]),
      ),
    })

    assert.equal(await readStorageSlot(probe, 0n), BigInt(uploadResult.metadataUri.length))
    assert.equal(
      `0x${(await readStorageSlot(probe, 1n)).toString(16).padStart(64, '0')}`,
      `0x${keccak256OfString(uploadResult.metadataUri)}`,
    )
    assert.equal(
      `0x${(await readStorageSlot(probe, 2n)).toString(16).padStart(64, '0')}`,
      `0x${keccak256OfString('1.0')}`,
    )
    assert.equal(
      `0x${(await readStorageSlot(probe, 3n)).toString(16).padStart(64, '0')}`,
      `0x${keccak256OfString('fungible')}`,
    )
    assert.equal(
      `0x${(await readStorageSlot(probe, 4n)).toString(16).padStart(64, '0')}`,
      `0x${keccak256OfString('BSNA-20')}`,
    )
  })

  it('publishes the collection metadata URI through bsnaMetadata() on BSNA721', async () => {
    const uploadResult = await upload('bsna721-collection-image', 'Silver Forge Collection')
    assert.equal(uploadResult.bsnaProfile, 'BSNA-721')
    assert.equal(uploadResult.assetType, 'nonfungible')
    assert.equal(uploadResult.metadataTarget, 'bsna721-collection-metadata-uri')

    const bsna721 = await deploy(compiled.BSNA721.creationBytecode, [
      { type: 'string', value: 'Silver Forge Collection' },
      { type: 'string', value: 'SFC' },
      { type: 'string', value: uploadResult.metadataUri },
      { type: 'address', value: SENDER_ADDRESS.toString() },
    ])

    const probe = await deploy(compiled.BsnaMetadataProbe.creationBytecode, [])

    await sendTransaction({
      to: probe,
      data: new Uint8Array(
        encodeCall('captureMetadata(address)', [{ type: 'address', value: bsna721 }]),
      ),
    })
    await sendTransaction({
      to: probe,
      data: new Uint8Array(
        encodeCall('captureIdentity(address)', [{ type: 'address', value: bsna721 }]),
      ),
    })

    assert.equal(await readStorageSlot(probe, 0n), BigInt(uploadResult.metadataUri.length))
    assert.equal(
      `0x${(await readStorageSlot(probe, 1n)).toString(16).padStart(64, '0')}`,
      `0x${keccak256OfString(uploadResult.metadataUri)}`,
    )
    assert.equal(
      `0x${(await readStorageSlot(probe, 4n)).toString(16).padStart(64, '0')}`,
      `0x${keccak256OfString('BSNA-721')}`,
    )
  })

  it('publishes the token metadata URI through tokenURI() after safeMint', async () => {
    const uploadResult = await upload('bsna721-token-image', 'Silver Forge Token #1')
    assert.equal(uploadResult.metadataTarget, 'bsna721-token-uri')

    const bsna721 = await deploy(compiled.BSNA721.creationBytecode, [
      { type: 'string', value: 'Silver Forge Collection' },
      { type: 'string', value: 'SFC' },
      { type: 'string', value: uploadResult.metadataUri },
      { type: 'address', value: SENDER_ADDRESS.toString() },
    ])

    await sendTransaction({
      to: bsna721,
      data: new Uint8Array(
        encodeCall('safeMint(address,string)', [
          { type: 'address', value: SENDER_ADDRESS.toString() },
          { type: 'string', value: uploadResult.metadataUri },
        ]),
      ),
      gasLimit: CALL_GAS_LIMIT,
    })

    const probe = await deploy(compiled.BsnaMetadataProbe.creationBytecode, [])
    await sendTransaction({
      to: probe,
      data: new Uint8Array(
        encodeCall('captureTokenUri(address,uint256)', [
          { type: 'address', value: bsna721 },
          { type: 'uint256', value: 0n },
        ]),
      ),
    })

    assert.equal(await readStorageSlot(probe, 5n), BigInt(uploadResult.metadataUri.length))
    assert.equal(
      `0x${(await readStorageSlot(probe, 6n)).toString(16).padStart(64, '0')}`,
      `0x${keccak256OfString(uploadResult.metadataUri)}`,
    )
  })

  it('stores a metadata document that only declares the BSNA field set', async () => {
    const uploadResult = await upload('bsna20-logo', 'Silver Forge Token')
    const digest = uploadResult.metadataUri.slice(uploadResult.metadataUri.lastIndexOf('/') + 1)
    const stored = store.readObjectByDigest(digest.slice(0, digest.lastIndexOf('.')))
    assert.ok(stored, 'the metadata document is not readable from the object store')
    const metadata = JSON.parse(Buffer.from(stored.data).toString('utf8')) as BsnaMetadata
    assert.deepEqual(Object.keys(metadata).sort(), [
      'attributes',
      'description',
      'external_url',
      'image',
      'name',
    ])
    assert.equal(metadata.image, uploadResult.imageUri)
  })

  it('uses the same BSNA interface selectors as the reference contracts', () => {
    const signatures = ['bsnaVersion()', 'assetType()', 'bsnaProfile()', 'bsnaMetadata()']
    for (const contract of [compiled.BSNA20, compiled.BSNA721]) {
      for (const signature of signatures) {
        assert.equal(
          contract.methodIdentifiers[signature],
          functionSelector(signature),
          `${contract.name} does not implement ${signature} with the standard selector`,
        )
      }
    }
  })
})
