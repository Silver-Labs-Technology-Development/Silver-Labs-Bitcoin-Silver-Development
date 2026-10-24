import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { buildBsnaMetadata, metadataTargetForAssetKind, serializeMetadata } from '../src/metadata.js'

const BASE_INPUT = {
  bsnaVersion: '1.0',
  imageUri: 'http://127.0.0.1:8787/assets/objects/abc.png',
  contentHash: 'sha256:1111111111111111111111111111111111111111111111111111111111111111',
  mimeType: 'image/png',
  width: 512,
  height: 512,
}

describe('BSNA metadata generation', () => {
  it('emits exactly the field set declared by the BSNA standard proposal', () => {
    const metadata = buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna20-logo' })
    assert.deepEqual(Object.keys(metadata).sort(), [
      'attributes',
      'description',
      'external_url',
      'image',
      'name',
    ])
  })

  it('builds a BSNA-20 logo document', () => {
    const metadata = buildBsnaMetadata({
      ...BASE_INPUT,
      assetKind: 'bsna20-logo',
      name: 'Silver Coin',
      description: 'A test fungible asset',
      externalUrl: 'https://example.org/silver-coin',
      chainId: 31337,
      contractAddress: '0x1111111111111111111111111111111111111111',
    })
    assert.equal(metadata.name, 'Silver Coin')
    assert.equal(metadata.description, 'A test fungible asset')
    assert.equal(metadata.image, BASE_INPUT.imageUri)
    assert.equal(metadata.external_url, 'https://example.org/silver-coin')
    assert.equal(metadataTargetForAssetKind('bsna20-logo'), 'bsna20-metadata-uri')

    const attributes = new Map(metadata.attributes.map((entry) => [entry.trait_type, entry.value]))
    assert.equal(attributes.get('BSNA Profile'), 'BSNA-20')
    assert.equal(attributes.get('BSNA Version'), '1.0')
    assert.equal(attributes.get('Asset Type'), 'fungible')
    assert.equal(attributes.get('Chain ID'), '31337')
    assert.equal(
      attributes.get('Contract Address'),
      '0x1111111111111111111111111111111111111111',
    )
    assert.equal(attributes.get('Image Content Hash'), BASE_INPUT.contentHash)
    assert.equal(attributes.get('Image Media Type'), 'image/png')
    assert.equal(attributes.get('Image Dimensions'), '512x512')
    assert.equal(attributes.has('Token ID'), false)
  })

  it('builds a BSNA-721 collection document', () => {
    const metadata = buildBsnaMetadata({
      ...BASE_INPUT,
      assetKind: 'bsna721-collection-image',
      name: 'Silver Collection',
    })
    assert.equal(metadataTargetForAssetKind('bsna721-collection-image'), 'bsna721-collection-metadata-uri')
    const attributes = new Map(metadata.attributes.map((entry) => [entry.trait_type, entry.value]))
    assert.equal(attributes.get('BSNA Profile'), 'BSNA-721')
    assert.equal(attributes.get('Asset Type'), 'nonfungible')
  })

  it('builds an individual BSNA-721 token document', () => {
    const metadata = buildBsnaMetadata({
      ...BASE_INPUT,
      assetKind: 'bsna721-token-image',
      name: 'Silver Coin #7',
      tokenId: '7',
    })
    assert.equal(metadataTargetForAssetKind('bsna721-token-image'), 'bsna721-token-uri')
    const attributes = new Map(metadata.attributes.map((entry) => [entry.trait_type, entry.value]))
    assert.equal(attributes.get('Token ID'), '7')
    assert.equal(attributes.get('BSNA Profile'), 'BSNA-721')
    assert.equal(attributes.get('Asset Type'), 'nonfungible')
  })

  it('keeps caller supplied attributes ahead of the BSNA attributes', () => {
    const metadata = buildBsnaMetadata({
      ...BASE_INPUT,
      assetKind: 'bsna721-token-image',
      attributes: [
        { trait_type: 'Background', value: 'Silver' },
        { trait_type: 'Rarity', value: 'Common' },
      ],
    })
    assert.equal(metadata.attributes[0]?.trait_type, 'Background')
    assert.equal(metadata.attributes[1]?.trait_type, 'Rarity')
    assert.equal(metadata.attributes[2]?.trait_type, 'BSNA Profile')
  })

  it('falls back to a deterministic name when the caller supplies none', () => {
    assert.equal(
      buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna20-logo' }).name,
      'BSNA-20 token logo',
    )
    assert.equal(
      buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna721-collection-image' }).name,
      'BSNA-721 collection image',
    )
    assert.equal(
      buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna721-token-image' }).name,
      'BSNA-721 token image',
    )
  })

  it('defaults description and external_url to empty strings', () => {
    const metadata = buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna20-logo' })
    assert.equal(metadata.description, '')
    assert.equal(metadata.external_url, '')
  })
})

describe('metadata serialization', () => {
  it('serializes to canonical json with sorted keys', () => {
    const metadata = buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna20-logo' })
    const serialized = serializeMetadata(metadata)
    assert.equal(
      serialized,
      '{"attributes":[' +
        '{"trait_type":"BSNA Profile","value":"BSNA-20"},' +
        '{"trait_type":"BSNA Version","value":"1.0"},' +
        '{"trait_type":"Asset Type","value":"fungible"},' +
        '{"trait_type":"Image Content Hash","value":"' +
        BASE_INPUT.contentHash +
        '"},' +
        '{"trait_type":"Image Media Type","value":"image/png"},' +
        '{"trait_type":"Image Dimensions","value":"512x512"}' +
        '],"description":"","external_url":"","image":"' +
        BASE_INPUT.imageUri +
        '","name":"BSNA-20 token logo"}',
    )
  })

  it('is deterministic across repeated serializations', () => {
    const metadata = buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna721-token-image', tokenId: '3' })
    assert.equal(serializeMetadata(metadata), serializeMetadata(metadata))
  })

  it('changes when the image uri changes', () => {
    const first = serializeMetadata(buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna20-logo' }))
    const second = serializeMetadata(
      buildBsnaMetadata({ ...BASE_INPUT, assetKind: 'bsna20-logo', imageUri: 'http://other/asset.png' }),
    )
    assert.notEqual(first, second)
  })
})
