import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import solc from 'solc'
import { hexToBytes } from '@ethereumjs/util'

type SolcOutput = {
  errors?: Array<{ severity: string; formattedMessage: string }>
  contracts?: Record<
    string,
    Record<
      string,
      {
        abi: unknown[]
        evm: { bytecode: { object: string }; methodIdentifiers: Record<string, string> }
      }
    >
  >
}

export type CompiledCounter = {
  abi: unknown[]
  creationBytecode: Uint8Array
  methodIdentifiers: Record<string, string>
  sourceSha256: string
  compilerVersion: string
}

export function compileCounter(): CompiledCounter {
  const source = readFileSync(new URL('../contracts/Counter.sol', import.meta.url), 'utf8')
  const input = {
    language: 'Solidity',
    sources: { 'Counter.sol': { content: source } },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      evmVersion: 'osaka',
      metadata: { bytecodeHash: 'none', appendCBOR: false },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as SolcOutput
  const errors = output.errors?.filter((error) => error.severity === 'error') ?? []
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
  }
  const counter = output.contracts?.['Counter.sol']?.Counter
  const bytecode = counter?.evm.bytecode.object
  if (counter === undefined || bytecode === undefined || bytecode.length === 0) {
    throw new Error('Solidity compiler did not produce Counter bytecode')
  }

  return {
    abi: counter.abi,
    creationBytecode: hexToBytes(`0x${bytecode}`),
    methodIdentifiers: counter.evm.methodIdentifiers,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    compilerVersion: solc.version(),
  }
}
