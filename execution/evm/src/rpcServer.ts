import { resolve } from 'node:path'
import { PersistentBlockProcessor } from './blockProcessor.js'
import { DEFAULT_RPC_PORT, startLocalRpcServer } from './rpc.js'

function parseArguments(args: readonly string[]): {
  dataDirectory: string
  port: number
  enableDevelopmentSequencer: boolean
} {
  let dataDirectory: string | undefined
  let port = DEFAULT_RPC_PORT
  let enableDevelopmentSequencer = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--datadir') {
      const value = args[index + 1]
      if (value === undefined || value.length === 0 || dataDirectory !== undefined) {
        throw new Error('--datadir must be provided exactly once with a path')
      }
      dataDirectory = value
      index += 1
    } else if (arg === '--port') {
      const value = args[index + 1]
      if (value === undefined || !/^[1-9][0-9]{0,4}$/.test(value)) {
        throw new Error('--port must be a decimal port from 1 through 65535')
      }
      port = Number(value)
      if (port > 65_535) throw new Error('--port must be a decimal port from 1 through 65535')
      index += 1
    } else if (arg === '--dev-sequencer') {
      if (enableDevelopmentSequencer) throw new Error('--dev-sequencer may be provided only once')
      enableDevelopmentSequencer = true
    } else if (arg === '--help') {
      process.stdout.write('Usage: npm run rpc -- --datadir <local-store-path> [--port 8545] [--dev-sequencer]\n')
      process.exit(0)
    } else {
      throw new Error(`unsupported option: ${arg}`)
    }
  }
  if (dataDirectory === undefined) {
    throw new Error('--datadir is required; choose an isolated local store directory')
  }
  return { dataDirectory: resolve(dataDirectory), port, enableDevelopmentSequencer }
}

async function main(): Promise<void> {
  const { dataDirectory, port, enableDevelopmentSequencer } = parseArguments(process.argv.slice(2))
  const chain = await PersistentBlockProcessor.open(dataDirectory)
  const server = await startLocalRpcServer(chain, { port, enableDevelopmentSequencer })
  process.stdout.write(
    `BTCS L2 local RPC listening at http://${server.host}:${server.port}` +
    `${enableDevelopmentSequencer ? ' (development sequencer enabled)' : ''}\n`,
  )

  let closing = false
  const close = () => {
    if (closing) return
    closing = true
    void server.close().then(
      () => { process.exitCode = 0 },
      () => { process.exitCode = 1 },
    )
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'unknown startup error'
  process.stderr.write(`Unable to start local RPC node: ${message}\n`)
  process.exitCode = 1
})
