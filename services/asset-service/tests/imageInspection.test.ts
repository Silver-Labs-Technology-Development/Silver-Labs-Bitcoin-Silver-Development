import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { AssetServiceError } from '../src/errors.js'
import {
  assertDeclaredMimeTypeMatches,
  detectImageFormat,
  inspectImage,
} from '../src/imageInspection.js'
import {
  buildDisguisedText,
  buildGif,
  buildJpeg,
  buildLossyWebp,
  buildNonImage,
  buildPng,
  buildPngWithBrokenChunkCrc,
  buildPngWithGarbageBody,
  buildWebp,
} from './helpers/imageFixtures.js'

describe('image signature detection', () => {
  it('detects every supported format from the file signature alone', () => {
    assert.equal(detectImageFormat(buildPng()), 'png')
    assert.equal(detectImageFormat(buildJpeg()), 'jpeg')
    assert.equal(detectImageFormat(buildGif()), 'gif')
    assert.equal(detectImageFormat(buildWebp()), 'webp')
    assert.equal(detectImageFormat(buildLossyWebp()), 'webp')
  })

  it('does not detect a format for bytes that are not an image', () => {
    assert.equal(detectImageFormat(buildNonImage()), undefined)
    assert.equal(detectImageFormat(buildDisguisedText()), undefined)
    assert.equal(detectImageFormat(Buffer.alloc(0)), undefined)
  })
})

describe('image inspection', () => {
  it('reads png dimensions from the image header', () => {
    const inspected = inspectImage(buildPng(120, 60))
    assert.equal(inspected.format, 'png')
    assert.equal(inspected.mimeType, 'image/png')
    assert.equal(inspected.width, 120)
    assert.equal(inspected.height, 60)
    assert.ok(inspected.sizeBytes > 0)
  })

  it('reads jpeg dimensions from the start of frame segment', () => {
    const inspected = inspectImage(buildJpeg(200, 100))
    assert.equal(inspected.format, 'jpeg')
    assert.equal(inspected.mimeType, 'image/jpeg')
    assert.equal(inspected.width, 200)
    assert.equal(inspected.height, 100)
  })

  it('reads gif dimensions from the logical screen descriptor', () => {
    const inspected = inspectImage(buildGif(64, 32))
    assert.equal(inspected.format, 'gif')
    assert.equal(inspected.mimeType, 'image/gif')
    assert.equal(inspected.width, 64)
    assert.equal(inspected.height, 32)
  })

  it('reads webp dimensions from the extended container', () => {
    const inspected = inspectImage(buildWebp(300, 150))
    assert.equal(inspected.format, 'webp')
    assert.equal(inspected.mimeType, 'image/webp')
    assert.equal(inspected.width, 300)
    assert.equal(inspected.height, 150)
  })

  it('reads webp dimensions from a lossy frame header', () => {
    const inspected = inspectImage(buildLossyWebp(48, 24))
    assert.equal(inspected.width, 48)
    assert.equal(inspected.height, 24)
  })

  it('rejects bytes that are not an image', () => {
    assert.throws(
      () => inspectImage(buildNonImage()),
      (error: unknown) =>
        error instanceof AssetServiceError && error.code === 'invalid-image',
    )
  })

  it('rejects a png whose chunk CRC does not match', () => {
    assert.throws(
      () => inspectImage(buildPngWithBrokenChunkCrc()),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'invalid-image' &&
        error.message.includes('CRC'),
    )
  })

  it('rejects a png whose body is not a valid chunk stream', () => {
    assert.throws(
      () => inspectImage(buildPngWithGarbageBody()),
      (error: unknown) => error instanceof AssetServiceError && error.code === 'invalid-image',
    )
  })

  it('rejects a truncated png', () => {
    const truncated = buildPng().subarray(0, 20)
    assert.throws(
      () => inspectImage(truncated),
      (error: unknown) => error instanceof AssetServiceError && error.code === 'invalid-image',
    )
  })
})

describe('declared mime type handling', () => {
  it('accepts a matching declared type', () => {
    assert.doesNotThrow(() => assertDeclaredMimeTypeMatches('image/png', 'image/png'))
    assert.doesNotThrow(() => assertDeclaredMimeTypeMatches('image/png', 'image/png; charset=binary'))
    assert.doesNotThrow(() => assertDeclaredMimeTypeMatches('image/jpeg', 'image/jpg'))
  })

  it('accepts a missing or generic declared type', () => {
    assert.doesNotThrow(() => assertDeclaredMimeTypeMatches('image/png', undefined))
    assert.doesNotThrow(() => assertDeclaredMimeTypeMatches('image/png', 'application/octet-stream'))
  })

  it('rejects a declared type that contradicts the detected type', () => {
    assert.throws(
      () => assertDeclaredMimeTypeMatches('image/png', 'image/gif'),
      (error: unknown) =>
        error instanceof AssetServiceError &&
        error.code === 'content-type-mismatch' &&
        error.details.detectedMimeType === 'image/png',
    )
  })
})
