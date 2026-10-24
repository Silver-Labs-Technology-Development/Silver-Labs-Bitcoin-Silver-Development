/**
 * Server-side image inspection.
 *
 * The service never trusts the MIME type or file name supplied by the browser.
 * The format is derived from the leading file signature, the file structure is
 * validated, and the pixel dimensions are read from the format's own header.
 *
 * Validation is structural: the service verifies signatures, container
 * structure and headers. Pixel data is not decoded, so a structurally valid
 * but visually broken image can still pass. This limit is documented in
 * `docs/BSNA-ASSET-UPLOAD-API.md`.
 */

import { AssetServiceError } from './errors.js'
import type { SupportedImageFormat } from './types.js'

export type InspectedImage = {
  format: SupportedImageFormat
  mimeType: string
  width: number
  height: number
  sizeBytes: number
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const GIF87A = 'GIF87a'
const GIF89A = 'GIF89a'

/** JPEG start-of-frame markers that carry the frame dimensions. */
const JPEG_SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xcf,
])

const MIME_TYPE_BY_FORMAT: Readonly<Record<SupportedImageFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

const EXTENSION_BY_FORMAT: Readonly<Record<SupportedImageFormat, string>> = {
  png: 'png',
  jpeg: 'jpg',
  gif: 'gif',
  webp: 'webp',
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** MIME type for a supported image format. */
export function mimeTypeForFormat(format: SupportedImageFormat): string {
  return MIME_TYPE_BY_FORMAT[format]
}

/** File extension for a supported image format. */
export function extensionForFormat(format: SupportedImageFormat): string {
  return EXTENSION_BY_FORMAT[format]
}

/** True when the bytes start with a known image signature. */
export function hasImageSignature(data: Uint8Array): boolean {
  return detectImageFormat(data) !== undefined
}

/**
 * Detect the image format from the file signature only.
 *
 * Returns `undefined` when the bytes do not start with a supported image
 * signature.
 */
export function detectImageFormat(data: Uint8Array): SupportedImageFormat | undefined {
  if (data.length >= 8 && Buffer.from(data.subarray(0, 8)).equals(PNG_SIGNATURE)) return 'png'
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'jpeg'
  if (data.length >= 6) {
    const header = Buffer.from(data.subarray(0, 6)).toString('ascii')
    if (header === GIF87A || header === GIF89A) return 'gif'
  }
  if (
    data.length >= 12 &&
    Buffer.from(data.subarray(0, 4)).toString('ascii') === 'RIFF' &&
    Buffer.from(data.subarray(8, 12)).toString('ascii') === 'WEBP'
  ) {
    return 'webp'
  }
  return undefined
}

/**
 * Validate the bytes as an image and read their dimensions.
 *
 * Throws an {@link AssetServiceError} with code `invalid-image` when the bytes
 * are not a structurally valid image of the detected format.
 */
export function inspectImage(data: Uint8Array): InspectedImage {
  const format = detectImageFormat(data)
  if (format === undefined) {
    throw AssetServiceError.invalidImage(
      'the uploaded bytes do not start with a supported image signature (png, jpeg, gif, webp)',
      { supportedFormats: ['png', 'jpeg', 'gif', 'webp'] },
    )
  }
  const dimensions = readDimensions(format, data)
  return {
    format,
    mimeType: MIME_TYPE_BY_FORMAT[format],
    width: dimensions.width,
    height: dimensions.height,
    sizeBytes: data.byteLength,
  }
}

function readDimensions(format: SupportedImageFormat, data: Uint8Array): { width: number; height: number } {
  switch (format) {
    case 'png':
      return readPngDimensions(data)
    case 'jpeg':
      return readJpegDimensions(data)
    case 'gif':
      return readGifDimensions(data)
    case 'webp':
      return readWebpDimensions(data)
  }
}

function readPngDimensions(data: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(data)
  let offset = PNG_SIGNATURE.length
  let sawHeader = false
  let sawImageData = false
  let dimensions: { width: number; height: number } | undefined

  while (offset < view.length) {
    if (offset + 8 > view.length) {
      throw AssetServiceError.invalidImage('the png chunk header is truncated', { format: 'png' })
    }
    const chunkLength = view.readUInt32BE(offset)
    const chunkType = view.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + chunkLength
    if (dataEnd + 4 > view.length) {
      throw AssetServiceError.invalidImage(`the png ${chunkType} chunk is truncated`, {
        format: 'png',
        chunkType,
      })
    }
    const declaredCrc = view.readUInt32BE(dataEnd)
    const computedCrc = crc32(view.subarray(offset + 4, dataEnd))
    if (declaredCrc !== computedCrc) {
      throw AssetServiceError.invalidImage(`the png ${chunkType} chunk failed its CRC check`, {
        format: 'png',
        chunkType,
      })
    }
    if (!sawHeader) {
      if (chunkType !== 'IHDR' || chunkLength !== 13) {
        throw AssetServiceError.invalidImage('the png does not start with a valid IHDR chunk', {
          format: 'png',
          chunkType,
        })
      }
      sawHeader = true
      dimensions = {
        width: view.readUInt32BE(dataStart),
        height: view.readUInt32BE(dataStart + 4),
      }
    }
    if (chunkType === 'IDAT') sawImageData = true
    if (chunkType === 'IEND') {
      if (dataEnd + 4 !== view.length) {
        throw AssetServiceError.invalidImage('the png has trailing bytes after its IEND chunk', {
          format: 'png',
        })
      }
      if (!sawImageData) {
        throw AssetServiceError.invalidImage('the png contains no image data chunk', { format: 'png' })
      }
      if (dimensions === undefined) {
        throw AssetServiceError.invalidImage('the png has no image header', { format: 'png' })
      }
      return dimensions
    }
    offset = dataEnd + 4
  }
  throw AssetServiceError.invalidImage('the png is missing its IEND chunk', { format: 'png' })
}

function readJpegDimensions(data: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(data)
  let offset = 2
  let dimensions: { width: number; height: number } | undefined
  let sawEndOfImage = false

  while (offset < view.length) {
    if (view[offset] !== 0xff) {
      throw AssetServiceError.invalidImage('the jpeg marker stream is malformed', { format: 'jpeg' })
    }
    let markerOffset = offset + 1
    while (markerOffset < view.length && view[markerOffset] === 0xff) markerOffset += 1
    if (markerOffset >= view.length) {
      throw AssetServiceError.invalidImage('the jpeg ends with a truncated marker', { format: 'jpeg' })
    }
    const marker = view[markerOffset]
    if (marker === 0xd9) {
      sawEndOfImage = true
      break
    }
    if (marker === 0xda) {
      // Start of scan: entropy coded data follows and is not marker aligned.
      const endOfImage = findLastMarker(view, 0xff, 0xd9)
      if (endOfImage < 0) {
        throw AssetServiceError.invalidImage('the jpeg has no end-of-image marker', { format: 'jpeg' })
      }
      sawEndOfImage = true
      break
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset = markerOffset + 1
      continue
    }
    if (markerOffset + 4 > view.length) {
      throw AssetServiceError.invalidImage('the jpeg segment length is truncated', { format: 'jpeg' })
    }
    const segmentLength = view.readUInt16BE(markerOffset + 1)
    if (segmentLength < 2) {
      throw AssetServiceError.invalidImage('the jpeg segment length is invalid', { format: 'jpeg' })
    }
    const segmentStart = markerOffset + 3
    if (segmentStart + segmentLength - 2 > view.length) {
      throw AssetServiceError.invalidImage('the jpeg segment payload is truncated', { format: 'jpeg' })
    }
    if (JPEG_SOF_MARKERS.has(marker)) {
      if (segmentLength < 8) {
        throw AssetServiceError.invalidImage('the jpeg frame header is too short', { format: 'jpeg' })
      }
      dimensions = {
        height: view.readUInt16BE(segmentStart + 1),
        width: view.readUInt16BE(segmentStart + 3),
      }
    }
    offset = segmentStart + segmentLength - 2
  }

  if (!sawEndOfImage) {
    throw AssetServiceError.invalidImage('the jpeg has no end-of-image marker', { format: 'jpeg' })
  }
  if (dimensions === undefined) {
    throw AssetServiceError.invalidImage('the jpeg has no start-of-frame header', { format: 'jpeg' })
  }
  return dimensions
}

function findLastMarker(view: Buffer, first: number, second: number): number {
  for (let index = view.length - 2; index >= 0; index -= 1) {
    if (view[index] === first && view[index + 1] === second) return index
  }
  return -1
}

function readGifDimensions(data: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(data)
  if (view.length < 14) {
    throw AssetServiceError.invalidImage('the gif is too short to contain a screen descriptor', {
      format: 'gif',
    })
  }
  if (view[view.length - 1] !== 0x3b) {
    throw AssetServiceError.invalidImage('the gif is missing its trailer byte', { format: 'gif' })
  }
  return {
    width: view.readUInt16LE(6),
    height: view.readUInt16LE(8),
  }
}

function readWebpDimensions(data: Uint8Array): { width: number; height: number } {
  const view = Buffer.from(data)
  const declaredSize = view.readUInt32LE(4)
  if (declaredSize + 8 !== view.length) {
    throw AssetServiceError.invalidImage('the webp RIFF size does not match the file length', {
      format: 'webp',
      declaredSize,
      actualSize: view.length - 8,
    })
  }
  let offset = 12
  let canvas: { width: number; height: number } | undefined
  let frame: { width: number; height: number } | undefined

  while (offset + 8 <= view.length) {
    const chunkType = view.toString('ascii', offset, offset + 4)
    const chunkSize = view.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkStart + chunkSize > view.length) {
      throw AssetServiceError.invalidImage(`the webp ${chunkType} chunk is truncated`, {
        format: 'webp',
        chunkType,
      })
    }
    if (chunkType === 'VP8X') {
      if (chunkSize < 10) {
        throw AssetServiceError.invalidImage('the webp VP8X chunk is too short', { format: 'webp' })
      }
      canvas = {
        width: (view[chunkStart + 4] | (view[chunkStart + 5] << 8) | (view[chunkStart + 6] << 16)) + 1,
        height: (view[chunkStart + 7] | (view[chunkStart + 8] << 8) | (view[chunkStart + 9] << 16)) + 1,
      }
    } else if (chunkType === 'VP8 ') {
      if (chunkSize < 10) {
        throw AssetServiceError.invalidImage('the webp VP8 chunk is too short', { format: 'webp' })
      }
      if (view[chunkStart + 3] !== 0x9d || view[chunkStart + 4] !== 0x01 || view[chunkStart + 5] !== 0x2a) {
        throw AssetServiceError.invalidImage('the webp VP8 frame header is invalid', { format: 'webp' })
      }
      frame = {
        width: view.readUInt16LE(chunkStart + 6) & 0x3fff,
        height: view.readUInt16LE(chunkStart + 8) & 0x3fff,
      }
    } else if (chunkType === 'VP8L') {
      if (chunkSize < 5) {
        throw AssetServiceError.invalidImage('the webp VP8L chunk is too short', { format: 'webp' })
      }
      if (view[chunkStart] !== 0x2f) {
        throw AssetServiceError.invalidImage('the webp VP8L signature byte is invalid', {
          format: 'webp',
        })
      }
      const bits = view.readUInt32LE(chunkStart + 1)
      frame = {
        width: (bits & 0x3fff) + 1,
        height: ((bits >>> 14) & 0x3fff) + 1,
      }
    }
    offset = chunkStart + chunkSize + (chunkSize % 2)
  }

  const dimensions = canvas ?? frame
  if (dimensions === undefined) {
    throw AssetServiceError.invalidImage('the webp has no dimension-bearing chunk', { format: 'webp' })
  }
  return dimensions
}

/**
 * Check that a client supplied MIME type agrees with the detected format.
 *
 * A missing or generic `application/octet-stream` declaration is tolerated:
 * the detected type always wins. Any other mismatch is rejected.
 */
export function assertDeclaredMimeTypeMatches(
  detectedMimeType: string,
  declaredMimeType: string | undefined,
): void {
  if (declaredMimeType === undefined) return
  const declared = declaredMimeType.trim().toLowerCase().split(';')[0]?.trim() ?? ''
  if (declared === '' || declared === 'application/octet-stream') return
  if (declared === detectedMimeType) return
  if (declared === 'image/jpg' && detectedMimeType === 'image/jpeg') return
  throw AssetServiceError.contentTypeMismatch(
    `the declared content type "${declared}" does not match the detected image type "${detectedMimeType}"`,
    { declaredMimeType: declared, detectedMimeType },
  )
}
