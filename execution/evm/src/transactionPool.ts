import { createBlockFromRLP } from '@ethereumjs/block'
import type { Address } from '@ethereumjs/util'
import { hexToBytes } from '@ethereumjs/util'
import {
  BLOCK_GAS_LIMIT,
  PersistentBlockProcessor,
  ProtocolError,
  type BlockSummary,
  type CanonicalReadView,
  type ChainTip,
  type ProcessedBlock,
  validateSignedTransactionBytes,
} from './blockProcessor.js'
import { createHarnessCommon } from './config.js'

export const MAX_RAW_TRANSACTION_BYTES = 131_072
export const MAX_PENDING_TRANSACTIONS = 1_024
export const MAX_PENDING_BYTES = 15_728_640
export const MAX_PENDING_TRANSACTIONS_PER_SENDER = 64

const REPLACEMENT_BUMP_NUMERATOR = 110n
const REPLACEMENT_BUMP_DENOMINATOR = 100n

export class TransactionPoolError extends Error {
  override name = 'TransactionPoolError'

  constructor(readonly code: number, message: string) {
    super(message)
  }
}

export type DiscardedPendingTransaction = Readonly<{
  transactionHash: string
  reason: string
}>

export type DevelopmentBlockResult = Readonly<{
  block: BlockSummary
  includedTransactions: readonly string[]
  discardedTransactions: readonly DiscardedPendingTransaction[]
}>

export type DevelopmentSequencerLimits = Readonly<{
  maxPendingTransactions?: number
  maxPendingBytes?: number
  maxPendingTransactionsPerSender?: number
}>

type PendingTransaction = Readonly<{
  serialized: Uint8Array
  transactionHash: string
  sender: string
  senderAddress: Address
  nonce: bigint
  gasLimit: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  value: bigint
  tx: ReturnType<typeof validateSignedTransactionBytes>['tx']
}>

type ReconciliationPlan = Readonly<{
  bySender: Map<string, Map<bigint, PendingTransaction>>
  discarded: readonly DiscardedPendingTransaction[]
}>

function requiredReplacementFee(oldFee: bigint): bigint {
  const bumped = (oldFee * REPLACEMENT_BUMP_NUMERATOR + REPLACEMENT_BUMP_DENOMINATOR - 1n) /
    REPLACEMENT_BUMP_DENOMINATOR
  return bumped > oldFee ? bumped : oldFee + 1n
}

function sameTip(left: ChainTip, right: ChainTip): boolean {
  return left.number === right.number && left.hash === right.hash
}

function maxUpfrontCost(transaction: PendingTransaction): bigint {
  return transaction.gasLimit * transaction.maxFeePerGas + transaction.value
}

function parentBlock(view: CanonicalReadView) {
  const tip = view.report.tip
  const data = view.getCanonicalBlockByNumber(tip.number)
  if (data === undefined) throw new ProtocolError('canonical parent block is missing')
  return createBlockFromRLP(hexToBytes(data.blockRlpHex as `0x${string}`), {
    common: createHarnessCommon(),
  })
}

function nextBaseFee(view: CanonicalReadView): bigint {
  return parentBlock(view).header.calcNextBaseFee()
}

function nextTimestamp(view: CanonicalReadView): bigint {
  return parentBlock(view).header.timestamp + 1n
}

export class DevelopmentSequencer {
  private bySender = new Map<string, Map<bigint, PendingTransaction>>()
  private byHash = new Map<string, PendingTransaction>()
  private pendingBytes = 0
  private lastReconciledTip: ChainTip
  private operationTail: Promise<void> = Promise.resolve()
  private readonly maxPendingTransactions: number
  private readonly maxPendingBytes: number
  private readonly maxPendingTransactionsPerSender: number

  constructor(
    private readonly chain: PersistentBlockProcessor,
    limits: DevelopmentSequencerLimits = {},
  ) {
    this.lastReconciledTip = chain.tip
    this.maxPendingTransactions = this.validateLimit(
      limits.maxPendingTransactions ?? MAX_PENDING_TRANSACTIONS,
      MAX_PENDING_TRANSACTIONS,
      'pending transaction count',
    )
    this.maxPendingBytes = this.validateLimit(
      limits.maxPendingBytes ?? MAX_PENDING_BYTES,
      MAX_PENDING_BYTES,
      'pending byte count',
    )
    this.maxPendingTransactionsPerSender = this.validateLimit(
      limits.maxPendingTransactionsPerSender ?? MAX_PENDING_TRANSACTIONS_PER_SENDER,
      MAX_PENDING_TRANSACTIONS_PER_SENDER,
      'per-sender transaction count',
    )
  }

  private validateLimit(value: number, maximum: number, label: string): number {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new RangeError(`${label} must be between 1 and ${maximum}`)
    }
    return value
  }

  private async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail
    let release!: () => void
    this.operationTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  async submit(rawBytes: Uint8Array): Promise<string> {
    if (rawBytes.length === 0 || rawBytes.length > MAX_RAW_TRANSACTION_BYTES) {
      throw new TransactionPoolError(-32005, 'Raw transaction exceeds the configured size limit')
    }
    const serialized = new Uint8Array(rawBytes)
    let validated: ReturnType<typeof validateSignedTransactionBytes>
    try {
      validated = validateSignedTransactionBytes(serialized, 0n, createHarnessCommon())
    } catch {
      throw new TransactionPoolError(-32010, 'Transaction is invalid for the local chain profile')
    }

    return this.exclusive(async () => {
      const view = await this.chain.createCanonicalReadView()
      if (!sameTip(view.report.tip, this.lastReconciledTip)) {
        throw new TransactionPoolError(
          -32012,
          'Canonical tip changed; call btcs_dev_mine to reconcile pending transactions',
        )
      }
      const baseFee = nextBaseFee(view)
      if (validated.tx.maxFeePerGas < baseFee) {
        throw new TransactionPoolError(-32010, 'Transaction fee cap is below the next block base fee')
      }

      const sender = validated.sender.toString().toLowerCase()
      const states = await view.getAccountStates([validated.sender], view.report.tip.number)
      const state = states[0]
      if (state === undefined) throw new ProtocolError('canonical sender state is missing')
      const senderPool = this.bySender.get(sender) ?? new Map<bigint, PendingTransaction>()
      const previous = senderPool.get(validated.tx.nonce)
      const pendingCount = this.byHash.size
      if (this.byHash.has(validated.hash)) {
        throw new TransactionPoolError(-32010, 'Transaction is already pending')
      }

      const entry: PendingTransaction = {
        serialized,
        transactionHash: validated.hash,
        sender,
        senderAddress: validated.sender,
        nonce: validated.tx.nonce,
        gasLimit: validated.tx.gasLimit,
        maxFeePerGas: validated.tx.maxFeePerGas,
        maxPriorityFeePerGas: validated.tx.maxPriorityFeePerGas,
        value: validated.tx.value,
        tx: validated.tx,
      }

      if (previous !== undefined) {
        if (
          entry.maxFeePerGas < requiredReplacementFee(previous.maxFeePerGas) ||
          entry.maxPriorityFeePerGas < requiredReplacementFee(previous.maxPriorityFeePerGas)
        ) {
          throw new TransactionPoolError(-32011, 'Replacement transaction does not meet the fee bump policy')
        }
      } else {
        const expectedNonce = state.nonce + BigInt(senderPool.size)
        if (entry.nonce !== expectedNonce) {
          throw new TransactionPoolError(-32010, 'Transaction nonce is not the next contiguous pending nonce')
        }
        if (senderPool.size >= this.maxPendingTransactionsPerSender) {
          throw new TransactionPoolError(-32005, 'Per-sender pending transaction limit exceeded')
        }
      }

      const proposed = new Map(senderPool)
      proposed.set(entry.nonce, entry)
      let reservedBalance = 0n
      for (const pending of proposed.values()) reservedBalance += maxUpfrontCost(pending)
      if (reservedBalance > state.balance) {
        throw new TransactionPoolError(-32010, 'Pending transactions exceed the canonical sender balance')
      }

      const byteCountAfterReplacement = this.pendingBytes - (previous?.serialized.length ?? 0) + serialized.length
      const countAfterReplacement = pendingCount + (previous === undefined ? 1 : 0)
      if (countAfterReplacement > this.maxPendingTransactions || byteCountAfterReplacement > this.maxPendingBytes) {
        throw new TransactionPoolError(-32005, 'Pending transaction pool capacity exceeded')
      }

      if (previous !== undefined) this.byHash.delete(previous.transactionHash)
      proposed.set(entry.nonce, entry)
      this.bySender.set(sender, proposed)
      this.byHash.set(entry.transactionHash, entry)
      this.pendingBytes = byteCountAfterReplacement
      return entry.transactionHash
    })
  }

  async produceBlock(): Promise<DevelopmentBlockResult> {
    return this.exclusive(async () => {
      const beforeView = await this.chain.createCanonicalReadView()
      const beforeTip = beforeView.report.tip
      const baseFee = nextBaseFee(beforeView)
      const initialPlan = await this.planReconciliation(beforeView, baseFee)
      const selected = this.selectTransactions(initialPlan.bySender)
      const timestamp = nextTimestamp(beforeView)

      let processed: ProcessedBlock | undefined
      let postError: unknown
      try {
        processed = await this.chain.buildNextBlock(selected.map((entry) => entry.tx), timestamp)
      } catch (error) {
        postError = error
      }

      const verifiedView = await this.chain.createCanonicalReadView()
      const attemptedBlock = this.findAttemptedBlock(
        verifiedView,
        beforeTip,
        timestamp,
        selected,
      )
      if (attemptedBlock === undefined) {
        if (postError !== undefined) {
          throw new TransactionPoolError(-32013, 'Development block production failed; pending transactions remain')
        }
        throw new ProtocolError('produced block is not present in verified canonical history')
      }
      if (processed !== undefined && processed.summary.hash !== attemptedBlock.summary.hash) {
        throw new ProtocolError('block processor result disagrees with canonical replay')
      }

      this.installPlan(initialPlan)
      for (const entry of selected) this.removePending(entry)
      const postBaseFee = nextBaseFee(verifiedView)
      const postPlan = await this.planReconciliation(verifiedView, postBaseFee)
      this.installPlan(postPlan)
      this.lastReconciledTip = verifiedView.report.tip

      return {
        block: attemptedBlock.summary,
        includedTransactions: selected.map((entry) => entry.transactionHash),
        discardedTransactions: [...initialPlan.discarded, ...postPlan.discarded],
      }
    })
  }

  private findAttemptedBlock(
    view: CanonicalReadView,
    beforeTip: ChainTip,
    timestamp: bigint,
    selected: readonly PendingTransaction[],
  ): { summary: BlockSummary } | undefined {
    const expectedNumber = beforeTip.number + 1n
    if (expectedNumber > BigInt(Number.MAX_SAFE_INTEGER)) return undefined
    const summary = view.report.blocks[Number(expectedNumber)]
    if (
      summary === undefined ||
      summary.parentHash !== beforeTip.hash ||
      summary.timestamp !== timestamp.toString() ||
      summary.receipts.length !== selected.length ||
      summary.receipts.some((receipt, index) => receipt.transactionHash !== selected[index]?.transactionHash)
    ) {
      return undefined
    }
    return { summary }
  }

  private selectTransactions(
    pendingBySender: Map<string, Map<bigint, PendingTransaction>>,
  ): PendingTransaction[] {
    const queues = [...pendingBySender.entries()]
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([, transactions]) => [...transactions.values()].sort((left, right) =>
        left.nonce < right.nonce ? -1 : left.nonce > right.nonce ? 1 : 0))
    const cursors = queues.map(() => 0)
    const selected: PendingTransaction[] = []
    let reservedGas = 0n
    let progress = true
    while (progress) {
      progress = false
      for (let index = 0; index < queues.length; index++) {
        const transaction = queues[index]?.[cursors[index] ?? 0]
        if (transaction === undefined) continue
        if (reservedGas + transaction.gasLimit > BLOCK_GAS_LIMIT) {
          cursors[index] = queues[index]?.length ?? 0
          continue
        }
        selected.push(transaction)
        reservedGas += transaction.gasLimit
        cursors[index] = (cursors[index] ?? 0) + 1
        progress = true
      }
    }
    return selected
  }

  private async planReconciliation(
    view: CanonicalReadView,
    baseFee: bigint,
  ): Promise<ReconciliationPlan> {
    const senders = [...this.bySender.keys()].sort()
    if (senders.length === 0) return { bySender: new Map(), discarded: [] }
    const addresses = senders.map((sender) => this.bySender.get(sender)?.values().next().value?.senderAddress)
    if (addresses.some((address) => address === undefined)) {
      throw new ProtocolError('pending sender address is missing')
    }
    const states = await view.getAccountStates(
      addresses as Address[],
      view.report.tip.number,
    )
    const bySender = new Map<string, Map<bigint, PendingTransaction>>()
    const discarded: DiscardedPendingTransaction[] = []

    for (let index = 0; index < senders.length; index++) {
      const sender = senders[index]!
      const state = states[index]
      if (state === undefined) throw new ProtocolError('canonical pending sender state is missing')
      const oldEntries = this.bySender.get(sender)
      if (oldEntries === undefined) continue
      const entries = [...oldEntries.values()].sort((left, right) =>
        left.nonce < right.nonce ? -1 : left.nonce > right.nonce ? 1 : 0)
      const kept = new Map<bigint, PendingTransaction>()
      for (const entry of entries) {
        if (entry.nonce < state.nonce) {
          discarded.push({ transactionHash: entry.transactionHash, reason: 'nonce-consumed-by-canonical-chain' })
        } else {
          kept.set(entry.nonce, entry)
        }
      }

      let expectedNonce = state.nonce
      let invalidAt: bigint | undefined
      for (const entry of kept.values()) {
        if (entry.nonce !== expectedNonce) {
          invalidAt = entry.nonce
          discarded.push({ transactionHash: entry.transactionHash, reason: 'nonce-gap-after-canonical-change' })
          break
        }
        if (entry.maxFeePerGas < baseFee) {
          invalidAt = entry.nonce
          discarded.push({ transactionHash: entry.transactionHash, reason: 'max-fee-below-next-base-fee' })
          break
        }
        expectedNonce += 1n
      }
      if (invalidAt !== undefined) {
        for (const [nonce, entry] of kept) {
          if (nonce > invalidAt) {
            discarded.push({ transactionHash: entry.transactionHash, reason: 'blocked-by-earlier-pending-transaction' })
            kept.delete(nonce)
          }
        }
        kept.delete(invalidAt)
      }

      let reservedBalance = 0n
      for (const entry of kept.values()) reservedBalance += maxUpfrontCost(entry)
      const remaining = [...kept.values()].sort((left, right) =>
        left.nonce > right.nonce ? -1 : left.nonce < right.nonce ? 1 : 0)
      while (reservedBalance > state.balance && remaining.length > 0) {
        const entry = remaining.shift()!
        kept.delete(entry.nonce)
        reservedBalance -= maxUpfrontCost(entry)
        discarded.push({
          transactionHash: entry.transactionHash,
          reason: 'insufficient-balance-after-canonical-change',
        })
      }
      if (kept.size > 0) bySender.set(sender, kept)
    }
    return { bySender, discarded }
  }

  private installPlan(plan: ReconciliationPlan): void {
    this.bySender = new Map([...plan.bySender.entries()].map(([sender, entries]) => [sender, new Map(entries)]))
    this.byHash.clear()
    this.pendingBytes = 0
    for (const entries of this.bySender.values()) {
      for (const entry of entries.values()) {
        this.byHash.set(entry.transactionHash, entry)
        this.pendingBytes += entry.serialized.length
      }
    }
  }

  private removePending(entry: PendingTransaction): void {
    const senderEntries = this.bySender.get(entry.sender)
    if (senderEntries?.get(entry.nonce)?.transactionHash !== entry.transactionHash) return
    senderEntries.delete(entry.nonce)
    if (senderEntries.size === 0) this.bySender.delete(entry.sender)
    this.byHash.delete(entry.transactionHash)
    this.pendingBytes -= entry.serialized.length
  }
}
