import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AssetServiceError } from '../src/errors.js'
import { sha256ContentHash } from '../src/storage/localStore.js'
import { IpfsStorageProvider, parseCidFromAddResponse } from '../src/storage/ipfsProvider.js'
import { cidAddressesDigest, decodeCidV1 } from '../src/storage/cid.js'
import { startFakeIpfsNode, buildCidV1ForContent } from './helpers/ipfsFixtures.js'
import { buildPng } from './helpers/imageFixtures.js'

describe('ipfs cid handling', () => {
  it('decodes a cidv1 into its codec and multihash digest', () => {
    const data = buildPng(8, 8)
    const cid = buildCidV1ForContent(data)
    const decoded = decodeCidV1(cid)
    assert.equal(decoded.version, 1)
    assert.equal(decoded.multihashCode, 0x12)
    assert.equal(
      decoded.digestHex,
      sha256ContentHash(new Uint8Array(data)).replace('sha256:', ''),
    )
    assert.equal(cidAddressesDigest(cid, decoded.digestHex), true)
    assert.equal(cidAddressesDigest(cid, '0'.repeat(64)), false)
  })

  it('rejects a cid that is not version 1', () => {
    assert.throws(
      () => decodeCidV1('QmYwAPJzv5CZsnAzt8auVZRnGdC7A2R6jVx8B2fP3v3v3v'),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'storage-verification-failed' &&
        error.message.includes('multibase'),
    )
  })
})

describe('ipfs provider', () => {
  it('stores an object and reports a durable, portable uri', async () => {
    const node = await startFakeIpfsNode()
    try {
      const provider = new IpfsStorageProvider({ apiUrl: node.url })
      const data = new Uint8Array(buildPng(32, 32))
      const contentHash = sha256ContentHash(data)
      const stored = await provider.putObject({
        data,
        mimeType: 'image/png',
        contentHash,
        extension: 'png',
        kind: 'image',
      })
      assert.equal(stored.provider, 'ipfs')
      assert.equal(stored.durability, 'durable')
      assert.equal(stored.portable, true)
      assert.equal(stored.verified, true)
      assert.ok(stored.uri.startsWith('ipfs://'))
      const cid = stored.uri.slice('ipfs://'.length)
      assert.equal(
        cidAddressesDigest(cid, contentHash.replace('sha256:', '')),
        true,
      )
    } finally {
      await node.close()
    }
  })

  it('fails verification when the node returns a cid for other content', async () => {
    const node = await startFakeIpfsNode({ wrongCid: true })
    try {
      const provider = new IpfsStorageProvider({ apiUrl: node.url })
      const data = new Uint8Array(buildPng(16, 16))
      await assert.rejects(
        () =>
          provider.putObject({
            data,
            mimeType: 'image/png',
            contentHash: sha256ContentHash(data),
            extension: 'png',
            kind: 'image',
          }),
        (error: unknown) =>
          error instanceof AssetServiceError &&
          error.code === 'storage-verification-failed',
      )
    } finally {
      await node.close()
    }
  })

  it('fails verification when the content is not pinned', async () => {
    const node = await startFakeIpfsNode({ unpinned: true })
    try {
      const provider = new IpfsStorageProvider({ apiUrl: node.url })
      const data = new Uint8Array(buildPng(16, 16))
      await assert.rejects(
        () =>
          provider.putObject({
            data,
            mimeType: 'image/png',
            contentHash: sha256ContentHash(data),
            extension: 'png',
            kind: 'image',
          }),
        (error: unknown) =>
          error instanceof AssetServiceError &&
          error.code === 'storage-verification-failed' &&
          error.message.includes('pinned'),
      )
    } finally {
      await node.close()
    }
  })

  it('fails verification when the node returns different bytes', async () => {
    const node = await startFakeIpfsNode({ corruptContent: true })
    try {
      const provider = new IpfsStorageProvider({ apiUrl: node.url })
      const data = new Uint8Array(buildPng(16, 16))
      await assert.rejects(
        () =>
          provider.putObject({
            data,
            mimeType: 'image/png',
            contentHash: sha256ContentHash(data),
            extension: 'png',
            kind: 'image',
          }),
        (error: unknown) =>
          error instanceof AssetServiceError &&
          error.code === 'storage-verification-failed' &&
          error.message.includes('different bytes'),
      )
    } finally {
      await node.close()
    }
  })

  it('sends the configured credentials to the node and never in the response', async () => {
    const node = await startFakeIpfsNode()
    try {
      const provider = new IpfsStorageProvider({
        apiUrl: node.url,
        auth: { type: 'bearer', token: 'super-secret-token' },
      })
      const data = new Uint8Array(buildPng(16, 16))
      const stored = await provider.putObject({
        data,
        mimeType: 'image/png',
        contentHash: sha256ContentHash(data),
        extension: 'png',
        kind: 'image',
      })
      assert.equal(node.authorizations.length > 0, true)
      assert.equal(node.authorizations.every((value) => value === 'Bearer super-secret-token'), true)
      assert.equal(JSON.stringify(stored).includes('super-secret-token'), false)
    } finally {
      await node.close()
    }
  })

  it('reports a storage failure when the node cannot be reached', async () => {
    const provider = new IpfsStorageProvider({
      apiUrl: 'http://127.0.0.1:1',
      requestTimeoutMs: 2_000,
    })
    const data = new Uint8Array(buildPng(16, 16))
    await assert.rejects(
      () =>
        provider.putObject({
          data,
          mimeType: 'image/png',
          contentHash: sha256ContentHash(data),
          extension: 'png',
          kind: 'image',
        }),
      (error: unknown) => error instanceof AssetServiceError && error.code === 'storage-failure',
    )
  })
})

describe('ipfs add response parsing', () => {
  it('reads the content identifier from the newline delimited response', () => {
    const body = '{"Name":"file","Hash":"bafyone","Size":"10"}\n'
    assert.equal(parseCidFromAddResponse(body), 'bafyone')
  })

  it('returns undefined for an unparsable response', () => {
    assert.equal(parseCidFromAddResponse('not json'), undefined)
    assert.equal(parseCidFromAddResponse(''), undefined)
  })
})
