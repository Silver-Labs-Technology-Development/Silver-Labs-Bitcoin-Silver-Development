/**
 * Byte level image fixtures used by the asset service tests.
 *
 * The fixtures build structurally valid container files for every supported
 * format so the tests can exercise the real inspection code path.
 */

import { deflateSync } from 'node:zlib'

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

function pngChunk(type: string, data: Buffer): Buffer<ArrayBuffer> {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const typeBuffer = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0)
  return Buffer.concat([length, typeBuffer, data, crc])
}

/** A structurally valid PNG with the requested dimensions. */
export function buildPng(width = 32, height = 16): Buffer<ArrayBuffer> {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  const scanlines = Buffer.alloc(height * (1 + width * 4))
  const imageData = deflateSync(scanlines)
  return Buffer.concat([
    signature,
    pngChunk('IHDR', header),
    pngChunk('IDAT', imageData),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** A PNG whose IHDR chunk CRC has been corrupted. */
export function buildPngWithBrokenChunkCrc(width = 32, height = 16): Buffer<ArrayBuffer> {
  const corrupted = Buffer.from(buildPng(width, height))
  // The IHDR chunk starts at offset 8: length(4) + type(4) + data(13) + crc(4).
  corrupted.writeUInt32BE(0xdeadbeef, 8 + 4 + 4 + 13)
  return corrupted
}

/** A PNG header followed by garbage instead of a valid chunk stream. */
export function buildPngWithGarbageBody(width = 32, height = 16): Buffer<ArrayBuffer> {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([signature, pngChunk('IHDR', header), Buffer.alloc(64, 0x41)])
}

/** A structurally valid JPEG with the requested dimensions. */
export function buildJpeg(width = 24, height = 12): Buffer<ArrayBuffer> {
  const soi = Buffer.from([0xff, 0xd8])
  const jfifPayload = Buffer.concat([
    Buffer.from('JFIF\0', 'ascii'),
    Buffer.from([0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  ])
  const app0 = jpegSegment(0xe0, jfifPayload)
  const framePayload = Buffer.alloc(15)
  framePayload[0] = 8
  framePayload.writeUInt16BE(height, 1)
  framePayload.writeUInt16BE(width, 3)
  framePayload[5] = 3
  framePayload[6] = 1
  framePayload[7] = 0x22
  framePayload[8] = 0
  framePayload[9] = 2
  framePayload[10] = 0x11
  framePayload[11] = 1
  framePayload[12] = 3
  framePayload[13] = 0x11
  framePayload[14] = 1
  const sof0 = jpegSegment(0xc0, framePayload)
  const scanPayload = Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
  const sos = jpegSegment(0xda, scanPayload)
  const entropy = Buffer.from([0x12, 0x34, 0x56])
  const eoi = Buffer.from([0xff, 0xd9])
  return Buffer.concat([soi, app0, sof0, sos, entropy, eoi])
}

function jpegSegment(marker: number, payload: Buffer): Buffer<ArrayBuffer> {
  const header = Buffer.alloc(4)
  header[0] = 0xff
  header[1] = marker
  header.writeUInt16BE(payload.length + 2, 2)
  return Buffer.concat([header, payload])
}

/** A structurally valid GIF with the requested dimensions. */
export function buildGif(width = 20, height = 10): Buffer<ArrayBuffer> {
  const header = Buffer.from('GIF89a', 'ascii')
  const descriptor = Buffer.alloc(7)
  descriptor.writeUInt16LE(width, 0)
  descriptor.writeUInt16LE(height, 2)
  return Buffer.concat([header, descriptor, Buffer.from([0x3b])])
}

/** A structurally valid WebP (extended container) with the requested dimensions. */
export function buildWebp(width = 40, height = 20): Buffer<ArrayBuffer> {
  const payload = Buffer.alloc(10)
  payload.writeUIntLE(width - 1, 4, 3)
  payload.writeUIntLE(height - 1, 7, 3)
  const chunk = Buffer.concat([Buffer.from('VP8X', 'ascii'), u32le(10), payload])
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), chunk])
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), u32le(body.length), body])
}

/** A structurally valid lossy WebP with the requested dimensions. */
export function buildLossyWebp(width = 40, height = 20): Buffer<ArrayBuffer> {
  const payload = Buffer.alloc(10)
  payload[3] = 0x9d
  payload[4] = 0x01
  payload[5] = 0x2a
  payload.writeUInt16LE(width, 6)
  payload.writeUInt16LE(height, 8)
  const chunk = Buffer.concat([Buffer.from('VP8 ', 'ascii'), u32le(10), payload])
  const body = Buffer.concat([Buffer.from('WEBP', 'ascii'), chunk])
  return Buffer.concat([Buffer.from('RIFF', 'ascii'), u32le(body.length), body])
}

function u32le(value: number): Buffer<ArrayBuffer> {
  const buffer = Buffer.alloc(4)
  buffer.writeUInt32LE(value, 0)
  return buffer
}

/** Bytes that are not an image at all. */
export function buildNonImage(): Buffer<ArrayBuffer> {
  return Buffer.from('<html><body>not an image</body></html>', 'utf8')
}

/** Bytes that claim to be a PNG in the browser but are not. */
export function buildDisguisedText(): Buffer<ArrayBuffer> {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    Buffer.from('this is plain text pretending to be a png', 'utf8'),
  ])
}
