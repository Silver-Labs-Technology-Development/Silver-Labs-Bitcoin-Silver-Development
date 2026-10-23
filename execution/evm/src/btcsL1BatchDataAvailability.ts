import { ProtocolError } from './blockProcessor.js'
import { encodeBtcsL1AnchorScript } from './btcsL1Anchor.js'
import {
  MAX_BTCS_L1_BATCH_DATA_FRAGMENTS,
  MAX_BTCS_L1_BATCH_DATA_SCAN_BLOCKS,
  MAX_BTCS_L1_BATCH_DATA_SCAN_OUTPUTS,
  decodeBtcsL1BatchDataScript,
  reconstructEvmSettlementBatchFromScripts,
} from './btcsL1BatchData.js'
import type { SettlementBatchAnchors } from './settlementBatchFile.js'

const HASH_RE = /^[0-9a-f]{64}$/

export type BtcsL1BatchDataCoreRpc = Readonly<{
  getBlockchainInfo(): Promise<unknown>
  getBlockHash(height: number): Promise<unknown>
  getBlock(blockHash: string): Promise<unknown>
}>

export type BtcsL1BatchDataInclusion = Readonly<{
  txid: string
  blockHash: string
  blockHeight: number
  confirmations: number
}>

export type BtcsL1BatchDataAvailabilityReport = Readonly<{
  format: 'btcs-l2-btcs-l1-batch-data-availability'
  version: 1
  batchHash: string
  status: 'incomplete' | 'awaiting-confirmations' | 'available'
  tipHeight: number
  startHeight: number
  requiredConfirmations: number
  anchor?: BtcsL1BatchDataInclusion
  fragments: readonly BtcsL1BatchDataInclusion[]
  missingTxids: readonly string[]
  reorganizedTxids: readonly string[]
  orphanedTxids: readonly string[]
  reconstructedBytes?: number
  fragmentCount?: number
}>

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(label + ' is malformed')
  }
  return value as Record<string, unknown>
}

function hash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw new ProtocolError(label + ' must be a 64-character lowercase hash')
  }
  return value
}

function validateRequest(request: Readonly<{
  batchHash: string
  anchorTxid: string
  fragmentTxids: readonly string[]
  startHeight: number
  requiredConfirmations: number
}>): void {
  hash(request.batchHash, 'batch hash')
  hash(request.anchorTxid, 'anchor transaction ID')
  if (
    !Array.isArray(request.fragmentTxids) ||
    request.fragmentTxids.length < 1 ||
    request.fragmentTxids.length > MAX_BTCS_L1_BATCH_DATA_FRAGMENTS
  ) {
    throw new ProtocolError('expected fragment transaction IDs are empty or exceed the format limit')
  }
  const txids = [request.anchorTxid, ...request.fragmentTxids]
  for (const txid of txids) hash(txid, 'publication transaction ID')
  if (new Set(txids).size !== txids.length) {
    throw new ProtocolError('anchor and fragment transaction IDs must be unique')
  }
  if (!Number.isSafeInteger(request.startHeight) || request.startHeight < 0) {
    throw new ProtocolError('publication scan start height must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(request.requiredConfirmations) || request.requiredConfirmations < 1) {
    throw new ProtocolError('publication confirmation requirement must be a positive safe integer')
  }
}

function inclusion(
  txid: string,
  blockHash: string,
  blockHeight: number,
  tipHeight: number,
): BtcsL1BatchDataInclusion {
  return {
    txid,
    blockHash,
    blockHeight,
    confirmations: tipHeight - blockHeight + 1,
  }
}

/**
 * Recompute publication availability from a bounded active-chain scan.
 * No cursor or process-local state is trusted: after restart, the same call
 * re-reads the active chain. The scan is bracketed by reads of the active tip
 * height and tip hash; if either changed while scanning, the result would mix
 * two chain states, so the call fails closed instead of reporting `available`.
 * Core RPC is trusted; this is not an inclusion-proof verifier.
 */
export async function inspectBtcsL1BatchDataAvailability(options: Readonly<{
  rpc: BtcsL1BatchDataCoreRpc
  batchHash: string
  anchorTxid: string
  fragmentTxids: readonly string[]
  anchors: SettlementBatchAnchors
  startHeight: number
  requiredConfirmations: number
  previousReport?: BtcsL1BatchDataAvailabilityReport
}>): Promise<BtcsL1BatchDataAvailabilityReport> {
  validateRequest(options)
  const chain = asRecord(await options.rpc.getBlockchainInfo(), 'BTCS Core chain info')
  if (chain.chain !== 'regtest') {
    throw new ProtocolError('batch data availability scan requires chain=regtest')
  }
  if (!Number.isSafeInteger(chain.blocks) || (chain.blocks as number) < options.startHeight - 1) {
    throw new ProtocolError('BTCS Core tip is below the configured publication scan start height')
  }
  const tipHeight = chain.blocks as number
  const blockCount = Math.max(0, tipHeight - options.startHeight + 1)
  if (blockCount > MAX_BTCS_L1_BATCH_DATA_SCAN_BLOCKS) {
    throw new ProtocolError('batch data availability scan exceeds the bounded block history')
  }
  const expectedTipHash = hash(
    await options.rpc.getBlockHash(tipHeight),
    'active tip block hash',
  )
  const targetTxids = new Set([options.anchorTxid, ...options.fragmentTxids])
  const txInclusions = new Map<string, BtcsL1BatchDataInclusion>()
  const fragmentScripts = new Map<string, string>()
  const expectedAnchorScript = encodeBtcsL1AnchorScript(options.batchHash)
  let scannedOutputs = 0

  for (let height = options.startHeight; height <= tipHeight; height += 1) {
    const blockHash = hash(await options.rpc.getBlockHash(height), `active block hash at height ${height}`)
    const block = asRecord(await options.rpc.getBlock(blockHash), `Core block at height ${height}`)
    if (block.hash !== blockHash || block.height !== height || !Array.isArray(block.tx)) {
      throw new ProtocolError('Core returned a block that does not match the requested active-chain height')
    }
    for (const transactionValue of block.tx) {
      const transaction = asRecord(transactionValue, 'Core block transaction')
      if (!Array.isArray(transaction.vout)) {
        throw new ProtocolError('Core block transaction has no output array')
      }
      scannedOutputs += transaction.vout.length
      if (scannedOutputs > MAX_BTCS_L1_BATCH_DATA_SCAN_OUTPUTS) {
        throw new ProtocolError('batch data availability scan exceeds the output limit')
      }
      if (typeof transaction.txid !== 'string' || !targetTxids.has(transaction.txid)) continue
      const txid = transaction.txid
      if (txInclusions.has(txid)) {
        throw new ProtocolError('publication transaction appears more than once in the active scan range')
      }
      const scripts: string[] = []
      for (const outputValue of transaction.vout) {
        const output = asRecord(outputValue, 'Core transaction output')
        const script = asRecord(output.scriptPubKey, 'Core output script')
        if (typeof script.hex === 'string' && /^(?:[0-9a-f]{2})+$/.test(script.hex)) {
          scripts.push(script.hex)
        }
      }

      if (txid === options.anchorTxid) {
        const matches = scripts.filter((script) => script === expectedAnchorScript)
        if (matches.length !== 1) {
          throw new ProtocolError('expected anchor transaction does not contain exactly one matching commitment')
        }
      } else {
        const matchingFragments: string[] = []
        let sawDifferentBatch = false
        for (const script of scripts) {
          let fragment: ReturnType<typeof decodeBtcsL1BatchDataScript> | undefined
          try {
            fragment = decodeBtcsL1BatchDataScript(script)
          } catch (error) {
            if (error instanceof ProtocolError) {
              throw new ProtocolError(
                `expected fragment transaction contains a malformed batch-data fragment: ${error.message}`,
              )
            }
            throw error
          }
          if (fragment === undefined) continue
          if (fragment.batchHash !== options.batchHash) {
            sawDifferentBatch = true
            continue
          }
          matchingFragments.push(script)
        }
        if (matchingFragments.length !== 1) {
          if (sawDifferentBatch) {
            throw new ProtocolError('expected fragment transaction contains another batch hash')
          }
          if (matchingFragments.length > 1) {
            throw new ProtocolError('expected fragment transaction must contain exactly one matching fragment')
          }
          // Expected fragment tx exists on-chain but has no valid fragment for this batch
          continue
        }
        fragmentScripts.set(txid, matchingFragments[0]!)
      }
      txInclusions.set(txid, inclusion(txid, blockHash, height, tipHeight))
    }
  }

  const finalChain = asRecord(
    await options.rpc.getBlockchainInfo(),
    'BTCS Core chain info after scan',
  )
  if (finalChain.chain !== 'regtest') {
    throw new ProtocolError('batch data availability scan requires chain=regtest')
  }
  if (!Number.isSafeInteger(finalChain.blocks) || (finalChain.blocks as number) < 0) {
    throw new ProtocolError('BTCS Core returned an invalid tip height after the scan')
  }
  // A tip-height change (extension or shortening) means the scan observed more
  // than one chain state, even though every scanned height was still canonical.
  if (finalChain.blocks !== tipHeight) {
    throw new ProtocolError(
      'active chain tip height changed during batch data scan; retry the inspection',
    )
  }
  // Re-reading the tip hash at the (unchanged) tip height proves the whole
  // scanned ancestry did not change: in a hash-linked chain the tip block
  // commits to every ancestor, so an earlier block cannot change while this
  // hash stays the same. This also catches a same-height reorganization.
  const finalTipHash = hash(
    await options.rpc.getBlockHash(tipHeight),
    'active tip block hash after scan',
  )
  if (finalTipHash !== expectedTipHash) {
    throw new ProtocolError('active chain changed during batch data scan; retry the inspection')
  }

  const anchor = txInclusions.get(options.anchorTxid)
  const fragments = options.fragmentTxids.flatMap((txid) => {
    const found = txInclusions.get(txid)
    return found === undefined ? [] : [found]
  })
  const missingTxids = [options.anchorTxid, ...options.fragmentTxids]
    .filter((txid) => !txInclusions.has(txid))
  const previousByTxid = new Map<string, BtcsL1BatchDataInclusion>()
  if (options.previousReport !== undefined) {
    if (options.previousReport.batchHash !== options.batchHash) {
      throw new ProtocolError('previous availability report is for another batch hash')
    }
    if (options.previousReport.anchor !== undefined) {
      previousByTxid.set(options.previousReport.anchor.txid, options.previousReport.anchor)
    }
    for (const item of options.previousReport.fragments) previousByTxid.set(item.txid, item)
  }
  const reorganizedTxids: string[] = []
  const orphanedTxids: string[] = []
  for (const [txid, previous] of previousByTxid) {
    const current = txInclusions.get(txid)
    if (current === undefined) orphanedTxids.push(txid)
    else if (current.blockHash !== previous.blockHash || current.blockHeight !== previous.blockHeight) {
      reorganizedTxids.push(txid)
    }
  }

  let status: BtcsL1BatchDataAvailabilityReport['status'] = 'incomplete'
  let reconstructedBytes: number | undefined
  let fragmentCount: number | undefined
  if (missingTxids.length === 0 && anchor !== undefined) {
    const reconstructed = await reconstructEvmSettlementBatchFromScripts(
      options.fragmentTxids.map((txid) => fragmentScripts.get(txid)!),
      options.batchHash,
      options.anchors,
    )
    if (reconstructed.fragmentCount !== options.fragmentTxids.length) {
      throw new ProtocolError('active fragment set does not match the complete batch fragment count')
    }
    reconstructedBytes = reconstructed.serializedBatch.byteLength
    fragmentCount = reconstructed.fragmentCount
    status = [anchor, ...fragments].every(
      (item) => item.confirmations >= options.requiredConfirmations,
    ) ? 'available' : 'awaiting-confirmations'
  }

  return {
    format: 'btcs-l2-btcs-l1-batch-data-availability',
    version: 1,
    batchHash: options.batchHash,
    status,
    tipHeight,
    startHeight: options.startHeight,
    requiredConfirmations: options.requiredConfirmations,
    ...(anchor === undefined ? {} : { anchor }),
    fragments,
    missingTxids,
    reorganizedTxids,
    orphanedTxids,
    ...(reconstructedBytes === undefined ? {} : { reconstructedBytes }),
    ...(fragmentCount === undefined ? {} : { fragmentCount }),
  }
}
