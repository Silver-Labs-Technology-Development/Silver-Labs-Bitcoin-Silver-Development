import { importEvmSettlementBatchFile } from '../src/settlementBatchFile.js'

function usage(): never {
  console.error(
    'Usage: npm run verify:batch -- <file> <previous-commitment> <parent-hash> <start-height>',
  )
  process.exit(2)
}

const args = process.argv.slice(2)

if (args.length !== 4 || args.some((arg) => arg.length === 0)) {
  usage()
}

const [file, previousCommitment, parentHash, startHeight] = args

if (
  file === undefined ||
  previousCommitment === undefined ||
  parentHash === undefined ||
  startHeight === undefined
) {
  usage()
}

try {
  const batch = await importEvmSettlementBatchFile(file, {
    previousCommitment,
    parentHash,
    startHeight,
  })

  console.log('Settlement batch verification: PASSED')
  console.log(`Format: ${batch.format}`)
  console.log(`Version: ${batch.version}`)
  console.log(`Chain ID: ${batch.chainId}`)
  console.log(`Profile: ${batch.profileId}`)
  console.log(`Height range: ${batch.startHeight} - ${batch.endHeight}`)
  console.log(`Blocks verified: ${batch.envelopes.length}`)
  console.log(`Batch hash: ${batch.batchHash}`)
  console.log('')
  console.log('Scope: batch integrity, block linkage, and supplied starting anchors.')
  console.log('Not proven: independent EVM re-execution, BTCS L1 publication,')
  console.log('settlement, or finality.')
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown verification error'
  console.error(`Settlement batch verification: FAILED`)
  console.error(message)
  process.exitCode = 1
}
