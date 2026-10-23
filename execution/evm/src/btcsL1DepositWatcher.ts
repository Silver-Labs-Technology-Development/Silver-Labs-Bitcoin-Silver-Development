import { ProtocolError } from './blockProcessor.js'
import { lstat, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { withChainDirectoryLock } from './chainDirectoryLock.js'
import {
  BTCS_L1_DEPOSIT_MAGIC_HEX,
  decodeBtcsL1DepositScript,
} from './btcsL1Deposit.js'
import type { BtcsL1DepositRpc } from './btcsL1Deposit.js'
import {
  BtcsL1DepositWatchStore,
  type BtcsL1DepositWatchConfig,
  type WatchedBlock,
} from './btcsL1DepositWatchStore.js'
import type { BtcsL1DepositStore } from './btcsL1DepositStore.js'
import type { BtcsL1CoreRpcClient } from './btcsL1CoreRpc.js'
import {
  invalidateBtcsL1DepositAfterConfirmedReorg,
  verifyAndRecordBtcsL1Deposit,
} from './btcsL1DepositWorkflow.js'
import {
  DEPOSIT_RECOVERY_GATE_FORMAT,
  DEPOSIT_RECOVERY_GATE_VERSION,
  readDepositRecoveryGate,
  writeDepositRecoveryGate,
} from './depositRecoveryGate.js'

const HASH_RE = /^[0-9a-f]{64}$/
const SCRIPT_RE = /^(?:[0-9a-f]{2})+$/
const SATOSHIS_PER_COIN = 100_000_000

export type BtcsL1DepositWatcherRpc = BtcsL1DepositRpc & Readonly<{
  getBlockchainInfo(): Promise<unknown>
  getBlockHash(height: number): Promise<unknown>
  getBlock(blockHash: string): Promise<unknown>
}>

export class BtcsL1DepositWatcherError extends ProtocolError {
  override name = 'BtcsL1DepositWatcherError'
}

export class BtcsL1DepositWatcherDeepReorgError extends BtcsL1DepositWatcherError {
  override name = 'BtcsL1DepositWatcherDeepReorgError'
}

export type BtcsL1DepositWatchReport = Readonly<{
  chain: 'regtest'
  tipHeight: number
  scannedThroughHeight: number
  caughtUp: boolean
  discoveredDepositIds: readonly string[]
  reobservedDepositIds: readonly string[]
  invalidatedDepositIds: readonly string[]
  confirmationUpdates: number
  ignoredCandidateTransactions: number
  commonAncestorHeight?: number
}>

type ReleaseDirectoryLock = () => Promise<void>

/**
 * Hold the cursor directory's OS lock for the watcher's full lifetime. The
 * directory must be dedicated to this watcher; this keeps two processes from
 * racing cursor updates or recording conflicting reorg decisions.
 */
async function acquireDirectoryLock(
  directory: string,
  label: string,
  createDirectory: boolean,
): Promise<ReleaseDirectoryLock> {
  const absoluteDirectory = resolve(directory)
  if (createDirectory) {
    await mkdir(absoluteDirectory, { recursive: true, mode: 0o700 })
  } else {
    const info = await lstat(absoluteDirectory)
    if (!info.isDirectory() || info.isSymbolicLink()) {
      throw new BtcsL1DepositWatcherError(label + ' directory must be a real directory')
    }
  }

  let signalAcquired!: () => void
  let rejectAcquired!: (error: unknown) => void
  let releaseOperation!: () => void
  const acquired = new Promise<void>((resolvePromise, rejectPromise) => {
    signalAcquired = resolvePromise
    rejectAcquired = rejectPromise
  })
  const held = withChainDirectoryLock(absoluteDirectory, async () => {
    await new Promise<void>((resolvePromise) => {
      releaseOperation = resolvePromise
      signalAcquired()
    })
  }, 0)
  void held.catch(rejectAcquired)
  await acquired

  let released = false
  return async () => {
    if (released) return
    released = true
    releaseOperation()
    await held
  }
}

type BlockRecord = Record<string, unknown>

function asRecord(value: unknown, label: string): BlockRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BtcsL1DepositWatcherError(label + ' is malformed')
  }
  return value as BlockRecord
}

function blockHash(value: unknown, label: string): string {
  if (typeof value !== 'string' || !HASH_RE.test(value)) {
    throw new BtcsL1DepositWatcherError(label + ' must be a 64-character lowercase hash')
  }
  return value
}

function coreHeight(info: unknown): { chain: 'regtest'; blocks: number } {
  const result = asRecord(info, 'BTCS Core chain info')
  if (result.chain !== 'regtest') {
    throw new BtcsL1DepositWatcherError(
      'deposit watcher requires chain=regtest; refusing to scan another BTCS network',
    )
  }
  if (!Number.isSafeInteger(result.blocks) || (result.blocks as number) < 0) {
    throw new BtcsL1DepositWatcherError('BTCS Core returned an invalid active-chain height')
  }
  return { chain: 'regtest', blocks: result.blocks as number }
}

function normalizeScript(value: unknown): string | undefined {
  if (typeof value !== 'string' || !SCRIPT_RE.test(value)) return undefined
  return value
}

function isPositiveWholeSatoshi(value: unknown): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false
  const scaled = value * SATOSHIS_PER_COIN
  const rounded = Math.round(scaled)
  return Number.isSafeInteger(rounded) && rounded > 0 && Math.abs(scaled - rounded) <= 0.00001
}

type DepositCandidate = Readonly<{
  txid: string
  recipientAddress: string
  depositOutputIndex: number
}>

function depositCandidate(
  transactionValue: unknown,
  depositScriptPubKeyHex: string,
): DepositCandidate | undefined {
  const transaction = asRecord(transactionValue, 'block transaction')
  if (typeof transaction.txid !== 'string' || !HASH_RE.test(transaction.txid)) {
    return undefined
  }
  if (!Array.isArray(transaction.vout)) return undefined

  const intents: Array<{ recipientAddress: string; value: unknown }> = []
  const paymentOutputs: Array<{ index: number; value: unknown }> = []
  let malformedIntent = false

  for (const outputValue of transaction.vout) {
    const output = asRecord(outputValue, 'transaction output')
    const scriptPubKey = asRecord(output.scriptPubKey, 'transaction output script')
    const script = normalizeScript(scriptPubKey.hex)
    if (script === undefined) return undefined

    if (script.includes(BTCS_L1_DEPOSIT_MAGIC_HEX)) {
      try {
        const intent = decodeBtcsL1DepositScript(script)
        intents.push({ recipientAddress: intent.recipientAddress, value: output.value })
      } catch {
        malformedIntent = true
      }
    }
    if (script === depositScriptPubKeyHex) {
      if (!Number.isSafeInteger(output.n) || (output.n as number) < 0) return undefined
      paymentOutputs.push({ index: output.n as number, value: output.value })
    }
  }

  if (
    malformedIntent ||
    intents.length !== 1 ||
    intents[0] === undefined ||
    intents[0].value !== 0 ||
    paymentOutputs.length !== 1 ||
    paymentOutputs[0] === undefined ||
    !isPositiveWholeSatoshi(paymentOutputs[0].value)
  ) {
    return undefined
  }

  return {
    txid: transaction.txid,
    recipientAddress: intents[0].recipientAddress,
    depositOutputIndex: paymentOutputs[0].index,
  }
}

function sameBlock(left: WatchedBlock, right: WatchedBlock): boolean {
  return left.height === right.height && left.hash === right.hash
}

function asBlockHashResponse(value: unknown, height: number): string {
  return blockHash(value, 'getblockhash(' + height + ') response')
}

export class BtcsL1DepositWatcher {
  private polling = false
  private closed = false

  private constructor(
    private readonly rpc: BtcsL1DepositWatcherRpc,
    private readonly deposits: BtcsL1DepositStore,
    private readonly cursor: BtcsL1DepositWatchStore,
    private readonly config: BtcsL1DepositWatchConfig,
    private readonly maxBlocksPerPoll: number,
    private readonly releaseDirectoryLocks: ReleaseDirectoryLock,
    private readonly chainDirectory?: string,
  ) {}

  static async create(options: Readonly<{
    rpc: BtcsL1DepositWatcherRpc
    deposits: BtcsL1DepositStore
    cursorDirectory: string
    depositScriptPubKeyHex: string
    requiredConfirmations: number
    startHeight: number
    reorgWindowBlocks?: number
    maxBlocksPerPoll?: number
    /** When set, a deep reorg durably freezes this L2 chain store. */
    chainDirectory?: string
  }>): Promise<BtcsL1DepositWatcher> {
    const config = makeConfig(options)
    const cursorDirectory = resolve(options.cursorDirectory)
    const depositStoreDirectory = resolve(options.deposits.directoryPath)
    if (cursorDirectory === depositStoreDirectory) {
      throw new BtcsL1DepositWatcherError('cursor and deposit store require separate directories')
    }
    const releaseCursorLock = await acquireDirectoryLock(
      cursorDirectory,
      'deposit watcher cursor',
      true,
    )
    let releaseDepositStoreLock: ReleaseDirectoryLock | undefined
    try {
      releaseDepositStoreLock = await acquireDirectoryLock(
        depositStoreDirectory,
        'deposit store',
        false,
      )
      const height = coreHeight(await options.rpc.getBlockchainInfo()).blocks
      if (height < config.startHeight - 1) {
        throw new BtcsL1DepositWatcherError('BTCS active chain is below the configured watcher start height')
      }
      const initialHash = asBlockHashResponse(
        await options.rpc.getBlockHash(config.startHeight - 1),
        config.startHeight - 1,
      )
      const cursor = await BtcsL1DepositWatchStore.create(
        options.cursorDirectory,
        config,
        initialHash,
      )
      return new BtcsL1DepositWatcher(
        options.rpc,
        options.deposits,
        cursor,
        config,
        options.maxBlocksPerPoll ?? 10_000,
        async () => {
          try {
            await releaseDepositStoreLock!()
          } finally {
            await releaseCursorLock()
          }
        },
        options.chainDirectory === undefined
          ? undefined
          : resolve(options.chainDirectory),
      )
    } catch (error) {
      try {
        await releaseDepositStoreLock?.()
      } finally {
        await releaseCursorLock()
      }
      throw error
    }
  }

  static async open(options: Readonly<{
    rpc: BtcsL1DepositWatcherRpc
    deposits: BtcsL1DepositStore
    cursorDirectory: string
    depositScriptPubKeyHex: string
    requiredConfirmations: number
    startHeight: number
    reorgWindowBlocks?: number
    maxBlocksPerPoll?: number
    /** When set, a deep reorg durably freezes this L2 chain store. */
    chainDirectory?: string
  }>): Promise<BtcsL1DepositWatcher> {
    const config = makeConfig(options)
    const cursorDirectory = resolve(options.cursorDirectory)
    const depositStoreDirectory = resolve(options.deposits.directoryPath)
    if (cursorDirectory === depositStoreDirectory) {
      throw new BtcsL1DepositWatcherError('cursor and deposit store require separate directories')
    }
    const releaseCursorLock = await acquireDirectoryLock(
      cursorDirectory,
      'deposit watcher cursor',
      false,
    )
    let releaseDepositStoreLock: ReleaseDirectoryLock | undefined
    try {
      releaseDepositStoreLock = await acquireDirectoryLock(
        depositStoreDirectory,
        'deposit store',
        false,
      )
      return new BtcsL1DepositWatcher(
        options.rpc,
        options.deposits,
        await BtcsL1DepositWatchStore.open(options.cursorDirectory, config),
        config,
        options.maxBlocksPerPoll ?? 10_000,
        async () => {
          try {
            await releaseDepositStoreLock!()
          } finally {
            await releaseCursorLock()
          }
        },
        options.chainDirectory === undefined
          ? undefined
          : resolve(options.chainDirectory),
      )
    } catch (error) {
      try {
        await releaseDepositStoreLock?.()
      } finally {
        await releaseCursorLock()
      }
      throw error
    }
  }

  async close(): Promise<void> {
    if (this.polling) {
      throw new BtcsL1DepositWatcherError('cannot close the deposit watcher while a poll is running')
    }
    if (this.closed) return
    this.closed = true
    await this.releaseDirectoryLocks()
  }

  async pollOnce(): Promise<BtcsL1DepositWatchReport> {
    if (this.closed) throw new BtcsL1DepositWatcherError('deposit watcher is closed')
    if (this.polling) throw new BtcsL1DepositWatcherError('a deposit watcher poll is already running')
    this.polling = true
    try {
      return await this.pollUnlocked()
    } finally {
      this.polling = false
    }
  }

  private async pollUnlocked(): Promise<BtcsL1DepositWatchReport> {
    const tip = coreHeight(await this.rpc.getBlockchainInfo())
    const invalidatedDepositIds: string[] = []
    const discoveredDepositIds: string[] = []
    const reobservedDepositIds: string[] = []
    let confirmationUpdates = 0
    let ignoredCandidateTransactions = 0
    let commonAncestorHeight: number | undefined

    const initialHistory = this.cursor.snapshot.history
    const cursorTip = initialHistory.at(-1)!
    const activeCursorHash = cursorTip.height <= tip.blocks
      ? asBlockHashResponse(await this.rpc.getBlockHash(cursorTip.height), cursorTip.height)
      : undefined

    if (activeCursorHash !== cursorTip.hash) {
      const ancestor = await this.findCommonAncestor(initialHistory, tip.blocks)
      if (ancestor === undefined) {
        await this.freezeChainAfterDeepReorg(cursorTip.height)
        throw new BtcsL1DepositWatcherDeepReorgError(
          'active chain diverged deeper than the retained watcher history; cursor and deposits were not changed',
        )
      }
      commonAncestorHeight = ancestor.height
      for (const record of this.deposits.list()) {
        if (
          record.state === 'confirmed' &&
          record.blockHeight !== undefined &&
          record.blockHeight > ancestor.height &&
          record.blockHash !== undefined
        ) {
          await invalidateBtcsL1DepositAfterConfirmedReorg(
            this.deposits,
            record.depositId,
            record.blockHash,
          )
          invalidatedDepositIds.push(record.depositId)
        }
      }
      await this.cursor.rewindTo(ancestor.height, ancestor.hash)
    }

    confirmationUpdates += await this.refreshExistingConfirmations(invalidatedDepositIds)

    const matureHeight = tip.blocks - this.config.requiredConfirmations + 1
    const targetHeight = Math.max(this.config.startHeight - 1, matureHeight)
    const scanThrough = Math.min(
      targetHeight,
      this.cursor.cursorHeight + this.maxBlocksPerPoll,
    )
    const scanFrom = this.cursor.cursorHeight + 1

    for (let height = scanFrom; height <= scanThrough; height += 1) {
      const hash = asBlockHashResponse(await this.rpc.getBlockHash(height), height)
      const block = asRecord(await this.rpc.getBlock(hash), 'block at height ' + height)
      if (blockHash(block.hash, 'block hash') !== hash || block.height !== height) {
        throw new BtcsL1DepositWatcherError('Core block response does not match the requested active-chain height')
      }
      if (!Array.isArray(block.tx)) {
        throw new BtcsL1DepositWatcherError('Core block response has no transaction array')
      }
      for (const transaction of block.tx) {
        const candidate = depositCandidate(transaction, this.config.depositScriptPubKeyHex)
        if (candidate === undefined) {
          const txRecord = typeof transaction === 'object' && transaction !== null
            ? transaction as Record<string, unknown>
            : undefined
          if (
            typeof txRecord?.txid === 'string' &&
            Array.isArray(txRecord.vout) &&
            txRecord.vout.some((out: unknown) => {
              if (typeof out !== 'object' || out === null) return false
              const script = (out as Record<string, unknown>).scriptPubKey
              if (typeof script !== 'object' || script === null) return false
              const hex = (script as Record<string, unknown>).hex
              return typeof hex === 'string' && hex.includes(BTCS_L1_DEPOSIT_MAGIC_HEX)
            })
          ) {
            ignoredCandidateTransactions += 1
          }
          continue
        }
        const depositId = candidate.txid + ':' + candidate.depositOutputIndex
        const previous = this.deposits.get(depositId)
        const record = await verifyAndRecordBtcsL1Deposit(this.rpc, this.deposits, {
          txid: candidate.txid,
          blockHash: hash,
          recipientAddress: candidate.recipientAddress,
          depositScriptPubKeyHex: this.config.depositScriptPubKeyHex,
          requiredConfirmations: this.config.requiredConfirmations,
        })
        if (previous === undefined) discoveredDepositIds.push(record.depositId)
        else if (previous.state === 'invalidated') reobservedDepositIds.push(record.depositId)
        else if ((record.confirmations ?? 0) > (previous.confirmations ?? 0)) {
          confirmationUpdates += 1
        }
      }
      await this.cursor.appendBlock(height, hash)
    }

    const unresolvedInvalidations = this.chainDirectory === undefined
      ? []
      : this.deposits
          .list()
          .filter((record) => record.state === 'invalidated')
          .map((record) => record.depositId)
          .sort()
    if (unresolvedInvalidations.length > 0) {
      await this.freezeChainAfterInvalidatedDeposit(
        unresolvedInvalidations,
        tip.blocks,
      )
    }

    return {
      chain: tip.chain,
      tipHeight: tip.blocks,
      scannedThroughHeight: this.cursor.cursorHeight,
      caughtUp: this.cursor.cursorHeight >= targetHeight,
      discoveredDepositIds,
      reobservedDepositIds,
      invalidatedDepositIds,
      confirmationUpdates,
      ignoredCandidateTransactions,
      ...(commonAncestorHeight === undefined ? {} : { commonAncestorHeight }),
    }
  }

  private async freezeChainAfterInvalidatedDeposit(
    depositIds: readonly string[],
    engagedAtHeight: number,
  ): Promise<void> {
    if (this.chainDirectory === undefined) return
    const existing = await readDepositRecoveryGate(this.chainDirectory)
      .catch(() => undefined)
    if (existing !== undefined) return
    await writeDepositRecoveryGate(this.chainDirectory, {
      format: DEPOSIT_RECOVERY_GATE_FORMAT,
      version: DEPOSIT_RECOVERY_GATE_VERSION,
      status: 'frozen',
      reason:
        'confirmed BTCS L1 deposit inclusion was invalidated and not re-included; L2 recovery required',
      involvedDepositIds: [...depositIds].sort(),
      engagedAtHeight: engagedAtHeight.toString(10),
    })
  }

  private async freezeChainAfterDeepReorg(engagedAtHeight: number): Promise<void> {
    if (this.chainDirectory === undefined) return
    const involvedDepositIds = this.deposits
      .list()
      .filter((record) => record.state === 'confirmed')
      .map((record) => record.depositId)
      .sort()
    await writeDepositRecoveryGate(this.chainDirectory, {
      format: DEPOSIT_RECOVERY_GATE_FORMAT,
      version: DEPOSIT_RECOVERY_GATE_VERSION,
      status: 'frozen',
      reason:
        'BTCS L1 active chain diverged deeper than retained watcher history; operator recovery required',
      involvedDepositIds,
      engagedAtHeight: engagedAtHeight.toString(10),
    })
  }

  private async findCommonAncestor(
    history: readonly WatchedBlock[],
    activeTipHeight: number,
  ): Promise<WatchedBlock | undefined> {
    for (let index = history.length - 1; index >= 0; index -= 1) {
      const candidate = history[index]!
      if (candidate.height > activeTipHeight) continue
      const activeHash = asBlockHashResponse(
        await this.rpc.getBlockHash(candidate.height),
        candidate.height,
      )
      if (activeHash === candidate.hash) return candidate
    }
    return undefined
  }

  private async refreshExistingConfirmations(invalidatedIds: string[]): Promise<number> {
    const invalidated = new Set(invalidatedIds)
    let updates = 0
    for (const record of this.deposits.list()) {
      if (
        record.state !== 'confirmed' ||
        record.blockHash === undefined ||
        record.blockHeight === undefined ||
        invalidated.has(record.depositId)
      ) {
        continue
      }
      const header = asRecord(
        await this.rpc.getBlockHeader(record.blockHash),
        'stored deposit block header',
      )
      if (header.hash !== record.blockHash || !Number.isSafeInteger(header.confirmations)) {
        throw new BtcsL1DepositWatcherError('Core returned malformed deposit block confirmation data')
      }
      if ((header.confirmations as number) < 0) {
        const invalidatedRecord = await invalidateBtcsL1DepositAfterConfirmedReorg(
          this.deposits,
          record.depositId,
          record.blockHash,
        )
        invalidated.add(invalidatedRecord.depositId)
        invalidatedIds.push(invalidatedRecord.depositId)
        continue
      }
      if ((header.confirmations as number) <= (record.confirmations ?? 0)) continue
      const next = await verifyAndRecordBtcsL1Deposit(this.rpc, this.deposits, {
        txid: record.txid,
        blockHash: record.blockHash,
        recipientAddress: record.recipientAddress,
        depositScriptPubKeyHex: this.config.depositScriptPubKeyHex,
        requiredConfirmations: record.requiredConfirmations,
      })
      if ((next.confirmations ?? 0) > (record.confirmations ?? 0)) updates += 1
    }
    return updates
  }
}

function makeConfig(options: Readonly<{
  depositScriptPubKeyHex: string
  requiredConfirmations: number
  startHeight: number
  reorgWindowBlocks?: number
  maxBlocksPerPoll?: number
}>): BtcsL1DepositWatchConfig {
  const config = {
    depositScriptPubKeyHex: options.depositScriptPubKeyHex,
    requiredConfirmations: options.requiredConfirmations,
    startHeight: options.startHeight,
    reorgWindowBlocks: options.reorgWindowBlocks ?? 288,
  }
  if (
    options.maxBlocksPerPoll !== undefined &&
    (!Number.isSafeInteger(options.maxBlocksPerPoll) || options.maxBlocksPerPoll < 1)
  ) {
    throw new BtcsL1DepositWatcherError('max blocks per poll must be a positive safe integer')
  }
  validateWatchConfig(config)
  return config
}

function validateWatchConfig(config: BtcsL1DepositWatchConfig): void {
  // Keep the persistent store as the single source of validation rules.
  if (
    typeof config.depositScriptPubKeyHex !== 'string' ||
    !SCRIPT_RE.test(config.depositScriptPubKeyHex) ||
    config.depositScriptPubKeyHex.startsWith('6a') ||
    !Number.isSafeInteger(config.requiredConfirmations) ||
    config.requiredConfirmations < 1 ||
    !Number.isSafeInteger(config.startHeight) ||
    config.startHeight < 1 ||
    !Number.isSafeInteger(config.reorgWindowBlocks) ||
    config.reorgWindowBlocks < 1 ||
    config.reorgWindowBlocks > 10_000
  ) {
    throw new BtcsL1DepositWatcherError('deposit watcher configuration is invalid')
  }
}

/** Convenience constructor for the authenticated local Core RPC adapter. */
export function createBtcsL1DepositWatcherRpc(
  rpc: BtcsL1CoreRpcClient,
): BtcsL1DepositWatcherRpc {
  return rpc
}
