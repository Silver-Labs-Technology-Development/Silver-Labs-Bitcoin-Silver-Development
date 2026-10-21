import { access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
  ProtocolError,
} from '../../src/blockProcessor.js'

const [chainDirectory, barrierDirectory] = process.argv.slice(2)
if (chainDirectory === undefined || barrierDirectory === undefined) {
  throw new Error('expected chain directory and process barrier directory')
}

const processor = await PersistentBlockProcessor.open(chainDirectory)
await writeFile(join(barrierDirectory, `${process.pid}.ready`), 'ready\n')
const startPath = join(barrierDirectory, 'start')
while (true) {
  try {
    await access(startPath)
    break
  } catch {
    await sleep(10)
  }
}

let timestamp = GENESIS_TIMESTAMP + 1n
for (let attempt = 0; attempt < 4; attempt++) {
  try {
    const block = await processor.buildNextBlock([], timestamp)
    process.stdout.write(`${block.summary.number}\n`)
    process.exitCode = 0
    break
  } catch (error) {
    if (!(error instanceof ProtocolError) || attempt === 3) throw error
    const view = await processor.createCanonicalReadView()
    timestamp = GENESIS_TIMESTAMP + view.report.tip.number + 1n
  }
}
