import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { compileCounter } from '../src/compile.js'

const compiled = compileCounter()
const artifact = {
  contractName: 'Counter',
  compilerVersion: compiled.compilerVersion,
  evmVersion: 'osaka',
  sourceSha256: compiled.sourceSha256,
  abi: compiled.abi,
  methodIdentifiers: compiled.methodIdentifiers,
  creationBytecode: `0x${Buffer.from(compiled.creationBytecode).toString('hex')}`,
}
const outputDirectory = resolve('artifacts')
mkdirSync(outputDirectory, { recursive: true })
writeFileSync(resolve(outputDirectory, 'Counter.json'), `${JSON.stringify(artifact, null, 2)}\n`)
process.stdout.write(`Wrote artifacts/Counter.json with ${compiled.compilerVersion}\n`)
