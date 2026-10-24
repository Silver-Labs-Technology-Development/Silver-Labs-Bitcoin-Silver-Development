import { resolve } from 'node:path'
import { bindExistingBtcsL1PublicationStore } from '../src/btcsL1PublicationStore.js'
import { SettlementContinuityStore } from '../src/settlementContinuity.js'

async function main(): Promise<void> {
  const [storeArgument, continuityArgument, ...extra] = process.argv.slice(2)
  if (
    storeArgument === undefined ||
    continuityArgument === undefined ||
    extra.length !== 0
  ) {
    throw new Error(
      'usage: npm run bind:publication-continuity -- <publication-store-dir> <continuity-store-dir>',
    )
  }

  const storeDirectory = resolve(storeArgument)
  const continuity = await SettlementContinuityStore.open(
    resolve(continuityArgument),
  )
  await bindExistingBtcsL1PublicationStore(storeDirectory, continuity)

  console.log(
    `PASS: bound publication store ${storeDirectory} to continuity ${continuity.getDirectory()}`,
  )
}

main().catch((error: unknown) => {
  console.error(
    `FAIL: ${error instanceof Error ? error.message : String(error)}`,
  )
  process.exitCode = 1
})
