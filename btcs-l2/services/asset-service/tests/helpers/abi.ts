/**
 * Minimal ABI encoder used by the contract integration test.
 *
 * Only the argument types the BSNA contracts need are supported: `address`,
 * `uint256`, `bool` and `string`.
 */

import { keccak_256 } from '@noble/hashes/sha3.js'

export type AbiArgument =
  | { type: 'address'; value: string }
  | { type: 'uint256'; value: bigint }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }

function word(value: bigint): Buffer {
  const buffer = Buffer.alloc(32)
  buffer.writeBigUInt64BE(value & 0xffffffffffffffffn, 24)
  return buffer
}

function addressWord(value: string): Buffer {
  const cleaned = value.replace(/^0x/, '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(cleaned)) {
    throw new Error(`invalid address: ${value}`)
  }
  const buffer = Buffer.alloc(32)
  Buffer.from(cleaned, 'hex').copy(buffer, 12)
  return buffer
}

function stringTail(value: string): Buffer {
  const data = Buffer.from(value, 'utf8')
  const padded = Buffer.alloc(Math.ceil(data.length / 32) * 32)
  data.copy(padded)
  return Buffer.concat([word(BigInt(data.length)), padded])
}

/** Encode a list of arguments using the standard head/tail ABI layout. */
export function encodeArguments(args: readonly AbiArgument[]): Buffer {
  const heads: Buffer[] = []
  const tails: Buffer[] = []
  let tailOffset = 32 * args.length
  for (const argument of args) {
    switch (argument.type) {
      case 'address':
        heads.push(addressWord(argument.value))
        break
      case 'uint256':
        heads.push(word(argument.value))
        break
      case 'bool':
        heads.push(word(argument.value ? 1n : 0n))
        break
      case 'string': {
        heads.push(word(BigInt(tailOffset)))
        const tail = stringTail(argument.value)
        tails.push(tail)
        tailOffset += tail.length
        break
      }
    }
  }
  return Buffer.concat([...heads, ...tails])
}

/** The four byte selector of a solidity function signature. */
export function functionSelector(signature: string): string {
  return Buffer.from(keccak_256(Buffer.from(signature, 'utf8'))).toString('hex').slice(0, 8)
}

/** Encode a call to a solidity function. */
export function encodeCall(signature: string, args: readonly AbiArgument[] = []): Buffer {
  const selector = Buffer.from(functionSelector(signature), 'hex')
  return Buffer.concat([selector, encodeArguments(args)])
}

/** keccak256 of the utf8 bytes of a string. */
export function keccak256OfString(value: string): string {
  return Buffer.from(keccak_256(Buffer.from(value, 'utf8'))).toString('hex')
}
