import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import solc from 'solc'
import { hexToBytes } from '@ethereumjs/util'
import { AssetEngineError } from './errors.js'
import { normalizeAddress } from './networks.js'

const SOURCE_PATH = new URL('../../contracts/EvmFungibleAsset.sol', import.meta.url)
const CONTRACT_NAME = 'EvmFungibleAsset'

const STANDARD_SELECTORS: Record<string, string> = {
  'name()': '06fdde03',
  'symbol()': '95d89b41',
  'decimals()': '313ce567',
  'totalSupply()': '18160ddd',
  'balanceOf(address)': '70a08231',
  'transfer(address,uint256)': 'a9059cbb',
  'approve(address,uint256)': '095ea7b3',
  'transferFrom(address,address,uint256)': '23b872dd',
  'allowance(address,address)': 'dd62ed3e',
  'owner()': '8da5cb5b',
}

export type CompiledFungible = {
  abi: unknown[]
  creationBytecode: Uint8Array
  creationBytecodeSha256: string
  methodIdentifiers: Record<string, string>
  sourceSha256: string
  compilerVersion: string
  evmVersion: 'london'
}

export type FungibleConstructor = {
  name: string
  symbol: string
  decimals: number
  atomicSupply: bigint
  owner: string
}

let compiledCache: CompiledFungible | undefined

export function compileFungibleAsset(): CompiledFungible {
  if (compiledCache !== undefined) return compiledCache
  const source = readFileSync(SOURCE_PATH, 'utf8')
  const input = {
    language: 'Solidity',
    sources: { 'EvmFungibleAsset.sol': { content: source } },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      evmVersion: 'london',
      metadata: { bytecodeHash: 'none', appendCBOR: false },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: Array<{ severity: string; formattedMessage: string }>
    contracts?: Record<string, Record<string, {
      abi: unknown[]
      evm: { bytecode: { object: string }; methodIdentifiers: Record<string, string> }
    }>>
  }
  const errors = output.errors?.filter((error) => error.severity === 'error') ?? []
  if (errors.length > 0) {
    throw new AssetEngineError(errors.map((error) => error.formattedMessage).join('\n'))
  }
  const contract = output.contracts?.['EvmFungibleAsset.sol']?.[CONTRACT_NAME]
  const bytecode = contract?.evm.bytecode.object
  if (contract === undefined || bytecode === undefined || bytecode.length === 0) {
    throw new AssetEngineError('Solidity compiler did not produce EvmFungibleAsset bytecode')
  }
  for (const [signature, selector] of Object.entries(STANDARD_SELECTORS)) {
    if (contract.evm.methodIdentifiers[signature] !== selector) {
      throw new AssetEngineError(`${signature} selector drifted from the ERC-20/BEP-20 interface`)
    }
  }
  for (const signature of Object.keys(contract.evm.methodIdentifiers)) {
    if (signature.startsWith('mint(') || signature.startsWith('burn(')) {
      throw new AssetEngineError('the shared template has no mint or burn function')
    }
  }
  const creationBytecode = hexToBytes(`0x${bytecode}`)
  compiledCache = {
    abi: contract.abi,
    creationBytecode,
    creationBytecodeSha256: createHash('sha256').update(creationBytecode).digest('hex'),
    methodIdentifiers: contract.evm.methodIdentifiers,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    compilerVersion: solc.version(),
    evmVersion: 'london',
  }
  return compiledCache
}

export function creationCalldata(compiled: CompiledFungible, args: FungibleConstructor): Uint8Array {
  if (args.name.trim() === '' || args.symbol.trim() === '') {
    throw new AssetEngineError('token name and symbol are required')
  }
  if (!Number.isInteger(args.decimals) || args.decimals < 0 || args.decimals > 255) {
    throw new AssetEngineError('decimals must be an integer from 0 through 255')
  }
  if (args.atomicSupply < 0n || args.atomicSupply >= 1n << 256n) {
    throw new AssetEngineError('atomic supply must fit in uint256')
  }
  const owner = normalizeAddress(args.owner)
  const nameTail = encodeDynamicBytes(new TextEncoder().encode(args.name))
  const symbolTail = encodeDynamicBytes(new TextEncoder().encode(args.symbol))
  const headWords = 5
  const nameOffset = headWords * 32
  const symbolOffset = nameOffset + nameTail.length
  return concatBytes([
    compiled.creationBytecode,
    encodeUint(BigInt(nameOffset)),
    encodeUint(BigInt(symbolOffset)),
    encodeUint(BigInt(args.decimals)),
    encodeUint(args.atomicSupply),
    encodeAddress(owner),
    nameTail,
    symbolTail,
  ])
}

export function encodeCall(compiled: CompiledFungible, signature: string, words: readonly Uint8Array[]): Uint8Array {
  const identifier = compiled.methodIdentifiers[signature]
  if (identifier === undefined) throw new AssetEngineError(`missing selector ${signature}`)
  return concatBytes([hexToBytes(`0x${identifier}`), ...words])
}

export function encodeAddressWord(address: string): Uint8Array {
  return encodeAddress(normalizeAddress(address))
}

export function encodeUintWord(value: bigint): Uint8Array {
  return encodeUint(value)
}

export function decodeUint(data: string): bigint {
  const bytes = hexToBytes(asHex(data))
  if (bytes.length < 32) throw new AssetEngineError('ABI word is short')
  return readUint(bytes, 0)
}

export function decodeAddress(data: string): string {
  const bytes = hexToBytes(asHex(data))
  if (bytes.length < 32) throw new AssetEngineError('ABI address is short')
  return `0x${Buffer.from(bytes.subarray(12, 32)).toString('hex')}`
}

export function decodeString(data: string): string {
  const bytes = hexToBytes(asHex(data))
  if (bytes.length < 64) throw new AssetEngineError('ABI string is short')
  const offset = Number(readUint(bytes, 0))
  if (!Number.isInteger(offset) || offset < 0 || offset + 32 > bytes.length) {
    throw new AssetEngineError('ABI string offset is invalid')
  }
  const length = Number(readUint(bytes, offset))
  const start = offset + 32
  if (!Number.isInteger(length) || length < 0 || start + length > bytes.length) {
    throw new AssetEngineError('ABI string length is invalid')
  }
  return new TextDecoder().decode(bytes.subarray(start, start + length))
}

function encodeDynamicBytes(data: Uint8Array): Uint8Array {
  const words = Math.ceil(data.length / 32)
  const out = new Uint8Array(32 + words * 32)
  out.set(encodeUint(BigInt(data.length)), 0)
  out.set(data, 32)
  return out
}

function encodeUint(value: bigint): Uint8Array {
  if (value < 0n || value >= 1n << 256n) throw new AssetEngineError('uint256 overflow')
  return hexToBytes(`0x${value.toString(16).padStart(64, '0')}`)
}

function encodeAddress(address: string): Uint8Array {
  const padded = new Uint8Array(32)
  padded.set(hexToBytes(address as `0x${string}`), 12)
  return padded
}

function readUint(bytes: Uint8Array, offset: number): bigint {
  return BigInt(`0x${Buffer.from(bytes.subarray(offset, offset + 32)).toString('hex')}`)
}

function asHex(data: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]*$/.test(data) || data.length % 2 !== 0) {
    throw new AssetEngineError('ABI data is not hex')
  }
  return data as `0x${string}`
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
