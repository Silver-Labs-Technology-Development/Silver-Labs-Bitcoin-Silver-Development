import { importEvmSettlementBatchFile } from '../src/settlementBatchFile.js'
import { verifyEvmSettlementBatchExecution } from '../src/settlementBatchReplay.js'

function usage(): never {
  console.error(
    'Usage: npm run verify:batch:execution -- <file> <previous-commitment> <parent-hash> <start-height>',
  )
  process.exit(2)
}

const args = process.argv.slice(2)
if (args.length !== 4 || args.some((arg) => arg.length === 0)) usage()

const [file, previousCommitment, parentHash, startHeight] = args
if (
  file === undefined ||
  previousCommitment === undefined ||
  parentHash === undefined ||
  startHeight === undefined
) usage()

try {
  const batch = await importEvmSettlementBatchFile(file, {
    previousCommitment,
    parentHash,
    startHeight,
  })
  const report = await verifyEvmSettlementBatchExecution(
    batch,
    previousCommitment,
    parentHash,
    startHeight,
  )

  console.log('Settlement batch execution verification: PASSED')
  console.log(`Format: ${batch.format}`)
  console.log(`Version: ${batch.version}`)
  console.log(`Chain ID: ${batch.chainId}`)
  console.log(`Profile: ${batch.profileId}`)
  console.log(`Height range: ${report.startHeight} - ${report.endHeight}`)
  console.log(`Blocks verified: ${report.blocksVerified}`)
  console.log(`Child blocks re-executed: ${report.childBlocksReexecuted}`)
  console.log(`Batch hash: ${report.batchHash}`)
  console.log('')
  console.log('Scope: batch integrity, block linkage, fixed genesis match,')
  console.log('and child-block execution replay under the pinned local EVM profile.')
  console.log('Not proven: BTCS L1 publication, settlement, or finality.')
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown verification error'
  console.error('Settlement batch execution verification: FAILED')
  console.error(message)
  process.exitCode = 1
}
