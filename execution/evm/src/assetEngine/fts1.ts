import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import solc from 'solc'
import { hexToBytes } from '@ethereumjs/util'
import { AssetEngineError } from './errors.js'
import { normalizeAddress } from './networks.js'

const SOURCE_PATH = new URL('../../../../contracts/token/BSNAFTS1.sol', import.meta.url)
const CONTRACT_NAME = 'BSNAFTS1'

/**
 * The ERC-20 selectors must not drift. BSNA-FTS1 keeps this surface so ordinary
 * EVM wallets can read balances even though the token also has BSNA rules.
 */
const REQUIRED_SELECTORS: Record<string, string> = {
  'name()': '06fdde03',
  'symbol()': '95d89b41',
  'decimals()': '313ce567',
  'totalSupply()': '18160ddd',
  'balanceOf(address)': '70a08231',
  'transfer(address,uint256)': 'a9059cbb',
  'approve(address,uint256)': '095ea7b3',
  'transferFrom(address,address,uint256)': '23b872dd',
  'allowance(address,address)': 'dd62ed3e',
}

export type CompiledFts1 = {
  abi: unknown[]
  creationBytecode: Uint8Array
  creationBytecodeSha256: string
  methodIdentifiers: Record<string, string>
  sourceSha256: string
  compilerVersion: string
  evmVersion: 'london'
}

export type Fts1Spec = {
  name: string
  symbol: string
  decimals: number
  /** Initial supply in atomic units. Never scaled by decimals. */
  atomicSupply: bigint
  /** Supply cap in atomic units. 0 means uncapped for AuthorizedMint. */
  maxSupply: bigint
  supplyPolicy: 'fixed' | 'authorized-mint'
  burnPolicy: 'disabled' | 'holder-burn'
  pausePolicy: 'disabled' | 'admin-pause'
  metadataMutable: boolean
  metadataUri: string
  /** sha256 of the raw metadata bytes, as an unsigned 256-bit integer. */
  metadataHash: bigint
  admin: string
  description?: string
  externalUrl?: string
  logoBytes?: Uint8Array
}

export const FTS1_POLICY_CODE = {
  supply: { fixed: 0, 'authorized-mint': 1 },
  burn: { disabled: 0, 'holder-burn': 1 },
  pause: { disabled: 0, 'admin-pause': 1 },
} as const

let compiledCache: CompiledFts1 | undefined

export function compileBsnaFts1(): CompiledFts1 {
  if (compiledCache !== undefined) return compiledCache
  const source = readFileSync(SOURCE_PATH, 'utf8')
  const input = {
    language: 'Solidity',
    sources: { 'BSNAFTS1.sol': { content: source } },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      // The standard's 12-argument constructor carries three dynamic strings.
      // The legacy pipeline reports stack-too-deep; viaIR compiles the same ABI
      // for the same London EVM target.
      viaIR: true,
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
  if (errors.length > 0) throw new AssetEngineError(errors.map((error) => error.formattedMessage).join('\n'))
  const contract = output.contracts?.['BSNAFTS1.sol']?.[CONTRACT_NAME]
  const bytecode = contract?.evm.bytecode.object
  if (contract === undefined || bytecode === undefined || bytecode.length === 0) {
    throw new AssetEngineError('Solidity compiler did not produce BSNAFTS1 bytecode')
  }
  for (const [signature, selector] of Object.entries(REQUIRED_SELECTORS)) {
    if (contract.evm.methodIdentifiers[signature] !== selector) {
      throw new AssetEngineError(`BSNA-FTS1 ${signature} selector drifted from the ERC-20 interface`)
    }
  }
  for (const signature of ['bsnaStandard()', 'bsnaVersion()', 'mint(address,uint256)', 'burn(uint256)']) {
    if (contract.evm.methodIdentifiers[signature] === undefined) {
      throw new AssetEngineError(`BSNA-FTS1 is missing ${signature}`)
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

export function fts1CreationCalldata(compiled: CompiledFts1, spec: Fts1Spec): Uint8Array {
  validateFts1Spec(spec)
  const nameTail = encodeDynamicBytes(new TextEncoder().encode(spec.name))
  const symbolTail = encodeDynamicBytes(new TextEncoder().encode(spec.symbol))
  const metadataTail = encodeDynamicBytes(new TextEncoder().encode(spec.metadataUri))

  // 12 head words: name, symbol, decimals, initialSupply, maxSupply,
  // supplyPolicy, burnPolicy, pausePolicy, metadataMutable, metadataURI,
  // metadataHash, initialAdmin.
  const headWords = 12
  const nameOffset = headWords * 32
  const symbolOffset = nameOffset + nameTail.length
  const metadataOffset = symbolOffset + symbolTail.length

  return concatBytes([
    compiled.creationBytecode,
    encodeUint(BigInt(nameOffset)),
    encodeUint(BigInt(symbolOffset)),
    encodeUint(BigInt(spec.decimals)),
    encodeUint(spec.atomicSupply),
    encodeUint(spec.maxSupply),
    encodeUint(BigInt(FTS1_POLICY_CODE.supply[spec.supplyPolicy])),
    encodeUint(BigInt(FTS1_POLICY_CODE.burn[spec.burnPolicy])),
    encodeUint(BigInt(FTS1_POLICY_CODE.pause[spec.pausePolicy])),
    encodeUint(spec.metadataMutable ? 1n : 0n),
    encodeUint(BigInt(metadataOffset)),
    encodeUint(spec.metadataHash),
    encodeAddress(normalizeAddress(spec.admin)),
    nameTail,
    symbolTail,
    metadataTail,
  ])
}

/** Validate the same rules the constructor enforces, before signing anything. */
export function validateFts1Spec(spec: Fts1Spec): void {
  const nameLength = new TextEncoder().encode(spec.name).length
  const symbolLength = new TextEncoder().encode(spec.symbol).length
  if (nameLength === 0 || symbolLength === 0) throw new AssetEngineError('token name and symbol are required')
  if (nameLength > 64 || symbolLength > 64) {
    throw new AssetEngineError('BSNA-FTS1 name and symbol must be at most 64 UTF-8 bytes')
  }
  if (!Number.isInteger(spec.decimals) || spec.decimals < 0 || spec.decimals > 18) {
    throw new AssetEngineError('BSNA-FTS1 decimals must be an integer from 0 through 18')
  }
  if (spec.atomicSupply < 0n || spec.atomicSupply >= 1n << 256n) {
    throw new AssetEngineError('initial supply must fit in uint256')
  }
  if (spec.maxSupply < 0n || spec.maxSupply >= 1n << 256n) {
    throw new AssetEngineError('max supply must fit in uint256')
  }
  if (spec.supplyPolicy === 'fixed' && spec.maxSupply !== spec.atomicSupply) {
    throw new AssetEngineError('fixed supply requires maxSupply to equal initialSupply')
  }
  if (spec.supplyPolicy === 'authorized-mint' && spec.maxSupply !== 0n && spec.maxSupply < spec.atomicSupply) {
    throw new AssetEngineError('max supply must be zero or at least the initial supply')
  }
  if (spec.metadataHash < 0n || spec.metadataHash >= 1n << 256n) {
    throw new AssetEngineError('metadata hash must fit in bytes32')
  }
  if (spec.metadataUri.length !== 0 && spec.metadataHash === 0n) {
    throw new AssetEngineError('a non-empty metadata URI requires a non-zero sha256 hash')
  }
  normalizeAddress(spec.admin)
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

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}
