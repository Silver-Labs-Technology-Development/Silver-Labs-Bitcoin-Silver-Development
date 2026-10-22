#!/usr/bin/env node
import { PersistentBlockProcessor } from './blockProcessor.js'
import { startLocalRpcServer } from './rpc.js'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
const command = args[0]

if (command === 'start') {
  const dataDir = args[1] || './data'
  const port = parseInt(args[2] || '8545')
  const chain = await PersistentBlockProcessor.open(resolve(dataDir))
  const server = await startLocalRpcServer(chain, { port, enableDevelopmentSequencer: true })
  console.log(JSON.stringify({ status: 'started', host: server.host, port: server.port, dataDir }))
} else if (command === 'status') {
  console.log(JSON.stringify({ status: 'ok', chain: 'btcs-l2', mode: 'trusted-single-operator' }))
} else {
  console.log(JSON.stringify({ commands: ['start <datadir> <port>', 'status'] }))
}
