/**
 * Compiles the BSNA reference contracts for the contract/metadata integration
 * test.
 *
 * The contracts under `contracts/token/` are the canonical BSNA-20 and BSNA-721
 * implementations. They are compiled from source with the same EVM target the
 * local development chain uses, so the test exercises the real bytecode.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import solc from 'solc'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const CONTRACTS_ROOT = resolve(REPOSITORY_ROOT, 'contracts')
const OPENZEPPELIN_ROOT = resolve(
  import.meta.dirname,
  '..',
  '..',
  'node_modules',
  '@openzeppelin',
  'contracts',
)

export type CompiledContract = {
  name: string
  abi: Array<Record<string, unknown>>
  creationBytecode: Uint8Array
  methodIdentifiers: Record<string, string>
}

export type CompiledBsnaContracts = {
  BSNA20: CompiledContract
  BSNA721: CompiledContract
  BsnaMetadataProbe: CompiledContract
}

type SolcOutput = {
  errors?: Array<{ severity: string; formattedMessage: string }>
  contracts?: Record<string, Record<string, {
    abi: Array<Record<string, unknown>>
    evm: { bytecode: { object: string }; methodIdentifiers: Record<string, string> }
  }>>
}

function resolveImport(importPath: string): string | undefined {
  if (importPath.startsWith('@openzeppelin/contracts/')) {
    return resolve(OPENZEPPELIN_ROOT, importPath.slice('@openzeppelin/contracts/'.length))
  }
  return undefined
}

/** Compile the BSNA-20, BSNA-721 and probe contracts. */
export function compileBsnaContracts(): CompiledBsnaContracts {
  const sources: Record<string, { content: string }> = {
    'BSNA20.sol': { content: readFileSync(resolve(CONTRACTS_ROOT, 'token', 'BSNA20.sol'), 'utf8') },
    'BSNA721.sol': { content: readFileSync(resolve(CONTRACTS_ROOT, 'token', 'BSNA721.sol'), 'utf8') },
    'BsnaMetadataProbe.sol': {
      content: readFileSync(resolve(CONTRACTS_ROOT, 'test', 'BsnaMetadataProbe.sol'), 'utf8'),
    },
  }
  const input = {
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: false, runs: 200 },
      evmVersion: 'osaka',
      metadata: { bytecodeHash: 'none', appendCBOR: false },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] },
      },
    },
  }
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (importPath: string) => {
        const resolved = resolveImport(importPath)
        if (resolved === undefined) {
          return { error: `unresolved import ${importPath}` }
        }
        return { contents: readFileSync(resolved, 'utf8') }
      },
    }),
  ) as SolcOutput

  const errors = output.errors?.filter((error) => error.severity === 'error') ?? []
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
  }

  return {
    BSNA20: readCompiled(output, 'BSNA20.sol', 'BSNA20'),
    BSNA721: readCompiled(output, 'BSNA721.sol', 'BSNA721'),
    BsnaMetadataProbe: readCompiled(output, 'BsnaMetadataProbe.sol', 'BsnaMetadataProbe'),
  }
}

function readCompiled(output: SolcOutput, fileName: string, contractName: string): CompiledContract {
  const contract = output.contracts?.[fileName]?.[contractName]
  const bytecode = contract?.evm.bytecode.object
  if (contract === undefined || bytecode === undefined || bytecode.length === 0) {
    throw new Error(`solidity compiler did not produce ${contractName} bytecode`)
  }
  return {
    name: contractName,
    abi: contract.abi,
    creationBytecode: Uint8Array.from(Buffer.from(bytecode, 'hex')),
    methodIdentifiers: contract.evm.methodIdentifiers,
  }
}
