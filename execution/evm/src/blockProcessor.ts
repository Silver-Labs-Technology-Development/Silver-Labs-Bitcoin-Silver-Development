import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { createBlock, createBlockFromRLP } from '@ethereumjs/block'
import type { Block } from '@ethereumjs/block'
import { createFeeMarket1559TxFromRLP } from '@ethereumjs/tx'
import type { FeeMarket1559Tx, TypedTransaction } from '@ethereumjs/tx'
import {
  Account,
  Address,
  KECCAK256_RLP,
  KECCAK256_RLP_ARRAY,
  SHA256_NULL,
  bytesToHex,
  createAccount,
  createZeroAddress,
  equalsBytes,
  hexToBytes,
  unprefixedHexToBytes,
} from '@ethereumjs/util'
import { getActivePrecompiles } from '@ethereumjs/evm'
import type { EVMResult, EVMMockBlockchainInterface, Message } from '@ethereumjs/evm'
import { buildBlock, createVM, encodeReceipt, runBlock } from '@ethereumjs/vm'
import type { RunBlockResult, RunTxResult } from '@ethereumjs/vm'
import { createStateCheckpoint, openDurableStateManager } from './stateCheckpoint.js'
import type { StateCheckpointManifest } from './stateCheckpoint.js'
import {
  DEFAULT_CHAIN_DIRECTORY_LOCK_TIMEOUT_MS,
  withChainDirectoryLock,
} from './chainDirectoryLock.js'
import {
  EVM_CHAIN_ID,
  EVM_HARDFORK,
  GENESIS_BALANCE,
  SENDER_ADDRESS,
  createHarnessCommon,
} from './config.js'
import {
  encodeEvmDepositPreludeExtraData,
  normalizeEvmDepositOperations,
  verifyEvmDepositPrelude,
  type EvmDepositOperation,
} from './depositPrelude.js'
import {
  assertDepositRecoveryOpen,
  clearDepositRecoveryGate,
  readDepositRecoveryGate,
} from './depositRecoveryGate.js'

export const LOCAL_CHAIN_PROFILE = 'btcs-l2-local-v0.12-deposit-prelude'
export const STORE_SCHEMA_VERSION = 2
export const PROTOCOL_VERSION = '0.12-draft.1'
export const BLOCK_GAS_LIMIT = 30_000_000n
export const GENESIS_TIMESTAMP = 1_749_999_999n
export const GENESIS_BASE_FEE = 1_000_000_000n
export const MAX_SERIALIZED_BLOCK_BYTES = 16_777_216
export const MAX_BLOCK_RECORD_BYTES = 67_108_864
export const MAX_TRANSACTIONS_PER_BLOCK = 4_096

const MAX_U64 = (1n << 64n) - 1n
const MAX_EVM_BALANCE = (1n << 256n) - 1n
const MAX_BLOCK_NUMBER = BigInt(Number.MAX_SAFE_INTEGER)
const ZERO32 = new Uint8Array(32)
const ZERO8 = new Uint8Array(8)
const ZERO_ADDRESS = createZeroAddress()
const MAX_CHAIN_METADATA_BYTES = 64 * 1024
const MAX_BLOCKHASH_HISTORY = 256
const EJS_VERSION = '10.1.3'

export class ProtocolError extends Error {
  override name = 'ProtocolError'
}

export type ChainTip = Readonly<{ number: bigint; hash: string }>

export type LogRecord = Readonly<{
  address: string
  topics: readonly string[]
  data: string
}>

export type TransactionOutcome = Readonly<{
  transactionHash: string
  status: 0 | 1
  gasUsed: string
  cumulativeGasUsed: string
  returnData: string
  createdAddress?: string
  logs: readonly LogRecord[]
}>

export type BlockSummary = Readonly<{
  number: string
  hash: string
  parentHash: string
  timestamp: string
  gasLimit: string
  gasUsed: string
  baseFeePerGas: string
  transactionsRoot: string
  receiptsRoot: string
  stateRoot: string
  requestsRoot: string
  receipts: readonly TransactionOutcome[]
}>

export type ProcessedBlock = Readonly<{
  blockRlpHex: string
  summary: BlockSummary
}>

export type ReplayReport = Readonly<{
  tip: ChainTip
  genesisStateRoot: string
  blocks: readonly BlockSummary[]
}>

export type CanonicalBlockData = Readonly<{
  blockRlpHex: string
  summary: BlockSummary
}>

export type CanonicalReceiptData = Readonly<{
  block: CanonicalBlockData
  transactionRlpHex: string
  transactionIndex: number
  outcome: TransactionOutcome
}>

export type PersistentBlockProcessorOptions = Readonly<{
  /** Backward-compatible failpoint after the block record is durable and before the tip changes. */
  beforeTipCommit?: () => void | Promise<void>
  /** Test-only persistence failpoint. Production callers should leave this unset. */
  persistenceTestHook?: (stage: PersistenceStage) => void | Promise<void>
  /** Maximum wait for another process using the same chain directory. */
  chainDirectoryLockTimeoutMs?: number
}>

export type PersistenceStage =
  | 'before-block-record-write'
  | 'block-record-temp-opened'
  | 'block-record-temp-partially-written'
  | 'block-record-temp-written'
  | 'block-record-file-synced'
  | 'before-block-record-rename'
  | 'block-record-renamed'
  | 'block-record-before-directory-sync'
  | 'block-record-directory-synced'
  | 'after-block-record-durable'
  | 'before-tip-update'
  | 'tip-temp-opened'
  | 'tip-temp-partially-written'
  | 'tip-temp-written'
  | 'tip-file-synced'
  | 'before-tip-rename'
  | 'tip-renamed'
  | 'tip-before-directory-sync'
  | 'tip-durable'
  | 'after-tip-commit'

type BlockRecord = {
  format: 'btcs-l2-block-record'
  schemaVersion: number
  blockHash: string
  height: string
  blockRlpHex: string
  receiptRlpHexes: string[]
  outcomes: TransactionOutcome[]
  depositOperations: EvmDepositOperation[]
}

type ChainMetadata = {
  format: 'btcs-l2-local-chain'
  schemaVersion: number
  protocolVersion: string
  profileId: string
  chainId: string
  hardfork: string
  ethereumjsVersion: string
  genesisConfigHash: string
  genesisHash: string
  canonicalHeight: string
  canonicalTipHash: string
}

export type ReplayStateManager = Awaited<ReturnType<typeof openDurableStateManager>>['stateManager']

type ReplaySession = {
  vm: Awaited<ReturnType<typeof createVM>>
  common: ReturnType<typeof createHarnessCommon>
  blocks: Block[]
  records: Array<{ block: Block; record: BlockRecord }>
  spendActivityByAddress: Map<string, CanonicalSpendActivity>
  spendTraceComplete: boolean
  report: ReplayReport
}

export type CanonicalSpendActivity = Readonly<{
  blockNumber: bigint
  transactionIndex?: number
  transactionHash?: string
  kind: 'native-value' | 'transaction-fee' | 'selfdestruct'
  amountWei?: string
}>

/**
 * A request-scoped view of one fully replayed canonical chain snapshot.
 * It retains no persistent cache and must not outlive the caller's request.
 */
export class CanonicalReadView {
  private stateQueryTail: Promise<void> = Promise.resolve()

  constructor(private readonly session: ReplaySession) {}

  get report(): ReplayReport {
    return this.session.report
  }

  /**
   * Return the latest replay-observed native-value outflow, fee payment, or
   * selfdestruct by an address at or after the block where its deposit credit
   * was applied. This is conservative address-level evidence: EVM balances are
   * fungible, so it does not claim which individual credit funded the outflow.
   */
  getSpendActivitySince(
    address: string,
    creditedAtBlock: bigint,
  ): CanonicalSpendActivity | undefined {
    if (creditedAtBlock < 0n || creditedAtBlock > this.session.report.tip.number) {
      throw new ProtocolError('credit block is outside canonical history')
    }
    const normalizedAddress = lowerHex(address, 'spend recipient address', 20)
    const activity = this.session.spendActivityByAddress.get(normalizedAddress)
    return activity !== undefined && activity.blockNumber >= creditedAtBlock
      ? { ...activity }
      : undefined
  }

  /** True only when every canonical block's transaction execution was traced. */
  get spendTraceComplete(): boolean {
    return this.session.spendTraceComplete
  }

  getCanonicalBlockByNumber(blockNumber: bigint): CanonicalBlockData | undefined {
    if (blockNumber < 0n || blockNumber > MAX_BLOCK_NUMBER) {
      throw new ProtocolError('block number is outside the supported range')
    }
    const index = Number(blockNumber)
    const block = this.session.blocks[index]
    const summary = this.session.report.blocks[index]
    if (block === undefined || summary === undefined) return undefined
    return { blockRlpHex: asBytesHex(block.serialize()), summary }
  }

  /** Return the committed deposit operations for one canonical block. */
  getCanonicalDepositOperations(blockNumber: bigint): readonly EvmDepositOperation[] {
    if (blockNumber < 0n || blockNumber > this.session.report.tip.number) {
      throw new ProtocolError('deposit-operation block number is outside canonical history')
    }
    const item = this.session.records[Number(blockNumber)]
    if (item === undefined) {
      throw new ProtocolError('canonical deposit-operation record is missing')
    }
    return item.record.depositOperations.map((operation) => ({ ...operation }))
  }

  /**
   * Return operations from genesis through a selected canonical height.
   * Checkpoint continuation uses this to prevent re-crediting older deposits.
   */
  getCanonicalDepositOperationsThroughHeight(
    blockNumber: bigint,
  ): readonly EvmDepositOperation[] {
    if (blockNumber < 0n || blockNumber > this.session.report.tip.number) {
      throw new ProtocolError('deposit-operation height is outside canonical history')
    }
    const operations: EvmDepositOperation[] = []
    for (let height = 0n; height <= blockNumber; height += 1n) {
      const item = this.session.records[Number(height)]
      if (item === undefined) {
        throw new ProtocolError('canonical deposit-operation history has a gap')
      }
      operations.push(
        ...item.record.depositOperations.map((operation) => ({ ...operation })),
      )
    }
    return operations
  }

  getCanonicalBlockByHash(blockHash: string): CanonicalBlockData | undefined {
    const expectedHash = lowerHex(blockHash, 'block hash', 32)
    const index = this.session.blocks.findIndex((block) => asBytesHex(block.hash()) === expectedHash)
    return index < 0 ? undefined : this.getCanonicalBlockByNumber(BigInt(index))
  }

  getCanonicalReceiptByTransactionHash(transactionHash: string): CanonicalReceiptData | undefined {
    const expectedHash = lowerHex(transactionHash, 'transaction hash', 32)
    for (let blockIndex = 0; blockIndex < this.session.blocks.length; blockIndex++) {
      const block = this.session.blocks[blockIndex]
      const summary = this.session.report.blocks[blockIndex]
      if (block === undefined || summary === undefined) continue
      for (let transactionIndex = 0; transactionIndex < block.transactions.length; transactionIndex++) {
        const transaction = block.transactions[transactionIndex]
        const outcome = summary.receipts[transactionIndex]
        if (transaction === undefined || outcome === undefined) continue
        if (asBytesHex(transaction.hash()) !== expectedHash) continue
        const canonicalBlock = this.getCanonicalBlockByNumber(BigInt(blockIndex))
        if (canonicalBlock === undefined) throw new ProtocolError('canonical receipt block is missing')
        return {
          block: canonicalBlock,
          transactionRlpHex: asBytesHex(transaction.serialize()),
          transactionIndex,
          outcome,
        }
      }
    }
    return undefined
  }

  getStorage(address: Address, slot: Uint8Array, blockNumber?: bigint): Promise<Uint8Array> {
    if (slot.length !== 32) throw new ProtocolError('storage slot must be exactly 32 bytes')
    return this.withStateAt(blockNumber, (vm) => vm.stateManager.getStorage(address, new Uint8Array(slot)))
  }

  getAccountBalance(address: Address, blockNumber?: bigint): Promise<bigint> {
    return this.withStateAt(blockNumber, async (vm) =>
      (await vm.stateManager.getAccount(address))?.balance ?? 0n)
  }

  getAccountNonce(address: Address, blockNumber?: bigint): Promise<bigint> {
    return this.withStateAt(blockNumber, async (vm) =>
      (await vm.stateManager.getAccount(address))?.nonce ?? 0n)
  }

  getAccountStates(
    addresses: readonly Address[],
    blockNumber?: bigint,
  ): Promise<readonly Readonly<{ balance: bigint; nonce: bigint }>[]> {
    return this.withStateAt(blockNumber, async (vm) => {
      const states: Array<Readonly<{ balance: bigint; nonce: bigint }>> = []
      for (const address of addresses) {
        const account = await vm.stateManager.getAccount(address)
        states.push({ balance: account?.balance ?? 0n, nonce: account?.nonce ?? 0n })
      }
      return states
    })
  }

  getCode(address: Address, blockNumber?: bigint): Promise<Uint8Array> {
    return this.withStateAt(blockNumber, (vm) => vm.stateManager.getCode(address))
  }

  private withStateAt<T>(
    blockNumber: bigint | undefined,
    query: (vm: ReplaySession['vm']) => Promise<T>,
  ): Promise<T> {
    const operation = this.stateQueryTail.then(async () => {
      const selectedNumber = blockNumber ?? this.session.report.tip.number
      if (selectedNumber < 0n || selectedNumber > this.session.report.tip.number) {
        throw new ProtocolError('requested state block is not in the canonical chain')
      }
      const block = this.session.blocks[Number(selectedNumber)]
      if (block === undefined) throw new ProtocolError('requested canonical state block is missing')
      await this.session.vm.stateManager.setStateRoot(block.header.stateRoot)
      return query(this.session.vm)
    })
    this.stateQueryTail = operation.then(() => undefined, () => undefined)
    return operation
  }
}

type CanonicalTransaction = Readonly<{ tx: FeeMarket1559Tx }>

export type ValidatedSignedTransaction = Readonly<{
  tx: FeeMarket1559Tx
  sender: Address
  hash: string
}>

type BlockLikeWithNumber = {
  hash(): Uint8Array
  header?: { number: bigint }
}

function sha256Hex(text: string): string {
  return `0x${createHash('sha256').update(text, 'utf8').digest('hex')}`
}

function stableGenesisConfig(): Record<string, unknown> {
  return {
    profileId: LOCAL_CHAIN_PROFILE,
    protocolVersion: PROTOCOL_VERSION,
    chainId: EVM_CHAIN_ID.toString(),
    hardfork: EVM_HARDFORK,
    ethereumjsVersion: EJS_VERSION,
    genesisTimestamp: GENESIS_TIMESTAMP.toString(),
    gasLimit: BLOCK_GAS_LIMIT.toString(),
    baseFeePerGas: GENESIS_BASE_FEE.toString(),
    coinbase: ZERO_ADDRESS.toString(),
    difficulty: '0',
    mixHash: bytesToHex(ZERO32),
    nonce: bytesToHex(ZERO8),
    extraData: '0x',
    fundedAddress: SENDER_ADDRESS.toString(),
    fundedBalance: GENESIS_BALANCE.toString(),
    activatePrecompiles: true,
    emptyWithdrawals: true,
    beaconRootSystemContractCode: 'absent',
    historyStorageSystemContractCode: 'absent',
  }
}

export const GENESIS_CONFIG_HASH = sha256Hex(JSON.stringify(stableGenesisConfig()))

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function asBytesHex(value: Uint8Array): string {
  return bytesToHex(value).toLowerCase()
}

function sameHex(a: Uint8Array, b: Uint8Array): boolean {
  return equalsBytes(a, b)
}

function encodeBlockNumber(number: bigint): string {
  if (number < 0n || number > MAX_BLOCK_NUMBER) {
    throw new ProtocolError(`block number must be between 0 and ${MAX_BLOCK_NUMBER}`)
  }
  return number.toString(10)
}

function parseCanonicalUint(value: unknown, name: string, maximum: bigint): bigint {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximum.toString(10).length ||
    !/^(0|[1-9][0-9]*)$/.test(value)
  ) {
    throw new ProtocolError(`${name} must be a canonical bounded decimal string`)
  }
  const parsed = BigInt(value)
  if (parsed > maximum) throw new ProtocolError(`${name} exceeds its maximum`)
  return parsed
}

function lowerHex(value: unknown, name: string, byteLength?: number): string {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-f]{2})*$/.test(value)) {
    throw new ProtocolError(`${name} must be lowercase even-length 0x-prefixed hex`)
  }
  if (byteLength !== undefined && value.length !== 2 + byteLength * 2) {
    throw new ProtocolError(`${name} must be ${byteLength} bytes`)
  }
  return value
}

function compareJson(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b)
}

function normalizeLogs(logs: RunTxResult['receipt']['logs']): LogRecord[] {
  return logs.map(([address, topics, data]) => ({
    address: asBytesHex(address),
    topics: topics.map(asBytesHex),
    data: asBytesHex(data),
  }))
}

function outcomesFromRunResult(block: Block, result: RunBlockResult): TransactionOutcome[] {
  if (result.results.length !== block.transactions.length) {
    throw new ProtocolError('EthereumJS returned a different number of transaction results')
  }
  return result.results.map((txResult, index) => {
    const tx = block.transactions[index]
    if (tx === undefined || !('status' in txResult.receipt)) {
      throw new ProtocolError('expected an Osaka post-Byzantium transaction receipt')
    }
    return {
      transactionHash: asBytesHex(tx.hash()),
      status: txResult.receipt.status,
      gasUsed: txResult.totalGasSpent.toString(10),
      cumulativeGasUsed: txResult.receipt.cumulativeBlockGasUsed.toString(10),
      returnData: asBytesHex(txResult.execResult.returnValue),
      ...(txResult.createdAddress === undefined
        ? {}
        : { createdAddress: txResult.createdAddress.toString().toLowerCase() }),
      logs: normalizeLogs(txResult.receipt.logs),
    }
  })
}

function recordFromBlock(
  block: Block,
  receiptRlpHexes: string[],
  outcomes: TransactionOutcome[],
  depositOperations: readonly EvmDepositOperation[] = [],
): BlockRecord {
  return {
    format: 'btcs-l2-block-record',
    schemaVersion: STORE_SCHEMA_VERSION,
    blockHash: asBytesHex(block.hash()),
    height: block.header.number.toString(10),
    blockRlpHex: asBytesHex(block.serialize()),
    receiptRlpHexes,
    outcomes,
    depositOperations: [...depositOperations],
  }
}

function collectCommittedDepositIds(records: readonly BlockRecord[]): Set<string> {
  const seen = new Set<string>()
  for (const record of records) {
    for (const operation of record.depositOperations) {
      if (seen.has(operation.depositId)) {
        throw new ProtocolError('canonical history contains a duplicate deposit credit')
      }
      seen.add(operation.depositId)
    }
  }
  return seen
}

function registerFreshDepositOperations(
  operations: readonly EvmDepositOperation[],
  seen: Set<string>,
): void {
  for (const operation of operations) {
    if (seen.has(operation.depositId)) {
      throw new ProtocolError(
        `deposit ${operation.depositId} was already included in canonical history`,
      )
    }
  }
  for (const operation of operations) seen.add(operation.depositId)
}

async function applyEvmDepositOperations(
  vm: Awaited<ReturnType<typeof createVM>>,
  operations: readonly EvmDepositOperation[],
): Promise<void> {
  for (const operation of operations) {
    const address = new Address(
      unprefixedHexToBytes(operation.recipientAddress.slice(2)),
    )
    const account = await vm.stateManager.getAccount(address) ?? new Account()
    const nextBalance = account.balance + BigInt(operation.amountWei)

    if (nextBalance > MAX_EVM_BALANCE) {
      throw new ProtocolError('deposit credit would overflow the EVM account balance')
    }

    account.balance = nextBalance
    await vm.stateManager.putAccount(address, account)
  }
}

function blockSummary(block: Block, outcomes: readonly TransactionOutcome[]): BlockSummary {
  const h = block.header
  if (h.baseFeePerGas === undefined || h.requestsHash === undefined) {
    throw new ProtocolError('block is missing a required Osaka/Prague header field')
  }
  return {
    number: h.number.toString(10),
    hash: asBytesHex(block.hash()),
    parentHash: asBytesHex(h.parentHash),
    timestamp: h.timestamp.toString(10),
    gasLimit: h.gasLimit.toString(10),
    gasUsed: h.gasUsed.toString(10),
    baseFeePerGas: h.baseFeePerGas.toString(10),
    transactionsRoot: asBytesHex(h.transactionsTrie),
    receiptsRoot: asBytesHex(h.receiptTrie),
    stateRoot: asBytesHex(h.stateRoot),
    requestsRoot: asBytesHex(h.requestsHash),
    receipts: outcomes,
  }
}

class CanonicalBlockHashLookup implements EVMMockBlockchainInterface {
  private readonly byNumber = new Map<number, BlockLikeWithNumber>()

  async getBlock(blockId: number): Promise<Awaited<ReturnType<EVMMockBlockchainInterface['getBlock']>>> {
    const block = this.byNumber.get(blockId)
    if (block === undefined) {
      throw new ProtocolError(`canonical block hash ${blockId} is not available to BLOCKHASH`)
    }
    return block
  }

  async putBlock(block: Parameters<EVMMockBlockchainInterface['putBlock']>[0]): Promise<void> {
    const candidate = block as BlockLikeWithNumber
    if (candidate.header === undefined) {
      throw new ProtocolError('block-hash lookup requires a block with a height')
    }
    const height = Number(candidate.header.number)
    if (!Number.isSafeInteger(height) || height < 0) {
      throw new ProtocolError('block height cannot be represented by EthereumJS BLOCKHASH lookup')
    }
    this.byNumber.set(height, candidate)
    if (this.byNumber.size > MAX_BLOCKHASH_HISTORY) {
      const oldestHeight = Math.min(...this.byNumber.keys())
      this.byNumber.delete(oldestHeight)
    }
  }

  shallowCopy(): EVMMockBlockchainInterface {
    const copy = new CanonicalBlockHashLookup()
    for (const [height, block] of this.byNumber) copy.byNumber.set(height, block)
    return copy
  }
}

async function createExecutionVM(
  stateManager?: ReplayStateManager,
  options: Readonly<{ initializeGenesisState?: boolean }> = {},
) {
  const common = createHarnessCommon()
  const blockchain = new CanonicalBlockHashLookup()
  const vm = await createVM({
    common,
    blockchain,
    activatePrecompiles: true,
    ...(stateManager === undefined ? {} : { stateManager }),
  })

  if (options.initializeGenesisState !== false) {
    await initializeGenesisState(vm)
  }

  return { vm, common, blockchain }
}

async function initializeGenesisState(
  vm: Awaited<ReturnType<typeof createVM>>,
): Promise<void> {
  // EthereumJS skips automatic precompile-account initialization when a
  // custom state manager is supplied, so reproduce it for genesis replay.
  for (const [addressStr] of getActivePrecompiles(vm.evm.common)) {
    const address = new Address(unprefixedHexToBytes(addressStr))
    if (await vm.stateManager.getAccount(address) === undefined) {
      const account = new Account()
      await vm.stateManager.putAccount(
        address,
        createAccount({ balance: 1, storageRoot: account.storageRoot }),
      )
    }
  }

  await vm.stateManager.putAccount(
    SENDER_ADDRESS,
    createAccount({ balance: GENESIS_BALANCE }),
  )
}

async function createGenesisBlock(vm: Awaited<ReturnType<typeof createVM>>): Promise<Block> {
  const stateRoot = await vm.stateManager.getStateRoot()
  return createBlock(
    {
      header: {
        parentHash: ZERO32,
        uncleHash: KECCAK256_RLP_ARRAY,
        coinbase: ZERO_ADDRESS,
        stateRoot,
        transactionsTrie: KECCAK256_RLP,
        receiptTrie: KECCAK256_RLP,
        logsBloom: new Uint8Array(256),
        difficulty: 0n,
        number: 0n,
        gasLimit: BLOCK_GAS_LIMIT,
        gasUsed: 0n,
        timestamp: GENESIS_TIMESTAMP,
        extraData: new Uint8Array(),
        mixHash: ZERO32,
        nonce: ZERO8,
        baseFeePerGas: GENESIS_BASE_FEE,
        withdrawalsRoot: KECCAK256_RLP,
        blobGasUsed: 0n,
        excessBlobGas: 0n,
        parentBeaconBlockRoot: ZERO32,
        requestsHash: SHA256_NULL,
      },
      transactions: [],
      uncleHeaders: [],
      withdrawals: [],
    },
    { common: createHarnessCommon() },
  )
}

async function makeGenesisSession(stateManager?: ReplayStateManager) {
  const { vm, common, blockchain } = await createExecutionVM(stateManager)
  const genesis = await createGenesisBlock(vm)
  await blockchain.putBlock(genesis)
  const genesisStateRoot = await vm.stateManager.getStateRoot()
  return { vm, common, blockchain, genesis, genesisStateRoot }
}

function snapshotTransactionBytes(transactions: readonly TypedTransaction[]): Uint8Array[] {
  if (transactions.length > MAX_TRANSACTIONS_PER_BLOCK) {
    throw new ProtocolError(`block exceeds the ${MAX_TRANSACTIONS_PER_BLOCK}-transaction parser limit`)
  }
  let serializedBytes = 0
  return transactions.map((supplied, index) => {
    if (supplied.type !== 2) {
      throw new ProtocolError(`transaction ${index} is not an EIP-1559 type-2 transaction`)
    }
    let serialized: Uint8Array
    try {
      serialized = new Uint8Array(supplied.serialize())
    } catch (error) {
      throw new ProtocolError(`transaction ${index} could not be serialized: ${messageOf(error)}`)
    }
    if (serialized.length === 0 || serialized[0] !== 0x02) {
      throw new ProtocolError(`transaction ${index} does not have a type-2 transaction envelope`)
    }
    serializedBytes += serialized.length
    if (serializedBytes > MAX_SERIALIZED_BLOCK_BYTES) {
      throw new ProtocolError('ordered transaction bytes exceed the local block parser limit')
    }
    return serialized
  })
}

export function validateSignedTransactionBytes(
  serialized: Uint8Array,
  baseFeePerGas: bigint,
  common: ReturnType<typeof createHarnessCommon>,
  label = 'transaction',
): ValidatedSignedTransaction {
  if (common.chainId() !== EVM_CHAIN_ID || common.hardfork() !== EVM_HARDFORK) {
    throw new ProtocolError('internal EVM configuration does not match the pinned profile')
  }
  if (serialized.length === 0 || serialized[0] !== 0x02) {
    throw new ProtocolError(`${label} does not have a type-2 transaction envelope`)
  }

  let tx: FeeMarket1559Tx
  try {
    tx = createFeeMarket1559TxFromRLP(serialized, { common })
  } catch (error) {
    throw new ProtocolError(`${label} has invalid type-2 encoding: ${messageOf(error)}`)
  }
  if (!equalsBytes(tx.serialize(), serialized)) {
    throw new ProtocolError(`${label} does not use canonical type-2 encoding`)
  }
  if (tx.type !== 2 || tx.chainId !== EVM_CHAIN_ID) {
    throw new ProtocolError(`${label} has an unsupported transaction type or chain ID`)
  }
  if (!tx.isSigned() || !tx.verifySignature()) {
    throw new ProtocolError(`${label} is unsigned or has an invalid signature`)
  }
  if (tx.common.chainId() !== EVM_CHAIN_ID || tx.common.hardfork() !== EVM_HARDFORK) {
    throw new ProtocolError(`${label} was not decoded under the pinned chain configuration`)
  }
  const validationErrors = tx.getValidationErrors()
  if (validationErrors.length > 0) {
    throw new ProtocolError(`${label} is invalid: ${validationErrors.join('; ')}`)
  }
  if (tx.gasLimit > BLOCK_GAS_LIMIT) {
    throw new ProtocolError(`${label} gas limit exceeds the local block gas limit`)
  }
  if (tx.maxFeePerGas < baseFeePerGas) {
    throw new ProtocolError(`${label} maxFeePerGas is below the block base fee`)
  }
  let sender: Address
  try {
    sender = tx.getSenderAddress()
  } catch (error) {
    throw new ProtocolError(`${label} sender recovery failed: ${messageOf(error)}`)
  }
  return { tx, sender, hash: asBytesHex(tx.hash()) }
}

function canonicalizeTransactionBytes(
  transactions: readonly Uint8Array[],
  common: ReturnType<typeof createHarnessCommon>,
  baseFeePerGas: bigint,
): CanonicalTransaction[] {
  return transactions.map((serialized, index) => ({
    tx: validateSignedTransactionBytes(serialized, baseFeePerGas, common, `transaction ${index}`).tx,
  }))
}

function validateGenesisBlock(received: Block, expected: Block): void {
  if (!sameHex(received.hash(), expected.hash())) {
    throw new ProtocolError('stored genesis block hash does not match the fixed genesis')
  }
  if (!sameHex(received.serialize(), expected.serialize())) {
    throw new ProtocolError('stored genesis block bytes do not match the fixed genesis')
  }
}

function validateChildHeader(
  block: Block,
  parent: Block,
  common: ReturnType<typeof createHarnessCommon>,
): void {
  const header = block.header
  if (header.number !== parent.header.number + 1n) {
    throw new ProtocolError('block number must be exactly parent number plus one')
  }
  encodeBlockNumber(header.number)
  if (!sameHex(header.parentHash, parent.hash())) {
    throw new ProtocolError('block parent hash does not match the canonical parent')
  }
  if (header.timestamp <= parent.header.timestamp || header.timestamp > MAX_U64) {
    throw new ProtocolError('block timestamp must increase and fit an unsigned 64-bit value')
  }
  if (header.gasLimit !== BLOCK_GAS_LIMIT) {
    throw new ProtocolError(`block gas limit must equal ${BLOCK_GAS_LIMIT}`)
  }
  if (header.gasUsed > header.gasLimit) {
    throw new ProtocolError('block gas used exceeds its gas limit')
  }
  const expectedBaseFee = parent.header.calcNextBaseFee()
  if (header.baseFeePerGas !== expectedBaseFee) {
    throw new ProtocolError('block base fee does not match EIP-1559 parent calculation')
  }
  if (!header.coinbase.equals(ZERO_ADDRESS)) {
    throw new ProtocolError('block coinbase must be the zero address')
  }
  if (
    header.difficulty !== 0n ||
    !sameHex(header.mixHash, ZERO32) ||
    !sameHex(header.nonce, ZERO8) ||
    (header.extraData.length !== 0 && header.extraData.length !== 32)
  ) {
    throw new ProtocolError('block contains a noncanonical local consensus/context field')
  }
  if (block.uncleHeaders.length !== 0 || !sameHex(header.uncleHash, KECCAK256_RLP_ARRAY)) {
    throw new ProtocolError('uncles are not permitted in the local block protocol')
  }
  if (block.withdrawals === undefined || block.withdrawals.length !== 0) {
    throw new ProtocolError('withdrawals must be present as an empty list')
  }
  if (!sameHex(header.withdrawalsRoot ?? new Uint8Array(), KECCAK256_RLP)) {
    throw new ProtocolError('withdrawals root must be the empty-trie root')
  }
  if (header.blobGasUsed !== 0n) {
    throw new ProtocolError('blob transactions and nonzero blob gas are not permitted')
  }
  if (header.excessBlobGas !== parent.header.calcNextExcessBlobGas(common)) {
    throw new ProtocolError('excess blob gas does not match the pinned parent calculation')
  }
  if (!sameHex(header.parentBeaconBlockRoot ?? new Uint8Array(), ZERO32)) {
    throw new ProtocolError('parent beacon block root must be zero')
  }
}

function verifyBlockRecordShape(value: unknown, expectedHash: string): BlockRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('block record must be a JSON object')
  }
  const candidate = value as Record<string, unknown>
  if (
    candidate.format !== 'btcs-l2-block-record' ||
    candidate.schemaVersion !== STORE_SCHEMA_VERSION ||
    candidate.blockHash !== expectedHash
  ) {
    throw new ProtocolError('block record format, schema, or content address is invalid')
  }
  const expectedKeys = [
    'format',
    'schemaVersion',
    'blockHash',
    'height',
    'blockRlpHex',
    'receiptRlpHexes',
    'outcomes',
    'depositOperations',
  ]
  if (!compareJson(Object.keys(candidate).sort(), expectedKeys.sort())) {
    throw new ProtocolError('block record has missing or unsupported fields')
  }
  parseCanonicalUint(candidate.height, 'block record height', MAX_BLOCK_NUMBER)
  const blockRlpHex = lowerHex(candidate.blockRlpHex, 'blockRlpHex')
  const blockByteLength = (blockRlpHex.length - 2) / 2
  if (blockByteLength === 0 || blockByteLength > MAX_SERIALIZED_BLOCK_BYTES) {
    throw new ProtocolError('serialized block exceeds the configured parser limit')
  }
  if (!Array.isArray(candidate.receiptRlpHexes) || !Array.isArray(candidate.outcomes)) {
    throw new ProtocolError('block record receipts and outcomes must be arrays')
  }
  if (
    candidate.receiptRlpHexes.length > MAX_TRANSACTIONS_PER_BLOCK ||
    candidate.outcomes.length > MAX_TRANSACTIONS_PER_BLOCK
  ) {
    throw new ProtocolError('block record exceeds the transaction sidecar count limit')
  }
  if (!Array.isArray(candidate.depositOperations)) {
    throw new ProtocolError('block record deposit operations must be an array')
  }
  for (const receiptHex of candidate.receiptRlpHexes) lowerHex(receiptHex, 'receipt RLP')
  for (const outcome of candidate.outcomes) {
    if (typeof outcome !== 'object' || outcome === null || Array.isArray(outcome)) {
      throw new ProtocolError('transaction outcome must be a JSON object')
    }
  }
  return {
    ...(candidate as unknown as BlockRecord),
    depositOperations: [
      ...normalizeEvmDepositOperations(candidate.depositOperations),
    ],
  }
}

function verifyMetadata(value: unknown): ChainMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('chain metadata must be a JSON object')
  }
  const candidate = value as Record<string, unknown>
  const expected: Omit<ChainMetadata, 'genesisHash' | 'canonicalHeight' | 'canonicalTipHash'> = {
    format: 'btcs-l2-local-chain',
    schemaVersion: STORE_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    profileId: LOCAL_CHAIN_PROFILE,
    chainId: EVM_CHAIN_ID.toString(10),
    hardfork: EVM_HARDFORK,
    ethereumjsVersion: EJS_VERSION,
    genesisConfigHash: GENESIS_CONFIG_HASH,
  }
  for (const [key, valueToMatch] of Object.entries(expected)) {
    if (candidate[key] !== valueToMatch) {
      throw new ProtocolError(`chain metadata ${key} does not match the selected profile`)
    }
  }
  const expectedKeys = [
    'format',
    'schemaVersion',
    'protocolVersion',
    'profileId',
    'chainId',
    'hardfork',
    'ethereumjsVersion',
    'genesisConfigHash',
    'genesisHash',
    'canonicalHeight',
    'canonicalTipHash',
  ]
  if (!compareJson(Object.keys(candidate).sort(), expectedKeys.sort())) {
    throw new ProtocolError('chain metadata has missing or unsupported fields')
  }
  const genesisHash = lowerHex(candidate.genesisHash, 'genesisHash', 32)
  const canonicalTipHash = lowerHex(candidate.canonicalTipHash, 'canonicalTipHash', 32)
  const canonicalHeight = parseCanonicalUint(
    candidate.canonicalHeight,
    'canonicalHeight',
    MAX_BLOCK_NUMBER,
  )
  return {
    ...expected,
    genesisHash,
    canonicalHeight: canonicalHeight.toString(10),
    canonicalTipHash,
  }
}

function newMetadata(genesisHash: string, tip: ChainTip): ChainMetadata {
  return {
    format: 'btcs-l2-local-chain',
    schemaVersion: STORE_SCHEMA_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    profileId: LOCAL_CHAIN_PROFILE,
    chainId: EVM_CHAIN_ID.toString(10),
    hardfork: EVM_HARDFORK,
    ethereumjsVersion: EJS_VERSION,
    genesisConfigHash: GENESIS_CONFIG_HASH,
    genesisHash,
    canonicalHeight: tip.number.toString(10),
    canonicalTipHash: tip.hash,
  }
}

function blockRecordPath(blocksDirectory: string, hash: string): string {
  return resolve(blocksDirectory, `${hash.slice(2)}.json`)
}

async function readBoundedFile(path: string, maxBytes: number): Promise<Uint8Array> {
  const info = await lstat(path)
  if (!info.isFile() || info.size > maxBytes) {
    throw new ProtocolError(`file is not regular or exceeds the ${maxBytes}-byte limit: ${path}`)
  }
  return new Uint8Array(await readFile(path))
}

async function atomicWrite(
  path: string,
  contents: Uint8Array,
  target: 'block-record' | 'tip',
  persistenceTestHook?: (stage: PersistenceStage) => void | Promise<void>,
): Promise<void> {
  const directory = dirname(path)
  const temporaryPath = resolve(directory, `.${randomUUID()}.tmp`)
  const stage = (suffix: string): PersistenceStage => {
    if (target === 'block-record') {
      const stages: Record<string, PersistenceStage> = {
        opened: 'block-record-temp-opened',
        partiallyWritten: 'block-record-temp-partially-written',
        written: 'block-record-temp-written',
        synced: 'block-record-file-synced',
        beforeRename: 'before-block-record-rename',
        renamed: 'block-record-renamed',
      }
      return stages[suffix]!
    }
    const stages: Record<string, PersistenceStage> = {
      opened: 'tip-temp-opened',
      partiallyWritten: 'tip-temp-partially-written',
      written: 'tip-temp-written',
      synced: 'tip-file-synced',
      beforeRename: 'before-tip-rename',
      renamed: 'tip-renamed',
    }
    return stages[suffix]!
  }
  const inject = async (suffix: string): Promise<void> => {
    if (persistenceTestHook !== undefined) await persistenceTestHook(stage(suffix))
  }
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    await inject('opened')
    const splitAt = Math.max(1, Math.floor(contents.length / 2))
    const writeFully = async (bytes: Uint8Array, position: number): Promise<void> => {
      let offset = 0
      while (offset < bytes.length) {
        const result = await handle!.write(bytes, offset, bytes.length - offset, position + offset)
        if (result.bytesWritten === 0) throw new Error('temporary file write made no progress')
        offset += result.bytesWritten
      }
    }
    await writeFully(contents.subarray(0, splitAt), 0)
    await inject('partiallyWritten')
    await writeFully(contents.subarray(splitAt), splitAt)
    await inject('written')
    await handle.sync()
    await inject('synced')
    await handle.close()
    handle = undefined
    await inject('beforeRename')
    await rename(temporaryPath, path)
    await inject('renamed')
    if (persistenceTestHook !== undefined) {
      await persistenceTestHook(
        target === 'block-record'
          ? 'block-record-before-directory-sync'
          : 'tip-before-directory-sync',
      )
    }
    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
    if (persistenceTestHook !== undefined) {
      await persistenceTestHook(
        target === 'block-record' ? 'block-record-directory-synced' : 'tip-durable',
      )
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

async function createGenesisRecord(): Promise<{
  block: Block
  stateRoot: string
  record: BlockRecord
}> {
  const genesisSession = await makeGenesisSession()
  const block = genesisSession.genesis
  const stateRoot = asBytesHex(genesisSession.genesisStateRoot)
  const record = recordFromBlock(block, [], [])
  return { block, stateRoot, record }
}

async function validateGenesisOnlyStoreBeforeMetadataRecovery(
  blocksDirectory: string,
  expectedGenesisHash: string,
  expectedGenesisRecord: BlockRecord,
): Promise<void> {
  const entries = await readdir(blocksDirectory, { withFileTypes: true })
  const recordNames: string[] = []
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
      throw new ProtocolError('store contains an unsupported entry while chain metadata is missing')
    }
    if (entry.isDirectory()) {
      throw new ProtocolError('store contains an unexpected directory while chain metadata is missing')
    }
    if (/^[0-9a-f]{64}\.json$/.test(entry.name)) {
      recordNames.push(entry.name)
      continue
    }
    if (/^\.[0-9a-f-]{36}\.tmp$/.test(entry.name)) continue
    throw new ProtocolError('store contains an unexpected file while chain metadata is missing')
  }

  const expectedName = `${expectedGenesisHash.slice(2)}.json`
  if (recordNames.length > 1 || (recordNames.length === 1 && recordNames[0] !== expectedName)) {
    throw new ProtocolError('chain metadata is missing from a store that contains block history')
  }
  if (recordNames.length === 1) {
    await persistContentAddressedRecord(
      blockRecordPath(blocksDirectory, expectedGenesisHash),
      expectedGenesisRecord,
    )
  }
}

export class PersistentBlockProcessor {
  readonly directory: string
  private readonly blocksDirectory: string
  private readonly beforeTipCommit?: () => void | Promise<void>
  private readonly persistenceTestHook?: (stage: PersistenceStage) => void | Promise<void>
  private readonly chainDirectoryLockTimeoutMs: number
  private tipValue: ChainTip
  private genesisHashValue: string
  private operationTail: Promise<void> = Promise.resolve()

  private constructor(
    directory: string,
    blocksDirectory: string,
    metadata: ChainMetadata,
    options: PersistentBlockProcessorOptions,
  ) {
    this.directory = directory
    this.blocksDirectory = blocksDirectory
    this.beforeTipCommit = options.beforeTipCommit
    this.persistenceTestHook = options.persistenceTestHook
    this.chainDirectoryLockTimeoutMs =
      options.chainDirectoryLockTimeoutMs ?? DEFAULT_CHAIN_DIRECTORY_LOCK_TIMEOUT_MS
    this.tipValue = {
      number: BigInt(metadata.canonicalHeight),
      hash: metadata.canonicalTipHash,
    }
    this.genesisHashValue = metadata.genesisHash
  }

  static async open(
    directory: string,
    options: PersistentBlockProcessorOptions = {},
  ): Promise<PersistentBlockProcessor> {
    const absoluteDirectory = resolve(directory)
    const blocksDirectory = resolve(absoluteDirectory, 'blocks')
    await mkdir(blocksDirectory, { recursive: true })
    return withChainDirectoryLock(absoluteDirectory, async () => {
      const metadataPath = resolve(absoluteDirectory, 'chain.json')
      let metadataExists = true
      let metadata: ChainMetadata | undefined
      try {
        const bytes = await readBoundedFile(metadataPath, MAX_CHAIN_METADATA_BYTES)
        metadata = verifyMetadata(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          metadataExists = false
        } else {
          throw new ProtocolError(`cannot open chain metadata: ${messageOf(error)}`)
        }
      }

      if (!metadataExists) {
        const genesis = await createGenesisRecord()
        const genesisHash = asBytesHex(genesis.block.hash())
        await validateGenesisOnlyStoreBeforeMetadataRecovery(
          blocksDirectory,
          genesisHash,
          genesis.record,
        )
        const expectedRecordPath = blockRecordPath(blocksDirectory, genesisHash)
        await persistContentAddressedRecord(
          expectedRecordPath,
          genesis.record,
          options.persistenceTestHook,
        )
        const initialTip = { number: 0n, hash: genesisHash }
        metadata = newMetadata(genesisHash, initialTip)
        await atomicWrite(metadataPath, encodeJson(metadata), 'tip', options.persistenceTestHook)
      }
      if (metadata === undefined) throw new ProtocolError('chain metadata could not be initialized')

      const processor = new PersistentBlockProcessor(
        absoluteDirectory,
        blocksDirectory,
        metadata,
        options,
      )
      await processor.replayCanonical()
      return processor
    }, options.chainDirectoryLockTimeoutMs)
  }

  get tip(): ChainTip {
    return { ...this.tipValue }
  }

  private async withExclusiveOperation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTail
    let release!: () => void
    this.operationTail = new Promise<void>((resolvePromise) => {
      release = resolvePromise
    })
    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }

  /** Run a store operation under the OS lock and refresh the canonical tip. */
  private async withStoreLock<T>(operation: () => Promise<T>): Promise<T> {
    return withChainDirectoryLock(this.directory, async () => {
      await this.refreshCanonicalTip()
      return operation()
    }, this.chainDirectoryLockTimeoutMs)
  }

  private async refreshCanonicalTip(): Promise<void> {
    let metadata: ChainMetadata
    try {
      const bytes = await readBoundedFile(
        resolve(this.directory, 'chain.json'),
        MAX_CHAIN_METADATA_BYTES,
      )
      metadata = verifyMetadata(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
    } catch (error) {
      throw new ProtocolError(`cannot refresh canonical chain metadata: ${messageOf(error)}`)
    }
    if (metadata.genesisHash !== this.genesisHashValue) {
      throw new ProtocolError('canonical metadata genesis differs from the opened processor')
    }
    this.tipValue = {
      number: BigInt(metadata.canonicalHeight),
      hash: metadata.canonicalTipHash,
    }
  }

  /**
   * Hold the in-process queue and OS directory lock through recovery adoption.
   * The callback receives the fresh canonical view and an adoption operation
   * that does not reacquire the already-held locks.
   */
  async withDepositRecoveryLock<T>(
    operation: (
      canonicalView: CanonicalReadView,
      adoptReDerivedStore: (directory: string) => Promise<ChainTip>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.withExclusiveOperation(() => this.withStoreLock(async () =>
      operation(
        await this.createCanonicalReadViewUnlocked(),
        (directory) => this.adoptReDerivedStoreUnlocked(directory),
      ),
    ))
  }

  /**
   * Adopt a fully replay-verified re-derived store while the canonical source
   * remains frozen. Block records are copied first; the atomic chain metadata
   * update is the commit point. The recovery gate is removed only after commit.
   */
  async adoptReDerivedStore(reDerivedDirectory: string): Promise<ChainTip> {
    return this.withExclusiveOperation(() => this.withStoreLock(
      () => this.adoptReDerivedStoreUnlocked(reDerivedDirectory),
    ))
  }

  private async adoptReDerivedStoreUnlocked(reDerivedDirectory: string): Promise<ChainTip> {
    const gate = await readDepositRecoveryGate(this.directory)
    if (gate === undefined) {
      throw new ProtocolError('cannot adopt a re-derived store without a frozen recovery gate')
    }

    const sourceDirectory = resolve(reDerivedDirectory)
    if (sourceDirectory === this.directory) {
      throw new ProtocolError('re-derived store must be separate from the canonical store')
    }
    await assertDepositRecoveryOpen(sourceDirectory)

    // Opening replays and validates the complete candidate before it can be
    // installed. The source records remain content-addressed and immutable.
    const candidate = await PersistentBlockProcessor.open(sourceDirectory)
    if (candidate.genesisHashValue !== this.genesisHashValue) {
      throw new ProtocolError('re-derived store genesis does not match the canonical store')
    }
    const records = await candidate.loadCanonicalRecords()
    for (const { record } of records) {
      await persistContentAddressedRecord(
        blockRecordPath(this.blocksDirectory, record.blockHash),
        record,
        this.persistenceTestHook,
      )
    }

    const adoptedTip = { ...candidate.tipValue }
    const metadata = newMetadata(candidate.genesisHashValue, adoptedTip)
    try {
      await atomicWrite(
        resolve(this.directory, 'chain.json'),
        encodeJson(metadata),
        'tip',
        this.persistenceTestHook,
      )
    } catch (error) {
      // The atomic rename may have committed even if a later durability hook
      // failed. Reconcile memory with whichever metadata is now on disk.
      await this.reconcileTipAfterFailedWrite(adoptedTip)
      throw error
    }

    this.genesisHashValue = candidate.genesisHashValue
    this.tipValue = adoptedTip
    await clearDepositRecoveryGate(this.directory)
    return { ...adoptedTip }
  }

  async buildNextBlock(
    transactions: readonly TypedTransaction[],
    timestamp: bigint,
    depositOperations: readonly EvmDepositOperation[] = [],
  ): Promise<ProcessedBlock> {
    const orderedTransactionBytes = snapshotTransactionBytes(transactions)
    const canonicalDepositOperations = [
      ...normalizeEvmDepositOperations(depositOperations),
    ]
    return this.withExclusiveOperation(() => this.withStoreLock(async () => {
      await assertDepositRecoveryOpen(this.directory)
      const session = await this.replayCanonical()
      const parent = session.blocks.at(-1)
      if (parent === undefined) throw new ProtocolError('canonical chain is missing genesis')
      const seenDepositIds = collectCommittedDepositIds(
        session.records.map(({ record }) => record),
      )
      registerFreshDepositOperations(canonicalDepositOperations, seenDepositIds)
      if (timestamp <= parent.header.timestamp || timestamp > MAX_U64) {
        throw new ProtocolError('timestamp must be greater than the parent and fit uint64')
      }
      encodeBlockNumber(parent.header.number + 1n)
      const baseFeePerGas = parent.header.calcNextBaseFee()
      const canonicalTransactions = canonicalizeTransactionBytes(
        orderedTransactionBytes,
        session.common,
        baseFeePerGas,
      )
      const builder = await buildBlock(session.vm, {
        parentBlock: parent,
        headerData: {
          timestamp,
          gasLimit: BLOCK_GAS_LIMIT,
          coinbase: ZERO_ADDRESS,
          difficulty: 0n,
          mixHash: ZERO32,
          nonce: ZERO8,
          extraData: encodeEvmDepositPreludeExtraData(canonicalDepositOperations),
          parentBeaconBlockRoot: ZERO32,
        },
        withdrawals: [],
        blockOpts: {
          common: session.common,
          putBlockIntoBlockchain: false,
        },
      })
      try {
        // Deposit credits enter state after builder initialisation but before
        // ordinary transactions, and are committed by the block state root.
        await applyEvmDepositOperations(session.vm, canonicalDepositOperations)
        for (const { tx } of canonicalTransactions) await builder.addTransaction(tx)
        const { block } = await builder.build()
        return await this.appendBlockUnlocked(
          block.serialize(),
          canonicalDepositOperations,
        )
      } catch (error) {
        await builder.revert().catch(() => undefined)
        if (error instanceof ProtocolError) throw error
        throw new ProtocolError(`block construction failed: ${messageOf(error)}`)
      }
    }))
  }

  /**
   * Import a block built elsewhere and append it to the canonical chain.
   *
   * Like {@link buildNextBlock}, this advances the canonical tip, so it is
   * refused on a frozen deposit-recovery store. Isolated historical replay and
   * recovery reconstruction must import into a separate, fresh store, which has
   * no gate marker and is therefore open.
   */
  async acceptBlock(
    blockRlp: Uint8Array,
    depositOperations: readonly EvmDepositOperation[] = [],
  ): Promise<ProcessedBlock> {
    return this.withExclusiveOperation(() => this.withStoreLock(async () => {
      await assertDepositRecoveryOpen(this.directory)
      return this.appendBlockUnlocked(
        new Uint8Array(blockRlp),
        depositOperations,
      )
    }))
  }

  async replay(): Promise<ReplayReport> {
    return this.withExclusiveOperation(() => this.withStoreLock(async () =>
      (await this.replayCanonical()).report,
    ))
  }

  async createCanonicalReadView(): Promise<CanonicalReadView> {
    return this.withExclusiveOperation(() => this.withStoreLock(
      () => this.createCanonicalReadViewUnlocked(),
    ))
  }

  private async createCanonicalReadViewUnlocked(): Promise<CanonicalReadView> {
    return new CanonicalReadView(await this.replayCanonical())
  }

  /**
   * Export a durable checkpoint from a separate, fully verified canonical replay.
   * This runs under the processor's exclusive-operation lock so the tip cannot
   * change while replay and checkpoint publication are in progress.
   */
  async exportStateCheckpoint(checkpointDirectory: string): Promise<StateCheckpointManifest> {
    return this.withExclusiveOperation(() => this.withStoreLock(async () => {
      const temporaryDirectory = await mkdtemp(
        join(this.directory, '.state-checkpoint-export-'),
      )
      const sourceDatabasePath = join(temporaryDirectory, 'state-db')
      let durable: Awaited<ReturnType<typeof openDurableStateManager>> | undefined

      try {
        durable = await openDurableStateManager(sourceDatabasePath)
        const session = await this.replayCanonical(durable.stateManager)
        const tipSummary = session.report.blocks.at(-1)

        if (tipSummary === undefined || session.blocks.at(-1) === undefined) {
          throw new ProtocolError('canonical replay has no tip state to checkpoint')
        }

        const stateRoot = asBytesHex(await session.vm.stateManager.getStateRoot())
        if (stateRoot.toLowerCase() !== tipSummary.stateRoot.toLowerCase()) {
          throw new ProtocolError(
            `durable replay state root does not match canonical tip: expected ${tipSummary.stateRoot}, got ${stateRoot}`,
          )
        }

        // Checkpoint creation requires the source database to be closed.
        await durable.close()

        return await createStateCheckpoint(
          sourceDatabasePath,
          resolve(checkpointDirectory),
          {
            profileId: LOCAL_CHAIN_PROFILE,
            blockHeight: tipSummary.number,
            blockHash: tipSummary.hash,
            stateRoot,
          },
        )
      } finally {
        try {
          await durable?.close()
        } finally {
          await rm(temporaryDirectory, { recursive: true, force: true })
        }
      }
    }))
  }

  async getStorage(
    address: Address,
    slot: Uint8Array,
    blockNumber?: bigint,
  ): Promise<Uint8Array> {
    return (await this.createCanonicalReadView()).getStorage(address, slot, blockNumber)
  }

  async getAccountBalance(address: Address, blockNumber?: bigint): Promise<bigint> {
    return (await this.createCanonicalReadView()).getAccountBalance(address, blockNumber)
  }

  async getAccountNonce(address: Address, blockNumber?: bigint): Promise<bigint> {
    return (await this.createCanonicalReadView()).getAccountNonce(address, blockNumber)
  }

  async getCode(address: Address, blockNumber?: bigint): Promise<Uint8Array> {
    return (await this.createCanonicalReadView()).getCode(address, blockNumber)
  }

  async getCanonicalBlockByNumber(blockNumber: bigint): Promise<CanonicalBlockData | undefined> {
    return (await this.createCanonicalReadView()).getCanonicalBlockByNumber(blockNumber)
  }

  async getCanonicalBlockByHash(blockHash: string): Promise<CanonicalBlockData | undefined> {
    return (await this.createCanonicalReadView()).getCanonicalBlockByHash(blockHash)
  }

  async getCanonicalReceiptByTransactionHash(
    transactionHash: string,
  ): Promise<CanonicalReceiptData | undefined> {
    return (await this.createCanonicalReadView()).getCanonicalReceiptByTransactionHash(transactionHash)
  }

  private async appendBlockUnlocked(
    rawBlock: Uint8Array,
    depositOperations: readonly EvmDepositOperation[] = [],
  ): Promise<ProcessedBlock> {
    if (rawBlock.length === 0 || rawBlock.length > MAX_SERIALIZED_BLOCK_BYTES) {
      throw new ProtocolError('serialized block is empty or exceeds the local parser limit')
    }
    const session = await this.replayCanonical()
    const parent = session.blocks.at(-1)
    if (parent === undefined) throw new ProtocolError('canonical chain is missing genesis')

    let block: Block
    try {
      block = createBlockFromRLP(rawBlock, { common: createHarnessCommon() })
    } catch (error) {
      throw new ProtocolError(`block RLP is malformed for the selected profile: ${messageOf(error)}`)
    }
    if (!sameHex(block.serialize(), rawBlock)) {
      throw new ProtocolError('block RLP is not canonical under the selected EthereumJS codec')
    }
    if (block.transactions.length > MAX_TRANSACTIONS_PER_BLOCK) {
      throw new ProtocolError('block exceeds the transaction parser count limit')
    }
    validateChildHeader(block, parent, session.common)
    const verifiedDepositOperations = verifyEvmDepositPrelude(
      depositOperations,
      block.header.extraData,
    )
    const seenDepositIds = collectCommittedDepositIds(
      session.records.map(({ record }) => record),
    )
    registerFreshDepositOperations(verifiedDepositOperations, seenDepositIds)
    canonicalizeTransactionBytes(
      block.transactions.map((tx) => new Uint8Array(tx.serialize())),
      session.common,
      block.header.baseFeePerGas!,
    )

    let result: RunBlockResult
    try {
      await applyEvmDepositOperations(session.vm, verifiedDepositOperations)
      result = await runBlock(session.vm, {
        block,
        skipHeaderValidation: true,
        skipBlockValidation: false,
        skipHardForkValidation: false,
        setHardfork: false,
        validateBlockSize: false,
      })
    } catch (error) {
      throw new ProtocolError(`block execution or root validation failed: ${messageOf(error)}`)
    }
    const outcomes = outcomesFromRunResult(block, result)
    const receiptRlpHexes = result.receipts.map((receipt, index) => {
      const transaction = block.transactions[index]
      if (transaction === undefined) throw new ProtocolError('receipt has no corresponding transaction')
      return asBytesHex(encodeReceipt(receipt, transaction.type))
    })
    const record = recordFromBlock(
      block,
      receiptRlpHexes,
      outcomes,
      verifiedDepositOperations,
    )
    const encodedRecord = encodeJson(record)
    if (encodedRecord.length > MAX_BLOCK_RECORD_BYTES) {
      throw new ProtocolError('complete block record exceeds the local persistence limit')
    }

    const hash = asBytesHex(block.hash())
    if (this.persistenceTestHook !== undefined) {
      await this.persistenceTestHook('before-block-record-write')
    }
    await persistContentAddressedRecord(
      blockRecordPath(this.blocksDirectory, hash),
      record,
      this.persistenceTestHook,
    )
    if (this.persistenceTestHook !== undefined) {
      await this.persistenceTestHook('after-block-record-durable')
    }
    if (this.beforeTipCommit !== undefined) await this.beforeTipCommit()

    const nextTip: ChainTip = { number: block.header.number, hash }
    const metadata = newMetadata(this.genesisHashValue, nextTip)
    if (this.persistenceTestHook !== undefined) {
      await this.persistenceTestHook('before-tip-update')
    }
    try {
      await atomicWrite(
        resolve(this.directory, 'chain.json'),
        encodeJson(metadata),
        'tip',
        this.persistenceTestHook,
      )
    } catch (error) {
      await this.reconcileTipAfterFailedWrite(nextTip)
      throw error
    }
    this.tipValue = nextTip
    if (this.persistenceTestHook !== undefined) {
      await this.persistenceTestHook('after-tip-commit')
    }

    return {
      blockRlpHex: asBytesHex(block.serialize()),
      summary: blockSummary(block, outcomes),
    }
  }

  private async reconcileTipAfterFailedWrite(expectedNextTip: ChainTip): Promise<void> {
    try {
      const bytes = await readBoundedFile(resolve(this.directory, 'chain.json'), MAX_CHAIN_METADATA_BYTES)
      const metadata = verifyMetadata(JSON.parse(new TextDecoder().decode(bytes)) as unknown)
      if (
        metadata.canonicalHeight === expectedNextTip.number.toString(10) &&
        metadata.canonicalTipHash === expectedNextTip.hash
      ) {
        this.tipValue = { ...expectedNextTip }
      }
    } catch {
      // The failed write remains an error. A subsequent replay/open fails closed
      // if the metadata is absent or malformed; do not infer a canonical tip.
    }
  }

  private async loadCanonicalRecords(): Promise<Array<{ block: Block; record: BlockRecord }>> {
    const tipNumber = this.tipValue.number
    const expectedTipHash = this.tipValue.hash
    let currentHash = expectedTipHash
    let expectedHeight = tipNumber
    const reverse: Array<{ block: Block; record: BlockRecord }> = []
    const seen = new Set<string>()

    while (true) {
      if (seen.has(currentHash)) throw new ProtocolError('canonical block ancestry contains a cycle')
      seen.add(currentHash)
      const path = blockRecordPath(this.blocksDirectory, currentHash)
      let parsed: unknown
      try {
        const bytes = await readBoundedFile(path, MAX_BLOCK_RECORD_BYTES)
        parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      } catch (error) {
        throw new ProtocolError(`cannot read canonical block record ${currentHash}: ${messageOf(error)}`)
      }
      const record = verifyBlockRecordShape(parsed, currentHash)
      const recordHeight = BigInt(record.height)
      if (recordHeight !== expectedHeight) {
        throw new ProtocolError('canonical block record height does not match its ancestry position')
      }
      let block: Block
      try {
        block = createBlockFromRLP(hexToBytes(record.blockRlpHex as `0x${string}`), {
          common: createHarnessCommon(),
        })
      } catch (error) {
        throw new ProtocolError(`canonical block ${currentHash} cannot be decoded: ${messageOf(error)}`)
      }
      if (!sameHex(block.serialize(), hexToBytes(record.blockRlpHex as `0x${string}`))) {
        throw new ProtocolError(`canonical block ${currentHash} has noncanonical RLP`)
      }
      if (asBytesHex(block.hash()) !== currentHash || block.header.number !== expectedHeight) {
        throw new ProtocolError(`canonical block ${currentHash} does not match its content address`)
      }
      if (block.transactions.length > MAX_TRANSACTIONS_PER_BLOCK) {
        throw new ProtocolError(`canonical block ${currentHash} exceeds the transaction count limit`)
      }
      if (record.receiptRlpHexes.length !== block.transactions.length || record.outcomes.length !== block.transactions.length) {
        throw new ProtocolError(`canonical block ${currentHash} sidecar counts do not match its transactions`)
      }
      reverse.push({ block, record })
      if (expectedHeight === 0n) break
      currentHash = asBytesHex(block.header.parentHash)
      expectedHeight -= 1n
    }
    reverse.reverse()

    const expectedGenesis = await createGenesisRecord()
    if (reverse.length === 0 || reverse[0] === undefined) {
      throw new ProtocolError('canonical chain has no genesis record')
    }
    validateGenesisBlock(reverse[0].block, expectedGenesis.block)
    if (asBytesHex(expectedGenesis.block.hash()) !== this.genesisHashValue) {
      throw new ProtocolError('metadata genesis hash does not match the selected genesis')
    }
    if (reverse.at(-1)?.block.header.number !== tipNumber) {
      throw new ProtocolError('canonical tip height does not match replayed ancestry')
    }
    return reverse
  }

  private async replayCanonical(stateManager?: ReplayStateManager): Promise<ReplaySession> {
    const records = await this.loadCanonicalRecords()
    const genesisSession = await makeGenesisSession(stateManager)
    const storedGenesis = records[0]?.record
    if (storedGenesis === undefined) throw new ProtocolError('canonical genesis record is missing')
    if (
      storedGenesis.receiptRlpHexes.length !== 0 ||
      storedGenesis.outcomes.length !== 0 ||
      storedGenesis.depositOperations.length !== 0 ||
      storedGenesis.blockRlpHex !== asBytesHex(genesisSession.genesis.serialize())
    ) {
      throw new ProtocolError('genesis persistence record differs from the fixed genesis')
    }

    const summaries: BlockSummary[] = [blockSummary(genesisSession.genesis, [])]
    const seenDepositIds = new Set<string>()
    const spendActivityByAddress = new Map<string, CanonicalSpendActivity>()
    let spendTraceComplete = true
    let parent = genesisSession.genesis
    for (let index = 1; index < records.length; index++) {
      const item = records[index]
      if (item === undefined) throw new ProtocolError('canonical block sequence has a gap')
      const { block, record } = item
      validateChildHeader(block, parent, genesisSession.common)
      const verifiedDepositOperations = verifyEvmDepositPrelude(
        record.depositOperations,
        block.header.extraData,
      )
      registerFreshDepositOperations(verifiedDepositOperations, seenDepositIds)
      canonicalizeTransactionBytes(
        block.transactions.map((tx) => new Uint8Array(tx.serialize())),
        genesisSession.common,
        block.header.baseFeePerGas!,
      )
      let result: RunBlockResult
      let topLevelMessageCount = 0
      const messageStack: Array<{ transactionIndex: number; message: Message }> = []
      const recordSpendActivity = (
        address: string,
        transactionIndex: number,
        kind: CanonicalSpendActivity['kind'],
        amountWei?: bigint,
      ): void => {
        const normalizedAddress = address.toLowerCase()
        if (!/^0x[0-9a-f]{40}$/.test(normalizedAddress)) {
          spendTraceComplete = false
          return
        }
        const tx = transactionIndex >= 0
          ? block.transactions[transactionIndex]
          : undefined
        const activity: CanonicalSpendActivity = {
          blockNumber: block.header.number,
          ...(tx === undefined ? {} : {
            transactionIndex,
            transactionHash: asBytesHex(tx.hash()),
          }),
          kind,
          ...(amountWei === undefined ? {} : { amountWei: amountWei.toString(10) }),
        }
        const previous = spendActivityByAddress.get(normalizedAddress)
        const previousIndex = previous?.transactionIndex ?? -1
        if (
          previous === undefined ||
          previous.blockNumber < activity.blockNumber ||
          (previous.blockNumber === activity.blockNumber && previousIndex < transactionIndex)
        ) {
          spendActivityByAddress.set(normalizedAddress, activity)
        }
      }
      const events = genesisSession.vm.evm.events
      const onBeforeMessage = (message: Message): void => {
        const transactionIndex = message.depth === 0
          ? topLevelMessageCount++
          : messageStack.at(-1)?.transactionIndex ?? -1
        messageStack.push({ transactionIndex, message })
      }
      const onAfterMessage = (event: EVMResult, resolve?: (result?: any) => void): void => {
        const frame = messageStack.pop()
        if (frame === undefined) {
          spendTraceComplete = false
          resolve?.()
          return
        }
        if (event.execResult.exceptionError === undefined) {
          if (frame.message.value > 0n && !frame.message.delegatecall) {
            recordSpendActivity(
              frame.message.caller.toString(),
              frame.transactionIndex,
              'native-value',
              frame.message.value,
            )
          }
          for (const address of event.execResult.selfdestruct?.keys() ?? []) {
            recordSpendActivity(address, frame.transactionIndex, 'selfdestruct')
          }
        }
        resolve?.()
      }
      try {
        if (events === undefined) {
          spendTraceComplete = false
        } else {
          events.on('beforeMessage', onBeforeMessage)
          events.on('afterMessage', onAfterMessage)
        }
        await applyEvmDepositOperations(
          genesisSession.vm,
          verifiedDepositOperations,
        )
        result = await runBlock(genesisSession.vm, {
          block,
          skipHeaderValidation: true,
          skipBlockValidation: false,
          skipHardForkValidation: false,
          setHardfork: false,
          validateBlockSize: false,
        })
      } catch (error) {
        throw new ProtocolError(`replay failed at block ${block.header.number}: ${messageOf(error)}`)
      } finally {
        events?.off('beforeMessage', onBeforeMessage)
        events?.off('afterMessage', onAfterMessage)
      }
      if (
        messageStack.length !== 0 ||
        topLevelMessageCount < block.transactions.length
      ) {
        spendTraceComplete = false
      }
      for (let transactionIndex = 0; transactionIndex < block.transactions.length; transactionIndex += 1) {
        const tx = block.transactions[transactionIndex]
        const txResult = result.results[transactionIndex]
        if (tx === undefined || txResult === undefined) {
          spendTraceComplete = false
          continue
        }
        if (txResult.amountSpent > 0n) {
          recordSpendActivity(
            tx.getSenderAddress().toString(),
            transactionIndex,
            'transaction-fee',
            txResult.amountSpent,
          )
        }
      }
      const outcomes = outcomesFromRunResult(block, result)
      const receiptRlpHexes = result.receipts.map((receipt, receiptIndex) => {
        const tx = block.transactions[receiptIndex]
        if (tx === undefined) throw new ProtocolError('replayed receipt has no transaction')
        return asBytesHex(encodeReceipt(receipt, tx.type))
      })
      if (!compareJson(receiptRlpHexes, record.receiptRlpHexes)) {
        throw new ProtocolError(`receipt bytes differ from persisted sidecar at block ${block.header.number}`)
      }
      if (!compareJson(outcomes, record.outcomes)) {
        throw new ProtocolError(`execution outcomes differ from persisted sidecar at block ${block.header.number}`)
      }
      summaries.push(blockSummary(block, outcomes))
      await genesisSession.blockchain.putBlock(block)
      parent = block
    }

    const tipHash = asBytesHex(parent.hash())
    if (parent.header.number !== this.tipValue.number || tipHash !== this.tipValue.hash) {
      throw new ProtocolError('replayed tip does not match the canonical tip metadata')
    }
    return {
      vm: genesisSession.vm,
      common: genesisSession.common,
      blocks: records.map(({ block }) => block),
      records,
      spendActivityByAddress,
      spendTraceComplete,
      report: {
        tip: { number: parent.header.number, hash: tipHash },
        genesisStateRoot: asBytesHex(genesisSession.genesisStateRoot),
        blocks: summaries,
      },
    }
  }
}


export type CheckpointContinuationReplay = Readonly<{
  blocks: readonly ProcessedBlock[]
  checkpointAncestryBlocksLoaded: number
}>

/**
 * Re-executes child blocks from a checkpoint already recovered against a
 * replay-verified canonical view. The supplied state manager remains owned
 * by the caller and is never initialized with genesis balances.
 *
 * This verifies local execution only. It does not prove BTCS L1 publication,
 * settlement, finality, or trusted-anchor authenticity.
 */
export async function reexecuteFromVerifiedCheckpoint(
  canonicalView: CanonicalReadView,
  stateManager: ReplayStateManager,
  checkpoint: Pick<
    StateCheckpointManifest,
    'profileId' | 'blockHeight' | 'blockHash' | 'stateRoot'
  >,
  childBlockRlpHexes: readonly string[],
  childDepositOperations: readonly (readonly EvmDepositOperation[])[] = [],
): Promise<CheckpointContinuationReplay> {
  if (checkpoint.profileId !== LOCAL_CHAIN_PROFILE) {
    throw new ProtocolError('checkpoint continuation uses the wrong execution profile')
  }
  if (childBlockRlpHexes.length === 0) {
    throw new ProtocolError('checkpoint continuation must contain at least one child block')
  }
  if (
    childDepositOperations.length !== 0 &&
    childDepositOperations.length !== childBlockRlpHexes.length
  ) {
    throw new ProtocolError(
      'checkpoint continuation deposit-operation count does not match its blocks',
    )
  }

  const checkpointHeight = parseCanonicalUint(
    checkpoint.blockHeight,
    'checkpoint block height',
    MAX_BLOCK_NUMBER,
  )
  const checkpointData = canonicalView.getCanonicalBlockByNumber(checkpointHeight)
  if (checkpointData === undefined) {
    throw new ProtocolError('checkpoint height is absent from canonical history')
  }

  const checkpointSummary = checkpointData.summary
  if (
    checkpointSummary.number !== checkpoint.blockHeight ||
    checkpointSummary.hash.toLowerCase() !== checkpoint.blockHash.toLowerCase() ||
    checkpointSummary.stateRoot.toLowerCase() !== checkpoint.stateRoot.toLowerCase()
  ) {
    throw new ProtocolError('checkpoint identity or state root differs from canonical history')
  }

  const recoveredRoot = asBytesHex(await stateManager.getStateRoot())
  if (recoveredRoot !== checkpoint.stateRoot.toLowerCase()) {
    throw new ProtocolError(
      `recovered checkpoint state root mismatch: expected ${checkpoint.stateRoot}, got ${recoveredRoot}`,
    )
  }

  const { vm, common, blockchain } = await createExecutionVM(
    stateManager,
    { initializeGenesisState: false },
  )
  await vm.stateManager.setStateRoot(
    hexToBytes(checkpoint.stateRoot as `0x${string}`),
  )
  const vmRoot = asBytesHex(await vm.stateManager.getStateRoot())
  if (vmRoot !== checkpoint.stateRoot.toLowerCase()) {
    throw new ProtocolError('execution VM did not retain the recovered checkpoint state root')
  }

  // EVM BLOCKHASH can access at most the prior 256 block heights. Load that
  // exact suffix, including the checkpoint block, from verified local history.
  const historyWindow = BigInt(MAX_BLOCKHASH_HISTORY - 1)
  const ancestryStart = checkpointHeight > historyWindow
    ? checkpointHeight - historyWindow
    : 0n

  let parent: Block | undefined
  let checkpointBlock: Block | undefined
  let checkpointAncestryBlocksLoaded = 0

  for (let height = ancestryStart; height <= checkpointHeight; height++) {
    const canonical = canonicalView.getCanonicalBlockByNumber(height)
    if (canonical === undefined) {
      throw new ProtocolError(`required checkpoint ancestry block ${height} is missing`)
    }

    let block: Block
    try {
      block = createBlockFromRLP(
        hexToBytes(canonical.blockRlpHex as `0x${string}`),
        { common },
      )
    } catch (error) {
      throw new ProtocolError(
        `checkpoint ancestry block ${height} cannot be decoded: ${messageOf(error)}`,
      )
    }

    const summary = canonical.summary
    if (
      block.header.number !== height ||
      asBytesHex(block.hash()) !== summary.hash.toLowerCase() ||
      asBytesHex(block.header.parentHash) !== summary.parentHash.toLowerCase() ||
      asBytesHex(block.header.stateRoot) !== summary.stateRoot.toLowerCase() ||
      asBytesHex(block.header.transactionsTrie) !== summary.transactionsRoot.toLowerCase() ||
      asBytesHex(block.header.receiptTrie) !== summary.receiptsRoot.toLowerCase()
    ) {
      throw new ProtocolError(
        `checkpoint ancestry block ${height} differs from its canonical summary`,
      )
    }

    if (parent !== undefined) {
      validateChildHeader(block, parent, common)
    }
    await blockchain.putBlock(block)
    parent = block
    checkpointAncestryBlocksLoaded += 1

    if (height === checkpointHeight) checkpointBlock = block
  }

  if (checkpointBlock === undefined || parent === undefined) {
    throw new ProtocolError('checkpoint block was not loaded into the execution ancestry')
  }

  const seenDepositIds = new Set(
    canonicalView
      .getCanonicalDepositOperationsThroughHeight(checkpointHeight)
      .map((operation) => operation.depositId),
  )
  const reexecuted: ProcessedBlock[] = []
  parent = checkpointBlock

  for (let childIndex = 0; childIndex < childBlockRlpHexes.length; childIndex += 1) {
    const blockRlpHex = childBlockRlpHexes[childIndex]!
    const candidateDepositOperations = childDepositOperations[childIndex] ?? []
    let block: Block
    try {
      block = createBlockFromRLP(
        hexToBytes(blockRlpHex as `0x${string}`),
        { common },
      )
    } catch (error) {
      throw new ProtocolError(
        `continuation block cannot be decoded: ${messageOf(error)}`,
      )
    }

    if (asBytesHex(block.serialize()) !== blockRlpHex) {
      throw new ProtocolError('continuation block RLP is not canonical')
    }
    validateChildHeader(block, parent, common)
    const verifiedDepositOperations = verifyEvmDepositPrelude(
      candidateDepositOperations,
      block.header.extraData,
    )
    registerFreshDepositOperations(verifiedDepositOperations, seenDepositIds)
    canonicalizeTransactionBytes(
      block.transactions.map((tx) => new Uint8Array(tx.serialize())),
      common,
      block.header.baseFeePerGas!,
    )

    let result: RunBlockResult
    try {
      await applyEvmDepositOperations(vm, verifiedDepositOperations)
      result = await runBlock(vm, {
        block,
        skipHeaderValidation: true,
        skipBlockValidation: false,
        skipHardForkValidation: false,
        setHardfork: false,
        validateBlockSize: false,
      })
    } catch (error) {
      throw new ProtocolError(
        `checkpoint continuation replay failed at block ${block.header.number}: ${messageOf(error)}`,
      )
    }

    const summary = blockSummary(block, outcomesFromRunResult(block, result))
    const actualStateRoot = asBytesHex(await vm.stateManager.getStateRoot())
    if (actualStateRoot !== summary.stateRoot.toLowerCase()) {
      throw new ProtocolError(
        `replayed state root mismatch at block ${block.header.number}: expected ${summary.stateRoot}, got ${actualStateRoot}`,
      )
    }

    reexecuted.push({
      blockRlpHex: asBytesHex(block.serialize()),
      summary,
    })
    await blockchain.putBlock(block)
    parent = block
  }

  return {
    blocks: reexecuted,
    checkpointAncestryBlocksLoaded,
  }
}


async function persistContentAddressedRecord(
  path: string,
  record: BlockRecord,
  persistenceTestHook?: (stage: PersistenceStage) => void | Promise<void>,
): Promise<void> {
  const encoded = encodeJson(record)
  if (encoded.length > MAX_BLOCK_RECORD_BYTES) {
    throw new ProtocolError('complete block record exceeds the local persistence limit')
  }
  try {
    const existing = await readBoundedFile(path, MAX_BLOCK_RECORD_BYTES)
    let existingValue: unknown
    try {
      existingValue = JSON.parse(new TextDecoder().decode(existing)) as unknown
    } catch {
      throw new ProtocolError(`existing content-addressed record is corrupt: ${path}`)
    }
    if (!compareJson(existingValue, record)) {
      throw new ProtocolError(`content-address collision or mismatched existing record: ${path}`)
    }
    return
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await atomicWrite(path, encoded, 'block-record', persistenceTestHook)
}
