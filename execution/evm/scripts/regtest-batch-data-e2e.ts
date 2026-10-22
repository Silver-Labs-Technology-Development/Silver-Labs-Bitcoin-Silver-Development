import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import {
  encodeBtcsL1AnchorPayload,
} from '../src/btcsL1Anchor.js'
import { prepareBtcsL1AnchorForBatch } from '../src/btcsL1AnchorPreparation.js'
import { verifyBtcsL1AnchorConfirmation } from '../src/btcsL1Confirmation.js'
import { BtcsL1CoreRpcClient } from '../src/btcsL1CoreRpc.js'
import {
  encodeBtcsL1BatchData,
  reconstructEvmSettlementBatchFromCoreBlocks,
} from '../src/btcsL1BatchData.js'
import {
  inspectBtcsL1BatchDataAvailability,
  type BtcsL1BatchDataAvailabilityReport,
} from '../src/btcsL1BatchDataAvailability.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'

const HOST = process.env.BTCS_L2_BATCH_DATA_REGTEST_HOST ?? '127.0.0.1'
const RPC_HOST = HOST.includes(':') ? `[${HOST}]` : HOST
const PORT = Number(
  process.env.BTCS_L2_BATCH_DATA_REGTEST_PORT ??
  process.env.BTCS_L2_REGTEST_PORT ??
  29443,
)
const WALLET = process.env.BTCS_L2_BATCH_DATA_REGTEST_WALLET ??
  process.env.BTCS_L2_REGTEST_WALLET ?? 'btcs-l2-anchor-regtest'
const DATADIR = process.env.BTCS_L2_BATCH_DATA_REGTEST_DATADIR ??
  process.env.BTCS_L2_REGTEST_DATADIR ??
  join(homedir(), '.local', 'share', 'btcs-l2-regtest-core')
const REORG_TEST = process.env.BTCS_L2_BATCH_DATA_REGTEST_REORG_TEST === '1'
const ZERO_HASH = `0x${'0'.repeat(64)}`

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} is not a JSON object`)
  }
  return value as Record<string, unknown>
}

async function prepareBatch() {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-regtest-batch-data-'))
  try {
    const processor = await PersistentBlockProcessor.open(directory)
    const view0 = await processor.createCanonicalReadView()
    const genesis = view0.getCanonicalBlockByNumber(0n)
    if (genesis === undefined) throw new Error('L2 prototype genesis block is missing')
    const envelope0 = createEvmSettlementEnvelope(genesis.blockRlpHex)

    const timestamp = BigInt(Math.floor(Date.now() / 1000))
    await processor.buildNextBlock([], timestamp)
    const view1 = await processor.createCanonicalReadView()
    const child = view1.getCanonicalBlockByNumber(1n)
    if (child === undefined) throw new Error('L2 prototype child block is missing')
    const envelope1 = createEvmSettlementEnvelope(
      child.blockRlpHex,
      envelope0.commitmentHash,
    )
    const batch = createEvmSettlementBatch([envelope0, envelope1])
    const anchors = {
      previousCommitment: ZERO_COMMITMENT,
      parentHash: ZERO_HASH,
      startHeight: '0',
    }
    const anchor = await prepareBtcsL1AnchorForBatch(
      batch,
      anchors.previousCommitment,
      anchors.parentHash,
      anchors.startHeight,
    )
    if (anchor.executionVerified !== true) {
      throw new Error('settlement batch did not pass independent execution verification')
    }
    return { batch, anchors, anchor }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  if (REORG_TEST) {
    const expectedDatadir = join(homedir(), '.local', 'share', 'btcs-l2-regtest-reorg-20261011')
    if (
      PORT !== 29446 ||
      resolve(DATADIR) !== resolve(expectedDatadir) ||
      WALLET !== 'btcs-l2-reorg-test'
    ) {
      throw new Error(
        'Safety stop: destructive batch-data reorg test requires port 29446, the dedicated reorg datadir, and wallet btcs-l2-reorg-test',
      )
    }
  }
  if (!['127.0.0.1', 'localhost', '::1'].includes(HOST)) {
    throw new Error('BTCS regtest RPC host must be loopback')
  }
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
    throw new Error('BTCS regtest RPC port must be between 1 and 65535')
  }

  const cookiePath = join(DATADIR, 'regtest', '.cookie')
  const cookieInfo = await lstat(cookiePath)
  if (!cookieInfo.isFile() || cookieInfo.isSymbolicLink() || cookieInfo.size > 1024) {
    throw new Error('BTCS Core RPC cookie must be a small regular file')
  }
  const cookie = (await readFile(cookiePath, 'utf8')).trim()
  const separator = cookie.indexOf(':')
  if (separator < 1 || cookie.slice(0, separator) !== '__cookie__' || separator === cookie.length - 1) {
    throw new Error('BTCS Core RPC cookie has an invalid format')
  }
  const username = cookie.slice(0, separator)
  const password = cookie.slice(separator + 1)
  const authorization = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`

  let nextId = 1
  async function rpc(
    method: string,
    params: readonly unknown[] = [],
    wallet = false,
  ): Promise<unknown> {
    const id = nextId++
    let response: Response
    try {
      response = await fetch(
        `http://${RPC_HOST}:${PORT}${wallet ? `/wallet/${encodeURIComponent(WALLET)}` : ''}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
            authorization,
          },
          body: JSON.stringify({ jsonrpc: '1.0', id, method, params }),
          signal: AbortSignal.timeout(
            method === 'invalidateblock' ||
            method === 'generatetoaddress' ||
            method === 'unloadwallet' ||
            method === 'loadwallet' ||
            method === 'getnewaddress' ||
            method === 'getwalletinfo'
              ? 120_000
              : 15_000,
          ),
          redirect: 'error',
        },
      )
    } catch {
      throw new Error(`BTCS Core RPC ${method} request failed or timed out`)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new Error(`BTCS Core RPC ${method} returned invalid JSON (HTTP ${response.status})`)
    }
    const envelope = asRecord(body, `${method} RPC response`)
    if (envelope.id !== id) throw new Error(`${method} RPC response ID mismatch`)
    if (envelope.error !== null && envelope.error !== undefined) {
      const error = asRecord(envelope.error, `${method} RPC error`)
      throw new Error(`BTCS Core RPC ${method} failed: ${String(error.message ?? 'unknown error')}`)
    }
    if (!response.ok) throw new Error(`BTCS Core RPC ${method} returned HTTP ${response.status}`)
    if (!Object.hasOwn(envelope, 'result')) throw new Error(`${method} RPC response has no result`)
    return envelope.result
  }

  const chain = asRecord(await rpc('getblockchaininfo'), 'BTCS Core chain info')
  if (chain.chain !== 'regtest') {
    throw new Error('Safety stop: configured BTCS Core RPC is not on regtest')
  }
  if (!Number.isSafeInteger(chain.blocks) || (chain.blocks as number) < 0) {
    throw new Error('BTCS Core returned an invalid starting height')
  }
  const publicationStartHeight = (chain.blocks as number) + 1
  await rpc('getwalletinfo', [], true)
  const { batch, anchors, anchor } = await prepareBatch()
  const encoded = encodeBtcsL1BatchData(batch, anchors)
  if (encoded.fragments.length > 500) {
    throw new Error('Safety stop: regtest runner is limited to 500 batch-data transactions')
  }
  console.log(`PASS: connected to BTCS Core regtest wallet ${WALLET}`)
  console.log(`PASS: independently execution-verified L2 batch ${batch.batchHash}`)
  console.log(
    `Batch data: ${encoded.serializedBatch.byteLength} bytes in ${encoded.fragments.length} fragments`,
  )

  async function publishDataOutput(
    dataHex: string,
    expectedScript: string,
  ): Promise<{ txid: string; signedHex: string }> {
    const raw = await rpc('createrawtransaction', [[], { data: dataHex }])
    if (typeof raw !== 'string') throw new Error('Core returned an invalid raw transaction')
    const funded = asRecord(
      await rpc('fundrawtransaction', [raw, { minconf: 1, fee_rate: 2 }], true),
      'funded transaction',
    )
    if (typeof funded.hex !== 'string') throw new Error('Core did not return funded transaction hex')
    const signed = asRecord(
      await rpc('signrawtransactionwithwallet', [funded.hex], true),
      'signed transaction',
    )
    if (typeof signed.hex !== 'string' || signed.complete !== true) {
      throw new Error('Safety stop: Core wallet could not completely sign the data transaction')
    }
    const decoded = asRecord(await rpc('decoderawtransaction', [signed.hex]), 'decoded transaction')
    if (!Array.isArray(decoded.vout)) throw new Error('decoded transaction has no outputs')
    const scripts = decoded.vout.map((outputValue: unknown) => {
      const output = asRecord(outputValue, 'transaction output')
      const script = asRecord(output.scriptPubKey, 'transaction output script')
      return { hex: script.hex, value: output.value }
    })
    const nullDataOutputs = scripts.filter(
      (output) => typeof output.hex === 'string' && output.hex.startsWith('6a'),
    )
    if (
      nullDataOutputs.length !== 1 ||
      nullDataOutputs[0]?.hex !== expectedScript ||
      nullDataOutputs[0]?.value !== 0
    ) {
      throw new Error('Safety stop: signed transaction does not contain exactly the expected zero-value data output')
    }

    const mempool = await rpc('testmempoolaccept', [[signed.hex]])
    if (!Array.isArray(mempool) || mempool.length !== 1) {
      throw new Error('Core returned an invalid mempool acceptance result')
    }
    const result = asRecord(mempool[0], 'mempool acceptance result')
    if (result.allowed !== true) {
      throw new Error(
        `Core rejected a batch-data transaction: ${String(result['reject-reason'] ?? 'unknown reason')}`,
      )
    }
    const txid = await rpc('sendrawtransaction', [signed.hex])
    if (typeof txid !== 'string' || !/^[0-9a-f]{64}$/.test(txid)) {
      throw new Error('Core returned an invalid data transaction ID')
    }
    return { txid, signedHex: signed.hex }
  }

  const fragmentTxids: string[] = []
  const signedTransactions = new Map<string, string>()
  for (const fragment of encoded.fragments) {
    const published = await publishDataOutput(fragment.dataHex, fragment.scriptPubKeyHex)
    fragmentTxids.push(published.txid)
    signedTransactions.set(published.txid, published.signedHex)
  }
  const publishedAnchor = await publishDataOutput(
    encodeBtcsL1AnchorPayload(batch.batchHash),
    anchor.scriptPubKeyHex,
  )
  const anchorTxid = publishedAnchor.txid
  signedTransactions.set(anchorTxid, publishedAnchor.signedHex)
  console.log('PASS: Core accepted all batch-data fragments and the matching commitment')

  const miningAddress = await rpc('getnewaddress', [], true)
  if (typeof miningAddress !== 'string') throw new Error('Core returned an invalid mining address')
  const mined = await rpc('generatetoaddress', [1, miningAddress])
  if (!Array.isArray(mined) || typeof mined[0] !== 'string') {
    throw new Error('Core did not return the mined block hash')
  }
  const blockHash = mined[0]
  const newTip = asRecord(await rpc('getblockchaininfo'), 'BTCS Core chain info')
  if (newTip.chain !== 'regtest' || !Number.isSafeInteger(newTip.blocks)) {
    throw new Error('Core returned invalid regtest tip data after mining')
  }
  const activeHash = await rpc('getblockhash', [newTip.blocks])
  if (activeHash !== blockHash) throw new Error('mined data block is not the active regtest tip')
  const block = await rpc('getblock', [blockHash, 2])
  const blockRecord = asRecord(block, 'mined data block')
  if (!Array.isArray(blockRecord.tx)) throw new Error('mined data block has no transaction list')
  const includedTxids = new Set(blockRecord.tx.map((tx: unknown) => {
    const transaction = asRecord(tx, 'mined block transaction')
    if (typeof transaction.txid !== 'string') throw new Error('mined transaction has no txid')
    return transaction.txid
  }))
  if (
    !includedTxids.has(anchorTxid) ||
    fragmentTxids.some((txid) => !includedTxids.has(txid))
  ) {
    throw new Error('mined block does not contain every fragment and the matching commitment')
  }

  const confirmationRpc = new BtcsL1CoreRpcClient({
    url: `http://${RPC_HOST}:${PORT}`,
    username,
    password,
  })
  const anchorConfirmation = await verifyBtcsL1AnchorConfirmation(confirmationRpc, {
    txid: anchorTxid,
    blockHash,
    batchHash: batch.batchHash,
    requiredConfirmations: 1,
  })
  const reconstructed = reconstructEvmSettlementBatchFromCoreBlocks(
    [blockRecord],
    batch.batchHash,
    anchors,
  )
  if (
    reconstructed.batch.batchHash !== batch.batchHash ||
    !reconstructed.serializedBatch.equals(encoded.serializedBatch)
  ) {
    throw new Error('reconstructed batch differs from the published canonical bytes')
  }

  let availability = await inspectBtcsL1BatchDataAvailability({
    rpc: confirmationRpc,
    batchHash: batch.batchHash,
    anchorTxid,
    fragmentTxids,
    anchors,
    startHeight: publicationStartHeight,
    requiredConfirmations: 1,
  })
  if (availability.status !== 'available') {
    throw new Error(
      `batch data scanner returned ${availability.status}; expected active complete data`,
    )
  }

  let replacementBlockHash: string | undefined
  let orphanedAvailability: BtcsL1BatchDataAvailabilityReport | undefined
  let replacementAvailability: BtcsL1BatchDataAvailabilityReport | undefined
  if (REORG_TEST) {
    if (availability.anchor?.blockHash !== blockHash) {
      throw new Error('Safety stop: reorg test publication anchor is not in the scanned block')
    }
    const activeBefore = await rpc('getblockhash', [availability.anchor.blockHeight])
    if (activeBefore !== blockHash) {
      throw new Error('Safety stop: batch-data publication block is not active before reorg')
    }
    const replacementMiningAddress = await rpc('getnewaddress', [], true)
    if (typeof replacementMiningAddress !== 'string') {
      throw new Error('Core returned an invalid replacement mining address')
    }
    await rpc('unloadwallet', [WALLET])
    try {
      let invalidationError: unknown
      try {
        await rpc('invalidateblock', [blockHash])
      } catch (error) {
        invalidationError = error
      }
      const afterInvalidation = asRecord(await rpc('getblockchaininfo'), 'chain after invalidation')
      const orphanedHeader = asRecord(await rpc('getblockheader', [blockHash, true]), 'orphaned publication header')
      const invalidationApplied =
        afterInvalidation.chain === 'regtest' &&
        afterInvalidation.blocks === publicationStartHeight - 1 &&
        afterInvalidation.bestblockhash !== blockHash &&
        orphanedHeader.hash === blockHash &&
        orphanedHeader.confirmations === -1
      if (!invalidationApplied) {
        if (invalidationError instanceof Error) throw invalidationError
        throw new Error('Safety stop: publication block was not removed from the active chain')
      }
      if (invalidationError !== undefined) {
        console.log('PASS: Core RPC acknowledgement timed out, but active-chain status proves the block was invalidated')
      }
      orphanedAvailability = await inspectBtcsL1BatchDataAvailability({
        rpc: confirmationRpc,
        batchHash: batch.batchHash,
        anchorTxid,
        fragmentTxids,
        anchors,
        startHeight: publicationStartHeight,
        requiredConfirmations: 1,
        previousReport: availability,
      })
      if (
        orphanedAvailability.status !== 'incomplete' ||
        orphanedAvailability.missingTxids.length !== fragmentTxids.length + 1 ||
        orphanedAvailability.orphanedTxids.length !== fragmentTxids.length + 1
      ) {
        throw new Error('Safety stop: orphaned fragments or anchor were still counted as available')
      }
      console.log('PASS: reorg removed the anchor and every fragment from the availability result')

      const mempoolValue = await rpc('getrawmempool')
      if (!Array.isArray(mempoolValue)) throw new Error('Core returned an invalid mempool result')
      const mempool = new Set(mempoolValue.filter((value): value is string => typeof value === 'string'))
      for (const [txid, signedHex] of signedTransactions) {
        if (mempool.has(txid)) continue
        const rebroadcast = await rpc('sendrawtransaction', [signedHex])
        if (rebroadcast !== txid) throw new Error('rebroadcast returned a different transaction ID')
      }
      const replacementMined = await rpc('generatetoaddress', [1, replacementMiningAddress])
      if (!Array.isArray(replacementMined) || typeof replacementMined[0] !== 'string') {
        throw new Error('Core did not return a replacement publication block')
      }
      replacementBlockHash = replacementMined[0]
      if (replacementBlockHash === blockHash) {
        throw new Error('replacement publication block reused the orphaned block hash')
      }
      const activeReplacement = await rpc('getblockhash', [publicationStartHeight])
      if (activeReplacement !== replacementBlockHash) {
        throw new Error('replacement publication block is not active at the expected height')
      }
      replacementAvailability = await inspectBtcsL1BatchDataAvailability({
        rpc: confirmationRpc,
        batchHash: batch.batchHash,
        anchorTxid,
        fragmentTxids,
        anchors,
        startHeight: publicationStartHeight,
        requiredConfirmations: 1,
        previousReport: availability,
      })
      if (
        replacementAvailability.status !== 'available' ||
        replacementAvailability.anchor?.blockHash !== replacementBlockHash ||
        replacementAvailability.reorganizedTxids.length !== fragmentTxids.length + 1 ||
        replacementAvailability.reconstructedBytes !== encoded.serializedBatch.byteLength ||
        replacementAvailability.fragmentCount !== encoded.fragments.length
      ) {
        throw new Error('replacement branch did not restore complete verified batch availability')
      }
      availability = replacementAvailability
      console.log('PASS: replacement branch re-included the anchor and all fragments; reconstruction verified')
    } finally {
      await rpc('loadwallet', [WALLET])
      await rpc('getwalletinfo', [], true)
    }
  }

  console.log(`PASS: commitment confirmed at L1 height ${anchorConfirmation.blockHeight}`)
  console.log(`PASS: reconstructed ${reconstructed.fragmentCount} fragments from the active block`)
  console.log(`PASS: reconstructed bytes match batch hash ${reconstructed.batch.batchHash}`)
  console.log(`Batch byte length: ${reconstructed.serializedBatch.byteLength}`)
  console.log(`Anchor transaction: ${anchorTxid}`)
  console.log(`First data fragment transaction: ${fragmentTxids[0]}`)
  console.log(`Last data fragment transaction: ${fragmentTxids.at(-1)}`)
  console.log(`Publication block: ${blockHash}`)
  if (replacementBlockHash !== undefined) {
    console.log(`Replacement publication block: ${replacementBlockHash}`)
    console.log(`Orphaned transaction count: ${orphanedAvailability?.orphanedTxids.length ?? 0}`)
    console.log(`Replacement re-inclusion count: ${replacementAvailability?.reorganizedTxids.length ?? 0}`)
  }
  console.log('Core daemon and wallet data were left running and persistent.')
}

await main()
