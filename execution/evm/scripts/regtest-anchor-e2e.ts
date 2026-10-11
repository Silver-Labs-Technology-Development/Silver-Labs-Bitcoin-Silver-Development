import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { prepareBtcsL1AnchorForBatch } from '../src/btcsL1AnchorPreparation.js'
import { BtcsL1CoreRpcClient } from '../src/btcsL1CoreRpc.js'
import { verifyBtcsL1AnchorConfirmation } from '../src/btcsL1Confirmation.js'

const HOST = '127.0.0.1'
const PORT = 29443
const WALLET = 'btcs-l2-anchor-regtest'
const DATADIR = join(homedir(), '.local', 'share', 'btcs-l2-regtest-core')
const ZERO_HASH = `0x${'0'.repeat(64)}`

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`)
  }
  return value as Record<string, unknown>
}

async function prepareVerifiedAnchor() {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-regtest-batch-'))
  try {
    const processor = await PersistentBlockProcessor.open(directory)
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    if (!genesis) throw new Error('L2 prototype genesis block is missing')

    const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)

    await processor.buildNextBlock([], 1_750_000_001n)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    if (!child) throw new Error('L2 prototype child block is missing')

    const envelope1 = createEvmSettlementEnvelope(
      child.blockRlpHex,
      envelope0.commitmentHash,
    )
    const batch = createEvmSettlementBatch([envelope0, envelope1])

    return await prepareBtcsL1AnchorForBatch(
      batch,
      ZERO_COMMITMENT,
      ZERO_HASH,
      '0',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function main() {
  const cookiePath = join(DATADIR, 'regtest', '.cookie')
  const cookie = (await readFile(cookiePath, 'utf8')).trim()
  const separator = cookie.indexOf(':')
  if (separator < 1) throw new Error('BTCS Core RPC cookie has an invalid format')

  const username = cookie.slice(0, separator)
  const password = cookie.slice(separator + 1)
  if (username !== '__cookie__' || password.length === 0) {
    throw new Error('Unexpected BTCS Core RPC cookie format')
  }

  let nextId = 1
  async function rpc(
    method: string,
    params: readonly unknown[] = [],
    wallet = false,
  ): Promise<unknown> {
    const id = nextId++
    const endpoint = `http://${HOST}:${PORT}${
      wallet ? `/wallet/${encodeURIComponent(WALLET)}` : ''
    }`
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      },
      body: JSON.stringify({ jsonrpc: '1.0', id, method, params }),
      signal: AbortSignal.timeout(15_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error(`${method} RPC returned HTTP ${response.status}`)

    const envelope = asRecord(await response.json(), `${method} RPC response`)
    if (envelope.id !== id) throw new Error(`${method} RPC response ID mismatch`)
    if (envelope.error !== null && envelope.error !== undefined) {
      const rpcError = asRecord(envelope.error, `${method} RPC error`)
      throw new Error(`${method} RPC failed: ${String(rpcError.message ?? 'unknown error')}`)
    }
    if (!Object.prototype.hasOwnProperty.call(envelope, 'result')) {
      throw new Error(`${method} RPC response has no result`)
    }
    return envelope.result
  }

  const chain = asRecord(await rpc('getblockchaininfo'), 'chain info')
  if (chain.chain !== 'regtest') {
    throw new Error('Safety stop: configured BTCS Core RPC is not on regtest')
  }

  await rpc('getwalletinfo', [], true)
  console.log('PASS: connected to local BTCS regtest and test wallet')

  const preparation = await prepareVerifiedAnchor()
  if (preparation.executionVerified !== true) {
    throw new Error('Safety stop: batch execution was not verified')
  }
  console.log(
    `PASS: independently verified L2 batch ${preparation.batchHash} ` +
    `(heights ${preparation.startHeight}-${preparation.endHeight})`,
  )

  const raw = await rpc('createrawtransaction', [
    [],
    { data: preparation.dataHex },
  ])
  if (typeof raw !== 'string') throw new Error('Core returned an invalid raw transaction')

  const funded = asRecord(await rpc('fundrawtransaction', [raw], true), 'funded transaction')
  if (typeof funded.hex !== 'string') throw new Error('Core did not return funded transaction hex')

  const signed = asRecord(
    await rpc('signrawtransactionwithwallet', [funded.hex], true),
    'signed transaction',
  )
  if (typeof signed.hex !== 'string' || signed.complete !== true) {
    throw new Error('Safety stop: transaction signing was incomplete')
  }

  const decoded = asRecord(
    await rpc('decoderawtransaction', [signed.hex]),
    'decoded transaction',
  )
  if (!Array.isArray(decoded.vout)) throw new Error('Decoded transaction has no output list')
  const exactAnchorCount = decoded.vout.filter((value: unknown) => {
    const output = asRecord(value, 'transaction output')
    const script = asRecord(output.scriptPubKey, 'output script')
    return script.hex === preparation.scriptPubKeyHex
  }).length
  if (exactAnchorCount !== 1) {
    throw new Error('Safety stop: signed transaction does not contain exactly one expected anchor')
  }

  const mempoolResult = await rpc('testmempoolaccept', [[signed.hex]])
  if (!Array.isArray(mempoolResult) || mempoolResult.length !== 1) {
    throw new Error('Core returned an invalid mempool acceptance result')
  }
  const acceptance = asRecord(mempoolResult[0], 'mempool acceptance')
  if (acceptance.allowed !== true) {
    throw new Error(
      `Safety stop: Core rejected transaction: ${String(acceptance['reject-reason'] ?? 'unknown reason')}`,
    )
  }

  const chainBeforeSend = asRecord(await rpc('getblockchaininfo'), 'chain info')
  if (chainBeforeSend.chain !== 'regtest') {
    throw new Error('Safety stop: chain changed before submission')
  }

  const txid = await rpc('sendrawtransaction', [signed.hex])
  if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {
    throw new Error('Core returned an invalid transaction ID')
  }
  console.log(`PASS: transaction accepted by local regtest mempool (${txid})`)

  const miningAddress = await rpc('getnewaddress', [], true)
  if (typeof miningAddress !== 'string') throw new Error('Core returned an invalid mining address')

  const mined = await rpc('generatetoaddress', [1, miningAddress])
  if (!Array.isArray(mined) || typeof mined[0] !== 'string') {
    throw new Error('Core did not return the mined block hash')
  }
  const blockHash = mined[0]

  const confirmationRpc = new BtcsL1CoreRpcClient({
    url: `http://${HOST}:${PORT}`,
    username,
    password,
  })
  const report = await verifyBtcsL1AnchorConfirmation(confirmationRpc, {
    txid,
    blockHash,
    batchHash: preparation.batchHash,
    requiredConfirmations: 1,
  })

  console.log('\n=== VERIFIED REGTEST ANCHOR ===')
  console.log(JSON.stringify({
    network: 'regtest',
    batch: {
      batchHash: preparation.batchHash,
      startHeight: preparation.startHeight,
      endHeight: preparation.endHeight,
      blocksVerified: preparation.blocksVerified,
      executionVerified: preparation.executionVerified,
      dataHex: preparation.dataHex,
      scriptPubKeyHex: preparation.scriptPubKeyHex,
    },
    confirmation: report,
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error('REGTEST ANCHOR FAILED')
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
