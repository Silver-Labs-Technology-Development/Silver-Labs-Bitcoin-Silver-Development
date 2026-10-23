import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { prepareBtcsL1AnchorForBatch } from '../src/btcsL1AnchorPreparation.js'
import { BtcsL1CoreRpcClient } from '../src/btcsL1CoreRpc.js'
import { BtcsL1PublicationStore } from '../src/btcsL1PublicationStore.js'
import { SettlementContinuityStore } from '../src/settlementContinuity.js'
import { invalidateBtcsL1PublicationAfterConfirmedReorg, verifyAndAdvanceBtcsL1PublicationInStore } from '../src/btcsL1PublicationWorkflow.js'

const HOST = '127.0.0.1'
const PORT = Number(process.env.BTCS_L2_REGTEST_PORT ?? 29443)
const WALLET = process.env.BTCS_L2_REGTEST_WALLET ?? 'btcs-l2-anchor-regtest'
const DATADIR = process.env.BTCS_L2_REGTEST_DATADIR ?? join(homedir(), '.local', 'share', 'btcs-l2-regtest-core')
const PUBLICATION_STORE_DIR = process.env.BTCS_L2_PUBLICATION_STORE_DIR ?? join(homedir(), '.local', 'share', 'btcs-l2-regtest-publications')
const CONTINUITY_STORE_DIR = process.env.BTCS_L2_CONTINUITY_STORE_DIR ?? join(homedir(), '.local', 'share', 'btcs-l2-regtest-continuity')
const REORG_TEST = process.env.BTCS_L2_REGTEST_REORG_TEST === '1'
const ZERO_HASH = `0x${'0'.repeat(64)}`

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`)
  }
  return value as Record<string, unknown>
}

async function prepareVerifiedAnchor(timestamp: bigint) {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-regtest-batch-'))
  try {
    const processor = await PersistentBlockProcessor.open(directory)
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    if (!genesis) throw new Error('L2 prototype genesis block is missing')

    const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)

    await processor.buildNextBlock([], timestamp)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    if (!child) throw new Error('L2 prototype child block is missing')

    const envelope1 = createEvmSettlementEnvelope(
      child.blockRlpHex,
      envelope0.commitmentHash,
    )
    const batch = createEvmSettlementBatch([envelope0, envelope1])

    return {
      preparation: await prepareBtcsL1AnchorForBatch(
        batch,
        ZERO_COMMITMENT,
        ZERO_HASH,
        '0',
      ),
      batch,
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function openOrCreateContinuityStore(): Promise<SettlementContinuityStore> {
  try {
    await lstat(CONTINUITY_STORE_DIR)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return SettlementContinuityStore.create(CONTINUITY_STORE_DIR)
  }
  return SettlementContinuityStore.open(CONTINUITY_STORE_DIR)
}

async function openOrCreatePublicationStore(
  continuity: SettlementContinuityStore,
) {
  try {
    await lstat(PUBLICATION_STORE_DIR)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return BtcsL1PublicationStore.create(PUBLICATION_STORE_DIR, continuity)
  }
  // Existing but missing/corrupt store files must fail closed.
  return BtcsL1PublicationStore.open(PUBLICATION_STORE_DIR, continuity)
}

async function main() {
  if (REORG_TEST) {
    const expectedDatadir = join(homedir(), '.local', 'share', 'btcs-l2-regtest-reorg-20261011')
    const expectedStore = join(homedir(), '.local', 'share', 'btcs-l2-regtest-reorg-publications-20261011')
    const expectedContinuity = join(homedir(), '.local', 'share', 'btcs-l2-regtest-reorg-continuity-20261011')
    if (PORT !== 29444 || resolve(DATADIR) !== resolve(expectedDatadir) ||
      resolve(PUBLICATION_STORE_DIR) !== resolve(expectedStore) ||
      resolve(CONTINUITY_STORE_DIR) !== resolve(expectedContinuity) ||
      WALLET !== 'btcs-l2-reorg-test') {
      throw new Error('Safety stop: reorg test must use port 29444, the disposable reorg datadir/stores, and wallet btcs-l2-reorg-test')
    }
  }

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
  const continuity = await openOrCreateContinuityStore()
  const publicationStore = await openOrCreatePublicationStore(continuity)
  console.log('PASS: connected to local BTCS regtest and test wallet')
  console.log(`RPC port: ${PORT}; wallet: ${WALLET}`)
  console.log(`Data directory: ${DATADIR}`)
  console.log(`Publication store: ${PUBLICATION_STORE_DIR}`)
  console.log(`Continuity store: ${CONTINUITY_STORE_DIR}`)

  const { preparation, batch } = await prepareVerifiedAnchor(
    BigInt(Math.floor(Date.now() / 1000)),
  )
  if (preparation.executionVerified !== true) {
    throw new Error('Safety stop: batch execution was not verified')
  }
  const existingPublication = publicationStore.get(preparation.batchHash)
  if (existingPublication !== undefined && existingPublication.state !== 'prepared') {
    throw new Error(
      `Publication already exists for this batch in state ${existingPublication.state}`,
    )
  }
  if (
    existingPublication === undefined &&
    continuity.getCursor() !== null
  ) {
    throw new Error(
      'Safety stop: the continuity store already contains a different history; ' +
      'use a fresh isolated BTCS_L2_CONTINUITY_STORE_DIR for a new genesis E2E run',
    )
  }
  if (existingPublication === undefined) {
    await publicationStore.createPublication(preparation.batchHash, 1)
  }

  console.log(
    `PASS: independently verified L2 batch ${preparation.batchHash} ` +
    `(heights ${preparation.startHeight}-${preparation.endHeight})`,
  )
  console.log('PASS: prepared publication record is durable')

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
  await publicationStore.markSubmitted(preparation.batchHash, txid)
  console.log(`PASS: transaction accepted by local regtest mempool (${txid})`)
  console.log('PASS: submitted state is persisted')

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
  const report = await verifyAndAdvanceBtcsL1PublicationInStore(
    confirmationRpc,
    publicationStore,
    preparation.batchHash,
    blockHash,
    batch,
  )

  const reopenedStore = await BtcsL1PublicationStore.open(
    PUBLICATION_STORE_DIR,
    continuity,
  )
  const recovered = reopenedStore.get(preparation.batchHash)
  if (recovered === undefined) {
    throw new Error('Publication was missing after reopening the store')
  }
  if (JSON.stringify(recovered) !== JSON.stringify(report)) {
    throw new Error('Recovered publication differs from the verified persisted state')
  }
  if (recovered.state !== 'confirmed') {
    throw new Error(`Expected confirmed state; recovered ${recovered.state}`)
  }
  console.log('PASS: confirmation verified and persisted')
  console.log('PASS: confirmed publication recovered after store reopen')

  let finalPublication = report
  let finalRecovered = recovered

  if (REORG_TEST) {
    const originalBlockHash = report.blockHash
    if (typeof originalBlockHash !== 'string' || typeof report.blockHeight !== 'number') {
      throw new Error('Safety stop: confirmed publication has no block inclusion data')
    }
    const originalHeader = asRecord(await rpc('getblockheader', [originalBlockHash, true]), 'original block header')
    if (originalHeader.hash !== originalBlockHash || typeof originalHeader.confirmations !== 'number' || originalHeader.confirmations < 1) {
      throw new Error('Safety stop: original anchor block is not confirmed on the active chain before reorg')
    }

    await rpc('invalidateblock', [originalBlockHash])
    const chainAfterInvalidation = asRecord(await rpc('getblockchaininfo'), 'chain after invalidation')
    if (chainAfterInvalidation.chain !== 'regtest' || chainAfterInvalidation.bestblockhash === originalBlockHash) {
      throw new Error('Safety stop: invalidated anchor block remains the active regtest tip')
    }
    const orphanedHeader = asRecord(await rpc('getblockheader', [originalBlockHash, true]), 'orphaned block header')
    if (orphanedHeader.confirmations !== -1) {
      throw new Error('Safety stop: Core did not report the original anchor block as outside the active chain')
    }
    console.log('PASS: original anchor inclusion removed from the active chain')

    const invalidatedPublication = await invalidateBtcsL1PublicationAfterConfirmedReorg(
      publicationStore, preparation.batchHash, originalBlockHash,
    )
    if (invalidatedPublication.state !== 'invalidated') {
      throw new Error(`Expected invalidated state; received ${invalidatedPublication.state}`)
    }
    const reopenedInvalidatedStore = await BtcsL1PublicationStore.open(
      PUBLICATION_STORE_DIR,
      continuity,
    )
    const recoveredInvalidated = reopenedInvalidatedStore.get(preparation.batchHash)
    if (recoveredInvalidated === undefined || recoveredInvalidated.state !== 'invalidated' ||
      JSON.stringify(recoveredInvalidated) !== JSON.stringify(invalidatedPublication)) {
      throw new Error('Invalidated publication was not durably recovered after store reopen')
    }
    console.log('PASS: reorg invalidation persisted and survived store reopen')
    const replacementMiningAddress = await rpc('getnewaddress', [], true)
    if (
      typeof replacementMiningAddress !== 'string' ||
      replacementMiningAddress === miningAddress
    ) {
      throw new Error('Safety stop: replacement branch must use a distinct wallet address')
    }
    const replacementMined = await rpc('generatetoaddress', [1, replacementMiningAddress])
    if (!Array.isArray(replacementMined) || typeof replacementMined[0] !== 'string') {
      throw new Error('Core did not return a replacement-branch block hash')
    }
    const replacementBlockHash = replacementMined[0]
    if (replacementBlockHash === originalBlockHash) {
      throw new Error('Safety stop: replacement branch reused the invalidated block hash')
    }
    const replacementBlock = asRecord(await rpc('getblock', [replacementBlockHash, 1]), 'replacement block')
    const replacementTxs = replacementBlock.tx
    let reincludeBlockHash: string | undefined =
      Array.isArray(replacementTxs) && replacementTxs.includes(txid) ? replacementBlockHash : undefined
    const replacementTip = asRecord(await rpc('getblockchaininfo'), 'replacement-chain info')
    if (replacementTip.chain !== 'regtest' || replacementTip.bestblockhash !== replacementBlockHash) {
      throw new Error('Safety stop: replacement branch did not become the active regtest tip')
    }
    const stillOrphanedHeader = asRecord(await rpc('getblockheader', [originalBlockHash, true]), 'reorged block header')
    if (stillOrphanedHeader.confirmations !== -1) {
      throw new Error('Safety stop: original inclusion unexpectedly returned to the active chain')
    }
    console.log(`PASS: replacement branch is active (${replacementBlockHash})`)


    if (reincludeBlockHash === undefined) {
      const mempool = await rpc('getrawmempool')
      if (!Array.isArray(mempool)) throw new Error('Core returned an invalid mempool result')
      if (!mempool.includes(txid)) {
        const rebroadcastTxid = await rpc('sendrawtransaction', [signed.hex])
        if (rebroadcastTxid !== txid) throw new Error('Rebroadcast returned a different transaction ID')
      }
      for (let attempt = 0; attempt < 3 && reincludeBlockHash === undefined; attempt++) {
        const retryMined = await rpc('generatetoaddress', [1, miningAddress])
        if (!Array.isArray(retryMined) || typeof retryMined[0] !== 'string') {
          throw new Error('Core did not return a recovery block hash')
        }
        const candidateHash = retryMined[0]
        const candidateBlock = asRecord(await rpc('getblock', [candidateHash, 1]), 'recovery block')
        if (Array.isArray(candidateBlock.tx) && candidateBlock.tx.includes(txid)) {
          reincludeBlockHash = candidateHash
        }
      }
    }
    if (reincludeBlockHash === undefined) {
      throw new Error('Safety stop: anchor transaction was not re-included within three recovery blocks')
    }
    const reobservedPublication = await verifyAndAdvanceBtcsL1PublicationInStore(
      confirmationRpc,
      publicationStore,
      preparation.batchHash,
      reincludeBlockHash,
      batch,
    )
    if (reobservedPublication.state !== 'confirmed' || reobservedPublication.blockHash !== reincludeBlockHash) {
      throw new Error('Publication did not recover to confirmed state on its replacement inclusion')
    }
    const reopenedRecoveredStore = await BtcsL1PublicationStore.open(
      PUBLICATION_STORE_DIR,
      continuity,
    )
    const durableRecovery = reopenedRecoveredStore.get(preparation.batchHash)
    if (durableRecovery === undefined || durableRecovery.state !== 'confirmed' ||
      JSON.stringify(durableRecovery) !== JSON.stringify(reobservedPublication)) {
      throw new Error('Recovered confirmed publication did not survive store reopen')
    }
    finalPublication = reobservedPublication
    finalRecovered = durableRecovery
    console.log('PASS: publication re-observed and confirmed on the replacement branch')
    console.log('PASS: recovered confirmation persisted and survived store reopen')
  }

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
    publication: finalPublication,
    recoveredPublication: finalRecovered,
  }, null, 2))
}

main().catch((error: unknown) => {
  console.error('REGTEST ANCHOR FAILED')
  console.error(error instanceof Error ? error.stack ?? error.message : String(error))
  process.exitCode = 1
})
