/**
 * Minimal CID decoding used to verify that an IPFS URI is content addressed by
 * the same SHA-256 digest the service computed for the uploaded bytes.
 *
 * Only CIDv1 with a `sha2-256` multihash is accepted, because that is the only
 * shape the service produces and the only shape it can compare against.
 */

import { AssetServiceError } from '../errors.js'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'
const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

export type DecodedCid = {
  version: number
  codec: number
  multihashCode: number
  digestHex: string
}

export const SHA2_256_MULTIHASH_CODE = 0x12

function decodeBase32(value: string): Uint8Array {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0
  for (const character of value) {
    const index = BASE32_ALPHABET.indexOf(character)
    if (index < 0) {
      throw AssetServiceError.storageVerificationFailed('the ipfs cid is not valid base32', { cid: value })
    }
    buffer = (buffer << 5) | index
    bits += 5
    if (bits >= 8) {
      bits -= 8
      bytes.push((buffer >>> bits) & 0xff)
    }
  }
  return Uint8Array.from(bytes)
}

function decodeBase58(value: string): Uint8Array {
  const bytes: number[] = [0]
  for (const character of value) {
    const index = BASE58_ALPHABET.indexOf(character)
    if (index < 0) {
      throw AssetServiceError.storageVerificationFailed('the ipfs cid is not valid base58', { cid: value })
    }
    let carry = index
    for (let position = 0; position < bytes.length; position += 1) {
      carry += bytes[position] * 58
      bytes[position] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }
  const leadingZeroes = value.split('').filter((character) => character === '1').length
  const body = Uint8Array.from(bytes.reverse())
  const result = new Uint8Array(leadingZeroes + body.length)
  result.set(body, leadingZeroes)
  return result
}

function readVarint(bytes: Uint8Array, offset: number): { value: number; size: number } {
  let value = 0
  let shift = 1
  let index = offset
  while (index < bytes.length) {
    const byte = bytes[index] as number
    value += (byte & 0x7f) * shift
    index += 1
    if ((byte & 0x80) === 0) return { value, size: index - offset }
    shift *= 128
    if (shift > Number.MAX_SAFE_INTEGER) break
  }
  throw AssetServiceError.storageVerificationFailed('the ipfs cid contains a malformed varint', { cid: '' })
}

/**
 * Decode a CIDv1 string into its codec and multihash digest.
 *
 * Throws when the CID is not a CIDv1 with a sha2-256 multihash.
 */
export function decodeCidV1(cid: string): DecodedCid {
  const prefix = cid[0]
  let bytes: Uint8Array
  if (prefix === 'b') {
    bytes = decodeBase32(cid.slice(1))
  } else if (prefix === 'z') {
    bytes = decodeBase58(cid.slice(1))
  } else {
    throw AssetServiceError.storageVerificationFailed(
      'the ipfs cid uses an unsupported multibase prefix',
      { cid, prefix },
    )
  }

  const version = readVarint(bytes, 0)
  if (version.value !== 1) {
    throw AssetServiceError.storageVerificationFailed('the ipfs cid is not version 1', {
      cid,
      version: version.value,
    })
  }
  const codec = readVarint(bytes, version.size)
  const multihash = readVarint(bytes, version.size + codec.size)
  const digestLength = readVarint(bytes, version.size + codec.size + multihash.size)
  const digestStart = version.size + codec.size + multihash.size + digestLength.size
  const digest = bytes.subarray(digestStart, digestStart + digestLength.value)
  if (digest.length !== digestLength.value) {
    throw AssetServiceError.storageVerificationFailed('the ipfs cid digest is truncated', { cid })
  }
  return {
    version: version.value,
    codec: codec.value,
    multihashCode: multihash.value,
    digestHex: Buffer.from(digest).toString('hex'),
  }
}

/**
 * Verify that a CID addresses exactly the given SHA-256 digest.
 *
 * Returns true when the CID is a CIDv1 whose multihash is sha2-256 over the
 * same bytes the service uploaded.
 */
export function cidAddressesDigest(cid: string, expectedDigestHex: string): boolean {
  const decoded = decodeCidV1(cid)
  return decoded.multihashCode === SHA2_256_MULTIHASH_CODE && decoded.digestHex === expectedDigestHex
}
