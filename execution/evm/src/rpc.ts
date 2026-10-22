import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createBlockFromRLP } from '@ethereumjs/block'
import { createFeeMarket1559TxFromRLP } from '@ethereumjs/tx'
import type { FeeMarket1559Tx } from '@ethereumjs/tx'
import { Address, bytesToHex, hexToBytes } from '@ethereumjs/util'
import { Bloom } from '@ethereumjs/vm'
import {
  PersistentBlockProcessor,
  ProtocolError,
  type CanonicalReadView,
  type BlockSummary,
  type CanonicalBlockData,
  type CanonicalReceiptData,
  type LogRecord,
} from './blockProcessor.js'
import { EVM_CHAIN_ID, EVM_HARDFORK, createHarnessCommon } from './config.js'
import {
  DevelopmentSequencer,
  MAX_RAW_TRANSACTION_BYTES,
  TransactionPoolError,
} from './transactionPool.js'

export const RPC_BIND_ADDRESS = '127.0.0.1'
export const DEFAULT_RPC_PORT = 8545
export const MAX_RPC_REQUEST_BYTES = 1_048_576
export const MAX_RPC_BATCH_COUNT = 20
export const MAX_RPC_RESPONSE_BYTES = 33_554_432
export const MAX_LOG_BLOCK_SPAN = 10_000n
export const MAX_LOG_RESULTS = 10_000
export const MAX_RPC_CONCURRENT_REQUESTS = 4
export const MAX_RPC_JSON_DEPTH = 32
export const MAX_RPC_JSON_NODES = 10_000
export const MAX_RPC_CONTAINER_ITEMS = 256

const MAX_FILTER_ADDRESSES = 64
const MAX_TOPIC_ALTERNATIVES = 32
const MAX_SAFE_BLOCK_NUMBER = BigInt(Number.MAX_SAFE_INTEGER)
const MAX_HTTP_PORT = 65_535

type RpcId = string | number | null
type RpcObject = Record<string, unknown>
type RpcResponse =
  | { jsonrpc: '2.0'; id: RpcId; result: unknown }
  | { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string } }

type RpcRequest = Readonly<{
  id: RpcId
  hasId: boolean
  method: string
  params: unknown
}>

type LogFilter = Readonly<{
  fromBlock?: bigint | 'latest' | 'earliest'
  toBlock?: bigint | 'latest' | 'earliest'
  blockHash?: string
  addresses?: readonly string[]
  topics?: readonly (null | string | readonly string[])[]
}>

export type LocalRpcServer = Readonly<{
  host: typeof RPC_BIND_ADDRESS
  port: number
  close: () => Promise<void>
}>

export type LocalRpcServerOptions = Readonly<{
  port?: number
  enableDevelopmentSequencer?: boolean
}>

class RpcFault extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
    this.name = 'RpcFault'
  }
}

class RequestTooLarge extends Error {}

type ReadViewLoader = () => Promise<CanonicalReadView>

function createReadViewLoader(chain: PersistentBlockProcessor): ReadViewLoader {
  let pending: Promise<CanonicalReadView> | undefined
  return () => {
    pending ??= chain.createCanonicalReadView()
    return pending
  }
}

function fault(code: number, message: string): never {
  throw new RpcFault(code, message)
}

function invalidParams(): never {
  return fault(-32602, 'Invalid params')
}

function quantity(value: bigint): string {
  if (value < 0n) throw new Error('negative quantity in verified chain data')
  return `0x${value.toString(16)}`
}

function normalizedBytes(value: Uint8Array): string {
  return bytesToHex(value).toLowerCase()
}

function parseDataHex(value: unknown, byteLength: number, label: string): string {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^0x[0-9a-fA-F]{${byteLength * 2}}$`).test(value)
  ) {
    return invalidParams()
  }
  return value.toLowerCase()
}

function parseAddress(value: unknown): Address {
  return new Address(hexToBytes(parseDataHex(value, 20, 'address') as `0x${string}`))
}

function parseQuantity(value: unknown, label: string): bigint {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 2 + 14 ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    return invalidParams()
  }
  let parsed: bigint
  try {
    parsed = BigInt(value)
  } catch {
    return invalidParams()
  }
  if (parsed > MAX_SAFE_BLOCK_NUMBER) return invalidParams()
  return parsed
}

function parseStoragePosition(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length < 3 ||
    value.length > 66 ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)
  ) {
    return invalidParams()
  }
  try {
    return BigInt(value)
  } catch {
    return invalidParams()
  }
}

function parseFilterBlockReference(value: unknown): bigint | 'latest' | 'earliest' {
  if (value === 'latest' || value === 'earliest') return value
  return parseQuantity(value, 'block parameter')
}

type BlockReference = bigint | 'latest' | 'earliest'

function parseBlockReference(value: unknown): BlockReference {
  if (value === 'latest' || value === 'earliest') return value
  if (value === 'pending' || value === 'safe' || value === 'finalized') return invalidParams()
  return parseQuantity(value, 'block parameter')
}

function resolveBlockReference(reference: BlockReference, latest: bigint): bigint {
  if (reference === 'latest') return latest
  if (reference === 'earliest') return 0n
  return reference
}

function paramsArray(params: unknown, expectedCount: number): unknown[] {
  if (!Array.isArray(params) || params.length !== expectedCount) return invalidParams()
  return params
}

function parseRpcRequest(value: unknown): RpcRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fault(-32600, 'Invalid Request')
  }
  const candidate = value as RpcObject
  if (Object.keys(candidate).some((key) => !['jsonrpc', 'method', 'params', 'id'].includes(key))) {
    fault(-32600, 'Invalid Request')
  }
  const hasId = Object.prototype.hasOwnProperty.call(candidate, 'id')
  const id = candidate.id
  if (
    candidate.jsonrpc !== '2.0' ||
    typeof candidate.method !== 'string' ||
    candidate.method.length === 0 ||
    candidate.method.length > 128 ||
    (hasId &&
      !(id === null ||
        (typeof id === 'string' && id.length <= 128) ||
        (typeof id === 'number' && Number.isSafeInteger(id))))
  ) {
    fault(-32600, 'Invalid Request')
  }
  const params = candidate.params === undefined ? [] : candidate.params
  if (!Array.isArray(params) && (typeof params !== 'object' || params === null)) {
    fault(-32600, 'Invalid Request')
  }
  return { id: hasId ? (id as RpcId) : null, hasId, method: candidate.method, params }
}

function errorResponse(id: RpcId, code: number, message: string): RpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function requestError(error: unknown): RpcFault {
  if (error instanceof RpcFault) return error
  if (error instanceof TransactionPoolError) return new RpcFault(error.code, error.message)
  if (error instanceof ProtocolError) return new RpcFault(-32000, 'Canonical chain verification failed')
  return new RpcFault(-32603, 'Internal error')
}

async function handleOne(
  readView: ReadViewLoader,
  request: RpcRequest,
  developmentSequencer?: DevelopmentSequencer,
): Promise<RpcResponse | undefined> {
  try {
    const result = await dispatch(readView, request.method, request.params, developmentSequencer)
    return request.hasId ? { jsonrpc: '2.0', id: request.id, result } : undefined
  } catch (error) {
    const rpcError = requestError(error)
    return request.hasId ? errorResponse(request.id, rpcError.code, rpcError.message) : undefined
  }
}

function hasDuplicateObjectProperties(json: string): boolean {
  let position = 0
  let duplicate = false
  let nodes = 0
  const whitespace = /[\u0009\u000a\u000d\u0020]/

  const skipWhitespace = (): void => {
    while (position < json.length && whitespace.test(json[position]!)) position += 1
  }

  const parseString = (): string => {
    const start = position
    position += 1
    while (position < json.length) {
      const current = json[position]!
      if (current === '\\') {
        position += 2
      } else if (current === '"') {
        position += 1
        return JSON.parse(json.slice(start, position)) as string
      } else {
        position += 1
      }
    }
    throw new Error('JSON string scanner ended unexpectedly')
  }

  const parseValue = (depth: number): void => {
    nodes += 1
    if (nodes > MAX_RPC_JSON_NODES || depth > MAX_RPC_JSON_DEPTH) {
      fault(-32600, 'Invalid Request')
    }
    skipWhitespace()
    const current = json[position]
    if (current === '"') {
      parseString()
      return
    }
    if (current === '{') {
      position += 1
      skipWhitespace()
      const keys = new Set<string>()
      let properties = 0
      if (json[position] === '}') {
        position += 1
        return
      }
      while (position < json.length) {
        skipWhitespace()
        properties += 1
        if (properties > MAX_RPC_CONTAINER_ITEMS) fault(-32600, 'Invalid Request')
        const key = parseString()
        if (keys.has(key)) duplicate = true
        keys.add(key)
        skipWhitespace()
        position += 1 // Colon; JSON.parse has already validated the syntax.
        parseValue(depth + 1)
        skipWhitespace()
        if (json[position] === ',') {
          position += 1
          continue
        }
        if (json[position] === '}') {
          position += 1
          return
        }
        throw new Error('JSON object scanner ended unexpectedly')
      }
      throw new Error('JSON object scanner ended unexpectedly')
    }
    if (current === '[') {
      position += 1
      skipWhitespace()
      if (json[position] === ']') {
        position += 1
        return
      }
      let items = 0
      while (position < json.length) {
        items += 1
        if (items > MAX_RPC_CONTAINER_ITEMS) fault(-32600, 'Invalid Request')
        parseValue(depth + 1)
        skipWhitespace()
        if (json[position] === ',') {
          position += 1
          continue
        }
        if (json[position] === ']') {
          position += 1
          return
        }
        throw new Error('JSON array scanner ended unexpectedly')
      }
      throw new Error('JSON array scanner ended unexpectedly')
    }
    while (
      position < json.length &&
      !whitespace.test(json[position]!) &&
      !',]}'.includes(json[position]!)
    ) {
      position += 1
    }
  }

  parseValue(0)
  return duplicate
}

async function handleJsonRpc(
  chain: PersistentBlockProcessor,
  value: unknown,
  source: string,
  developmentSequencer?: DevelopmentSequencer,
): Promise<unknown> {
  try {
    if (hasDuplicateObjectProperties(source)) {
      return errorResponse(null, -32600, 'Duplicate JSON object property')
    }
  } catch (error) {
    if (error instanceof RpcFault) throw error
    return errorResponse(null, -32600, 'Invalid Request')
  }
  const readView = createReadViewLoader(chain)
  if (Array.isArray(value)) {
    if (value.length === 0) return errorResponse(null, -32600, 'Invalid Request')
    if (value.length > MAX_RPC_BATCH_COUNT) {
      return errorResponse(null, -32600, 'Batch exceeds the configured limit')
    }
    const responses: RpcResponse[] = []
    for (const item of value) {
      let request: RpcRequest
      try {
        request = parseRpcRequest(item)
      } catch (error) {
        const rpcError = requestError(error)
        responses.push(errorResponse(null, rpcError.code, rpcError.message))
        continue
      }
      const response = await handleOne(readView, request, developmentSequencer)
      if (response !== undefined) responses.push(response)
    }
    return responses.length === 0 ? undefined : responses
  }

  let request: RpcRequest
  try {
    request = parseRpcRequest(value)
  } catch (error) {
    const rpcError = requestError(error)
    return errorResponse(null, rpcError.code, rpcError.message)
  }
  return handleOne(readView, request, developmentSequencer)
}

function parseLogFilter(value: unknown): LogFilter {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalidParams()
  const candidate = value as RpcObject
  const allowed = new Set(['fromBlock', 'toBlock', 'blockHash', 'address', 'topics'])
  if (Object.keys(candidate).some((key) => !allowed.has(key))) return invalidParams()
  if (candidate.blockHash !== undefined &&
      (candidate.fromBlock !== undefined || candidate.toBlock !== undefined)) {
    return invalidParams()
  }

  let blockHash: string | undefined
  if (candidate.blockHash !== undefined) blockHash = parseDataHex(candidate.blockHash, 32, 'blockHash')
  let addresses: string[] | undefined
  if (candidate.address !== undefined) {
    const provided = Array.isArray(candidate.address) ? candidate.address : [candidate.address]
    if (provided.length > MAX_FILTER_ADDRESSES) return invalidParams()
    addresses = provided.map((address) => parseDataHex(address, 20, 'address'))
  }

  let topics: Array<null | string | string[]> | undefined
  if (candidate.topics !== undefined) {
    if (!Array.isArray(candidate.topics) || candidate.topics.length > 4) return invalidParams()
    topics = candidate.topics.map((topic) => {
      if (topic === null) return null
      if (typeof topic === 'string') return parseDataHex(topic, 32, 'topic')
      if (!Array.isArray(topic) || topic.length > MAX_TOPIC_ALTERNATIVES) return invalidParams()
      return topic.map((alternative) => parseDataHex(alternative, 32, 'topic'))
    })
  }

  return {
    ...(candidate.fromBlock === undefined ? {} : { fromBlock: parseFilterBlockReference(candidate.fromBlock) }),
    ...(candidate.toBlock === undefined ? {} : { toBlock: parseFilterBlockReference(candidate.toBlock) }),
    ...(blockHash === undefined ? {} : { blockHash }),
    ...(addresses === undefined ? {} : { addresses }),
    ...(topics === undefined ? {} : { topics }),
  }
}

function matchesLog(log: LogRecord, filter: LogFilter): boolean {
  if (filter.addresses !== undefined && !filter.addresses.includes(log.address.toLowerCase())) return false
  if (filter.topics !== undefined) {
    for (let index = 0; index < filter.topics.length; index++) {
      const requested = filter.topics[index]
      if (requested === null) continue
      const actual = log.topics[index]?.toLowerCase()
      if (actual === undefined) return false
      if (typeof requested === 'string' ? actual !== requested : !requested.includes(actual)) return false
    }
  }
  return true
}

function validateFixedLogRange(filter: LogFilter): void {
  if (filter.blockHash !== undefined) return
  const fixed = (reference: bigint | 'latest' | 'earliest' | undefined): bigint | undefined => {
    if (reference === undefined || reference === 'latest') return undefined
    return reference === 'earliest' ? 0n : reference
  }
  const fromBlock = fixed(filter.fromBlock)
  const toBlock = fixed(filter.toBlock)
  if (fromBlock === undefined || toBlock === undefined) return
  if (fromBlock > toBlock) return invalidParams()
  if (toBlock - fromBlock + 1n > MAX_LOG_BLOCK_SPAN) {
    fault(-32005, 'Log query exceeds the configured block span')
  }
}

function formatLog(
  block: BlockSummary,
  transactionHash: string,
  transactionIndex: number,
  logIndex: number,
  log: LogRecord,
) {
  return {
    address: log.address,
    topics: [...log.topics],
    data: log.data,
    blockNumber: quantity(BigInt(block.number)),
    transactionHash,
    transactionIndex: quantity(BigInt(transactionIndex)),
    blockHash: block.hash,
    logIndex: quantity(BigInt(logIndex)),
    removed: false,
  }
}

async function getLogs(readView: ReadViewLoader, rawFilter: unknown): Promise<unknown[]> {
  const filter = parseLogFilter(rawFilter)
  validateFixedLogRange(filter)
  const replay = (await readView()).report
  const latest = replay.tip.number
  let fromBlock: bigint
  let toBlock: bigint
  if (filter.blockHash !== undefined) {
    const matched = replay.blocks.find((block) => block.hash === filter.blockHash)
    if (matched === undefined) return []
    fromBlock = BigInt(matched.number)
    toBlock = fromBlock
  } else {
    const resolve = (reference: bigint | 'latest' | 'earliest' | undefined): bigint | undefined => {
      if (reference === undefined) return undefined
      if (reference === 'latest') return latest
      if (reference === 'earliest') return 0n
      return reference
    }
    const requestedTo = resolve(filter.toBlock)
    const requestedFrom = resolve(filter.fromBlock)
    toBlock = requestedTo ?? latest
    fromBlock = requestedFrom ?? latest
    if (fromBlock > latest || toBlock > latest || fromBlock > toBlock) return invalidParams()
  }
  if (toBlock - fromBlock + 1n > MAX_LOG_BLOCK_SPAN) {
    fault(-32005, 'Log query exceeds the configured block span')
  }

  const logs: unknown[] = []
  for (let number = fromBlock; number <= toBlock; number++) {
    const block = replay.blocks[Number(number)]
    if (block === undefined) continue
    let blockLogIndex = 0
    for (let transactionIndex = 0; transactionIndex < block.receipts.length; transactionIndex++) {
      const outcome = block.receipts[transactionIndex]
      if (outcome === undefined) continue
      for (const log of outcome.logs) {
        const currentIndex = blockLogIndex
        blockLogIndex += 1
        if (matchesLog(log, filter)) {
          logs.push(formatLog(
            block,
            outcome.transactionHash,
            transactionIndex,
            currentIndex,
            log,
          ))
          if (logs.length > MAX_LOG_RESULTS) fault(-32005, 'Log query exceeds the configured result limit')
        }
      }
    }
  }
  return logs
}

function parseBlockRlp(data: CanonicalBlockData) {
  return createBlockFromRLP(hexToBytes(data.blockRlpHex as `0x${string}`), {
    common: createHarnessCommon(),
  })
}

function effectiveGasPrice(tx: FeeMarket1559Tx, baseFee: bigint): bigint {
  return baseFee + tx.getEffectivePriorityFee(baseFee)
}

function fullTransactionJson(
  tx: FeeMarket1559Tx,
  block: ReturnType<typeof parseBlockRlp>,
  blockHash: string,
  transactionIndex: number,
) {
  const baseFee = block.header.baseFeePerGas ?? 0n
  const yParity = tx.v
  if (yParity === undefined || tx.r === undefined || tx.s === undefined) {
    throw new Error('verified canonical transaction is missing signature values')
  }
  return {
    blockHash,
    blockNumber: quantity(block.header.number),
    from: tx.getSenderAddress().toString().toLowerCase(),
    gas: quantity(tx.gasLimit),
    gasPrice: quantity(effectiveGasPrice(tx, baseFee)),
    maxFeePerGas: quantity(tx.maxFeePerGas),
    maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas),
    type: quantity(BigInt(tx.type)),
    accessList: tx.accessList.map(([address, slots]) => ({
      address: normalizedBytes(address),
      storageKeys: slots.map(normalizedBytes),
    })),
    chainId: quantity(tx.chainId),
    hash: normalizedBytes(tx.hash()),
    input: normalizedBytes(tx.data),
    nonce: quantity(tx.nonce),
    to: tx.to?.toString().toLowerCase() ?? null,
    transactionIndex: quantity(BigInt(transactionIndex)),
    value: quantity(tx.value),
    v: quantity(yParity),
    r: quantity(tx.r),
    s: quantity(tx.s),
    yParity: quantity(yParity),
  }
}

function blockJson(data: CanonicalBlockData, fullTransactions: boolean): RpcObject {
  const block = parseBlockRlp(data)
  const header = block.header
  const transactions = block.transactions.map((transaction, index) => {
    if (transaction.type !== 2) throw new Error('verified local block contains an unsupported transaction type')
    return fullTransactions
      ? fullTransactionJson(transaction, block, data.summary.hash, index)
      : normalizedBytes(transaction.hash())
  })
  return {
    number: quantity(header.number),
    hash: data.summary.hash,
    parentHash: normalizedBytes(header.parentHash),
    nonce: normalizedBytes(header.nonce),
    sha3Uncles: normalizedBytes(header.uncleHash),
    logsBloom: normalizedBytes(header.logsBloom),
    transactionsRoot: normalizedBytes(header.transactionsTrie),
    stateRoot: normalizedBytes(header.stateRoot),
    receiptsRoot: normalizedBytes(header.receiptTrie),
    miner: header.coinbase.toString().toLowerCase(),
    difficulty: quantity(header.difficulty),
    extraData: normalizedBytes(header.extraData),
    gasLimit: quantity(header.gasLimit),
    gasUsed: quantity(header.gasUsed),
    timestamp: quantity(header.timestamp),
    transactions,
    uncles: [],
    size: quantity(BigInt(block.serialize().length)),
    mixHash: normalizedBytes(header.mixHash),
    baseFeePerGas: quantity(header.baseFeePerGas ?? 0n),
    withdrawals: [],
    withdrawalsRoot: normalizedBytes(header.withdrawalsRoot ?? new Uint8Array()),
    blobGasUsed: quantity(header.blobGasUsed ?? 0n),
    excessBlobGas: quantity(header.excessBlobGas ?? 0n),
    parentBeaconBlockRoot: normalizedBytes(header.parentBeaconBlockRoot ?? new Uint8Array()),
    ...(header.requestsHash === undefined ? {} : { requestsHash: normalizedBytes(header.requestsHash) }),
  }
}

function receiptJson(receipt: CanonicalReceiptData): RpcObject {
  const block = parseBlockRlp(receipt.block)
  const tx = createFeeMarket1559TxFromRLP(
    hexToBytes(receipt.transactionRlpHex as `0x${string}`),
    { common: createHarnessCommon() },
  )
  const outcome = receipt.outcome
  const bloom = new Bloom(new Uint8Array(256), createHarnessCommon())
  for (const log of outcome.logs) {
    bloom.add(hexToBytes(log.address as `0x${string}`))
    for (const topic of log.topics) bloom.add(hexToBytes(topic as `0x${string}`))
  }

  let logIndex = 0
  for (let index = 0; index < receipt.transactionIndex; index++) {
    logIndex += receipt.block.summary.receipts[index]?.logs.length ?? 0
  }
  const logs = outcome.logs.map((log, index) => formatLog(
    receipt.block.summary,
    outcome.transactionHash,
    receipt.transactionIndex,
    logIndex + index,
    log,
  ))
  const baseFee = block.header.baseFeePerGas ?? 0n
  return {
    transactionHash: outcome.transactionHash,
    transactionIndex: quantity(BigInt(receipt.transactionIndex)),
    blockHash: receipt.block.summary.hash,
    blockNumber: quantity(BigInt(receipt.block.summary.number)),
    from: tx.getSenderAddress().toString().toLowerCase(),
    to: tx.to?.toString().toLowerCase() ?? null,
    cumulativeGasUsed: quantity(BigInt(outcome.cumulativeGasUsed)),
    gasUsed: quantity(BigInt(outcome.gasUsed)),
    contractAddress: outcome.status === 1 ? (outcome.createdAddress ?? null) : null,
    logs,
    logsBloom: normalizedBytes(bloom.bitvector),
    status: quantity(BigInt(outcome.status)),
    effectiveGasPrice: quantity(effectiveGasPrice(tx, baseFee)),
    type: quantity(BigInt(tx.type)),
  }
}

async function dispatch(
  readView: ReadViewLoader,
  method: string,
  params: unknown,
  developmentSequencer?: DevelopmentSequencer,
): Promise<unknown> {
  switch (method) {
    case 'web3_clientVersion': {
      paramsArray(params, 0)
      return `BTCSL2/v0.14-local/ethereumjs-vm-10.1.3/${EVM_HARDFORK}`
    }
    case 'eth_chainId': {
      paramsArray(params, 0)
      return quantity(EVM_CHAIN_ID)
    }
    case 'eth_blockNumber': {
      paramsArray(params, 0)
      return quantity((await readView()).report.tip.number)
    }
    case 'eth_getBlockByNumber': {
      const [reference, fullTransactions] = paramsArray(params, 2)
      if (typeof fullTransactions !== 'boolean') return invalidParams()
      const parsedReference = parseBlockReference(reference)
      const view = await readView()
      const tip = view.report.tip.number
      const number = resolveBlockReference(parsedReference, tip)
      const block = view.getCanonicalBlockByNumber(number)
      return block === undefined ? null : blockJson(block, fullTransactions)
    }
    case 'eth_getBlockByHash': {
      const [hash, fullTransactions] = paramsArray(params, 2)
      if (typeof fullTransactions !== 'boolean') return invalidParams()
      const block = (await readView()).getCanonicalBlockByHash(parseDataHex(hash, 32, 'block hash'))
      return block === undefined ? null : blockJson(block, fullTransactions)
    }
    case 'eth_getTransactionReceipt': {
      const [hash] = paramsArray(params, 1)
      const transactionHash = parseDataHex(hash, 32, 'transaction hash')
      const receipt = (await readView()).getCanonicalReceiptByTransactionHash(transactionHash)
      return receipt === undefined ? null : receiptJson(receipt)
    }
    case 'eth_getCode': {
      const [address, reference] = paramsArray(params, 2)
      const parsedAddress = parseAddress(address)
      const parsedReference = parseBlockReference(reference)
      const view = await readView()
      const tip = view.report.tip.number
      const number = resolveBlockReference(parsedReference, tip)
      if (number > tip) return invalidParams()
      return normalizedBytes(await view.getCode(parsedAddress, number))
    }
    case 'eth_getStorageAt': {
      const [address, position, reference] = paramsArray(params, 3)
      const parsedAddress = parseAddress(address)
      const slot = hexToBytes(`0x${parseStoragePosition(position).toString(16).padStart(64, '0')}`)
      const parsedReference = parseBlockReference(reference)
      const view = await readView()
      const tip = view.report.tip.number
      const number = resolveBlockReference(parsedReference, tip)
      if (number > tip) return invalidParams()
      const value = await view.getStorage(parsedAddress, slot, number)
      if (value.length > 32) throw new Error('verified storage value exceeds a word')
      const padded = new Uint8Array(32)
      padded.set(value, 32 - value.length)
      return normalizedBytes(padded)
    }
    case 'eth_getBalance': {
      const [address, reference] = paramsArray(params, 2)
      const parsedAddress = parseAddress(address)
      const parsedReference = parseBlockReference(reference)
      const view = await readView()
      const tip = view.report.tip.number
      const number = resolveBlockReference(parsedReference, tip)
      if (number > tip) return invalidParams()
      return quantity(await view.getAccountBalance(parsedAddress, number))
    }
    case 'eth_getTransactionCount': {
      const [address, reference] = paramsArray(params, 2)
      const parsedAddress = parseAddress(address)
      const parsedReference = parseBlockReference(reference)
      const view = await readView()
      const tip = view.report.tip.number
      const number = resolveBlockReference(parsedReference, tip)
      if (number > tip) return invalidParams()
      return quantity(await view.getAccountNonce(parsedAddress, number))
    }
    case 'eth_getLogs': {
      const [filter] = paramsArray(params, 1)
      return getLogs(readView, filter)
    }
    case 'eth_sendRawTransaction': {
      if (developmentSequencer === undefined) fault(-32601, 'Method not found')
      const [rawTransaction] = paramsArray(params, 1)
      if (
        typeof rawTransaction !== 'string' ||
        !rawTransaction.startsWith('0x') ||
        rawTransaction.length < 4 ||
        (rawTransaction.length - 2) % 2 !== 0
      ) {
        return invalidParams()
      }
      if (rawTransaction.length > 2 + MAX_RAW_TRANSACTION_BYTES * 2) {
        fault(-32005, 'Raw transaction exceeds the configured size limit')
      }
      if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(rawTransaction)) return invalidParams()
      return developmentSequencer.submit(hexToBytes(rawTransaction as `0x${string}`))
    }
    case 'btcs_dev_mine': {
      if (developmentSequencer === undefined) fault(-32601, 'Method not found')
      paramsArray(params, 0)
      const result = await developmentSequencer.produceBlock()
      return {
        number: quantity(BigInt(result.block.number)),
        hash: result.block.hash,
        parentHash: result.block.parentHash,
        timestamp: quantity(BigInt(result.block.timestamp)),
        gasLimit: quantity(BigInt(result.block.gasLimit)),
        gasUsed: quantity(BigInt(result.block.gasUsed)),
        baseFeePerGas: quantity(BigInt(result.block.baseFeePerGas)),
        transactionsRoot: result.block.transactionsRoot,
        receiptsRoot: result.block.receiptsRoot,
        stateRoot: result.block.stateRoot,
        transactions: [...result.includedTransactions],
        discardedTransactions: result.discardedTransactions.map((entry) => ({ ...entry })),
      }
    }
    default:
      fault(-32601, 'Method not found')
  }
}

export function isAllowedRpcHost(rawHost: string | undefined, port: number): boolean {
  if (rawHost === undefined) return false
  const host = rawHost.toLowerCase()
  return host === `${RPC_BIND_ADDRESS}:${port}` ||
    host === `localhost:${port}` ||
    (port === 80 && (host === RPC_BIND_ADDRESS || host === 'localhost'))
}

function setResponseHeaders(response: ServerResponse): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Content-Type-Options', 'nosniff')
}

function sendHttpError(response: ServerResponse, status: number, code: number, message: string): void {
  if (response.headersSent || response.destroyed) return
  setResponseHeaders(response)
  const body = JSON.stringify(errorResponse(null, code, message))
  response.writeHead(status, { 'Content-Length': Buffer.byteLength(body) })
  response.end(body)
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const declaredLength = request.headers['content-length']
  if (declaredLength !== undefined && Number(declaredLength) > MAX_RPC_REQUEST_BYTES) {
    request.resume()
    throw new RequestTooLarge()
  }
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    request.on('data', (chunk: Buffer | Uint8Array) => {
      if (done) return
      size += chunk.length
      if (size > MAX_RPC_REQUEST_BYTES) {
        done = true
        chunks.length = 0
        reject(new RequestTooLarge())
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    request.once('end', () => {
      if (done) return
      done = true
      resolve(Buffer.concat(chunks, size))
    })
    request.once('error', (error) => {
      if (done) return
      done = true
      reject(error)
    })
  })
}

function oversizedResponseReplacement(value: unknown): unknown {
  const replace = (entry: unknown): RpcResponse => {
    const id =
      typeof entry === 'object' && entry !== null && !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, 'id')
        ? ((entry as RpcObject).id as RpcId)
        : null
    return errorResponse(id, -32005, 'Response exceeds the configured limit')
  }
  return Array.isArray(value) ? value.map(replace) : replace(value)
}

export function serializeBoundedRpcResponse(value: unknown): string {
  const serialize = (candidate: unknown): string => {
    const result = JSON.stringify(candidate)
    if (result === undefined) throw new Error('RPC response is not JSON serializable')
    return result
  }
  let response = serialize(value)
  if (Buffer.byteLength(response) > MAX_RPC_RESPONSE_BYTES) {
    response = serialize(oversizedResponseReplacement(value))
  }
  return response
}

async function handleHttpRequest(
  chain: PersistentBlockProcessor,
  request: IncomingMessage,
  response: ServerResponse,
  port: number,
  developmentSequencer?: DevelopmentSequencer,
): Promise<void> {
  if (request.socket.remoteAddress !== RPC_BIND_ADDRESS || !isAllowedRpcHost(request.headers.host, port)) {
    sendHttpError(response, 403, -32600, 'Loopback requests only')
    request.resume()
    return
  }
  if (request.method !== 'POST') {
    sendHttpError(response, 405, -32600, 'POST required')
    request.resume()
    return
  }
  if (request.url !== '/') {
    sendHttpError(response, 404, -32600, 'Unknown RPC path')
    request.resume()
    return
  }
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
  if (contentType !== 'application/json' ||
      (request.headers['content-encoding'] !== undefined &&
       request.headers['content-encoding'].toLowerCase() !== 'identity')) {
    sendHttpError(response, 415, -32600, 'application/json content type required')
    request.resume()
    return
  }

  let body: Buffer
  try {
    body = await readBody(request)
  } catch (error) {
    if (error instanceof RequestTooLarge) {
      sendHttpError(response, 413, -32005, 'Request exceeds the configured body limit')
    } else {
      sendHttpError(response, 400, -32700, 'Parse error')
    }
    return
  }

  let parsed: unknown
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(body)
    parsed = JSON.parse(source) as unknown
  } catch {
    sendHttpError(response, 400, -32700, 'Parse error')
    return
  }

  let rpcResponse: unknown
  try {
    rpcResponse = await handleJsonRpc(chain, parsed, source, developmentSequencer)
  } catch (error) {
    const rpcError = requestError(error)
    rpcResponse = errorResponse(null, rpcError.code, rpcError.message)
  }
  if (rpcResponse === undefined) {
    response.writeHead(204, { 'Cache-Control': 'no-store' })
    response.end()
    return
  }

  const serialized = serializeBoundedRpcResponse(rpcResponse)
  setResponseHeaders(response)
  response.writeHead(200, { 'Content-Length': Buffer.byteLength(serialized) })
  response.end(serialized)
}

export async function startLocalRpcServer(
  chain: PersistentBlockProcessor,
  options: LocalRpcServerOptions = {},
): Promise<LocalRpcServer> {
  const port = options.port ?? DEFAULT_RPC_PORT
  if (!Number.isInteger(port) || port < 0 || port > MAX_HTTP_PORT) {
    throw new RangeError('RPC port must be an integer from 0 through 65535')
  }
  const developmentSequencer = options.enableDevelopmentSequencer === true
    ? new DevelopmentSequencer(chain)
    : undefined
  let inFlightRequests = 0
  const server: Server = createServer((request, response) => {
    if (inFlightRequests >= MAX_RPC_CONCURRENT_REQUESTS) {
      response.shouldKeepAlive = false
      sendHttpError(response, 503, -32005, 'Too many concurrent RPC requests')
      request.resume()
      return
    }
    inFlightRequests += 1
    void handleHttpRequest(
      chain,
      request,
      response,
      port === 0 ? (server.address() as AddressInfo).port : port,
      developmentSequencer,
    )
      .catch(() => sendHttpError(response, 500, -32603, 'Internal error'))
      .finally(() => { inFlightRequests -= 1 })
  })
  server.maxHeadersCount = 64
  server.headersTimeout = 5_000
  server.requestTimeout = 10_000
  server.keepAliveTimeout = 5_000
  server.maxRequestsPerSocket = 100
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.off('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ host: RPC_BIND_ADDRESS, port, exclusive: true })
  })
  const actualPort = (server.address() as AddressInfo).port
  return {
    host: RPC_BIND_ADDRESS,
    port: actualPort,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
      server.closeAllConnections()
    }),
  }
}

// Withdrawal RPC methods
import { WithdrawalService } from './withdrawalService.js'
import { L1PayoutAdapter } from './l1PayoutAdapter.js'
