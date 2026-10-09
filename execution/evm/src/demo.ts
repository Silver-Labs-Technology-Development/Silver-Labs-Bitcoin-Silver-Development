import { runCounterPrototype } from './counter.js'

const result = await runCounterPrototype()
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
