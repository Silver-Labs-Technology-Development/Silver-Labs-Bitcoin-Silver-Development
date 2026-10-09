import { createBlock, genTransactionsTrieRoot } from '@ethereumjs/block'
import {
  Address,
  KECCAK256_RLP,
  KECCAK256_RLP_ARRAY,
  SHA256_NULL,
  bytesToHex,
  createAccount,
  createContractAddress,
} from '@ethereumjs/util'
import { createFeeMarket1559TxFromRLP } from '@ethereumjs/tx'
import type { FeeMarket1559Tx } from '@ethereumjs/tx'
import { createVM, runTx } from '@ethereumjs/vm'
import {
  createHarnessCommon,
  EVM_CHAIN_ID,
  EVM_HARDFORK,
  GENESIS_BALANCE,
  SENDER_ADDRESS,
  type BlockContext,
} from './config.js'

export type OrderedTransaction = Readonly<{ label: string; tx: FeeMarket1559Tx }>

export type LogSummary = Readonly<{
  address: string
  topics: string[]
  data: string
}>

export type TransactionSummary = Readonly<{
  label: string
  hash: string
  senderAddress: string
  senderNonceAfter: string
  senderBalanceAfter: string
  status: 0 | 1
  gasUsed: string
  cumulativeGasUsed: string
  logs: LogSummary[]
  createdAddress?: string
  deploymentCodeBytesAfter?: number
  stateRootAfter: string
  counterSlot0After?: string
}>

export type ExecutionReport = Readonly<{
  chainId: string
  hardfork: string
  blockContext: Readonly<{
    parentHash: string
    coinbase: string
    difficulty: string
    number: string
    timestamp: string
    gasLimit: string
    baseFeePerGas: string
    mixHash: string
    blobGasUsed: string
    excessBlobGas: string
    parentBeaconBlockRoot: string
    withdrawalsRoot: string
    requestsHash: string
  }>
  genesisStateRoot: string
  transactionsTrieRoot: string
  stateRoot: string
  totalGasUsed: string
  transactions: TransactionSummary[]
}>

type CanonicalTransaction = Readonly<{
  label: string
  tx: FeeMarket1559Tx
  sender: Address
}>

const ZERO_SLOT = new Uint8Array(32)

function bytesToBigInt(value: Uint8Array): bigint {
  let result = 0n
  for (const byte of value) result = (result << 8n) | BigInt(byte)
  return result
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function copyAndValidateBlockContext(blockContext: BlockContext): BlockContext {
  if (blockContext.parentHash.length !== 32) {
    throw new Error('parentHash must be exactly 32 bytes')
  }
  if (blockContext.mixHash.length !== 32) {
    throw new Error('mixHash/prevRandao must be exactly 32 bytes')
  }
  if (blockContext.parentBeaconBlockRoot.length !== 32) {
    throw new Error('parentBeaconBlockRoot must be exactly 32 bytes')
  }
  if (blockContext.coinbase.bytes.length !== 20) {
    throw new Error('coinbase must be exactly 20 bytes')
  }
  for (const [name, value] of Object.entries({
    number: blockContext.number,
    timestamp: blockContext.timestamp,
    gasLimit: blockContext.gasLimit,
    baseFeePerGas: blockContext.baseFeePerGas,
    difficulty: blockContext.difficulty,
    blobGasUsed: blockContext.blobGasUsed,
    excessBlobGas: blockContext.excessBlobGas,
  })) {
    if (value < 0n) throw new Error(`${name} cannot be negative`)
  }

  // Copy mutable byte arrays before any asynchronous execution begins.
  return {
    ...blockContext,
    parentHash: new Uint8Array(blockContext.parentHash),
    mixHash: new Uint8Array(blockContext.mixHash),
    parentBeaconBlockRoot: new Uint8Array(blockContext.parentBeaconBlockRoot),
    coinbase: new Address(blockContext.coinbase.bytes),
  }
}

function decodeAndValidateTransactions(
  orderedTransactions: readonly OrderedTransaction[],
  common: ReturnType<typeof createHarnessCommon>,
  blockContext: BlockContext,
): CanonicalTransaction[] {
  if (common.chainId() !== EVM_CHAIN_ID || common.hardfork() !== EVM_HARDFORK) {
    throw new Error('internal EVM chain configuration does not match its pinned values')
  }

  return orderedTransactions.map(({ label, tx: suppliedTx }) => {
    if (suppliedTx.type !== 2) {
      throw new Error(`transaction ${label} is not an EIP-1559 type-2 transaction`)
    }

    let serialized: Uint8Array
    try {
      serialized = suppliedTx.serialize()
    } catch (error) {
      throw new Error(`transaction ${label} could not be serialized: ${errorMessage(error)}`)
    }
    if (serialized.length === 0 || serialized[0] !== 0x02) {
      throw new Error(`transaction ${label} does not have the EIP-1559 type-2 envelope`)
    }

    // Do not execute a transaction object carrying a caller-selected Common.
    // Its serialized bytes are the input; decoding binds all gas, signature,
    // and hardfork behavior to this harness's pinned Common instance.
    let tx: FeeMarket1559Tx
    try {
      tx = createFeeMarket1559TxFromRLP(serialized, { common })
    } catch (error) {
      throw new Error(
        `transaction ${label} has invalid EIP-1559 encoding or fields: ${errorMessage(error)}`,
      )
    }

    if (tx.type !== 2) {
      throw new Error(`transaction ${label} is not an EIP-1559 type-2 transaction`)
    }
    if (tx.chainId !== EVM_CHAIN_ID) {
      throw new Error(`transaction ${label} has a chain ID other than ${EVM_CHAIN_ID}`)
    }
    if (!tx.isSigned()) {
      throw new Error(`transaction ${label} has no signature`)
    }
    if (!tx.verifySignature()) {
      throw new Error(`transaction ${label} has an invalid signature`)
    }
    if (tx.common.chainId() !== EVM_CHAIN_ID || tx.common.hardfork() !== EVM_HARDFORK) {
      throw new Error(`transaction ${label} was not decoded with the pinned EVM configuration`)
    }
    const validationErrors = tx.getValidationErrors()
    if (validationErrors.length > 0) {
      throw new Error(`transaction ${label} is invalid: ${validationErrors.join('; ')}`)
    }
    if (tx.maxFeePerGas < blockContext.baseFeePerGas) {
      throw new Error(`transaction ${label} maxFeePerGas is below the block base fee`)
    }

    let sender: Address
    try {
      sender = tx.getSenderAddress()
    } catch (error) {
      throw new Error(`transaction ${label} sender recovery failed: ${errorMessage(error)}`)
    }
    return { label, tx, sender }
  })
}

export async function executeOrderedTransactions(
  orderedTransactions: readonly OrderedTransaction[],
  untrustedBlockContext: BlockContext,
): Promise<ExecutionReport> {
  const blockContext = copyAndValidateBlockContext(untrustedBlockContext)
  const common = createHarnessCommon()
  const canonicalTransactions = decodeAndValidateTransactions(
    orderedTransactions,
    common,
    blockContext,
  )

  const vm = await createVM({ common, activatePrecompiles: true })
  await vm.stateManager.putAccount(SENDER_ADDRESS, createAccount({ balance: GENESIS_BALANCE }))
  const genesisStateRoot = await vm.stateManager.getStateRoot()

  const block = createBlock(
    {
      header: {
        parentHash: blockContext.parentHash,
        uncleHash: KECCAK256_RLP_ARRAY,
        coinbase: blockContext.coinbase,
        stateRoot: genesisStateRoot,
        transactionsTrie: KECCAK256_RLP,
        receiptTrie: KECCAK256_RLP,
        logsBloom: new Uint8Array(256),
        difficulty: blockContext.difficulty,
        number: blockContext.number,
        gasLimit: blockContext.gasLimit,
        gasUsed: 0n,
        timestamp: blockContext.timestamp,
        extraData: new Uint8Array(),
        mixHash: blockContext.mixHash,
        nonce: new Uint8Array(8),
        baseFeePerGas: blockContext.baseFeePerGas,
        withdrawalsRoot: KECCAK256_RLP,
        blobGasUsed: blockContext.blobGasUsed,
        excessBlobGas: blockContext.excessBlobGas,
        parentBeaconBlockRoot: blockContext.parentBeaconBlockRoot,
        requestsHash: SHA256_NULL,
      },
    },
    { common, skipConsensusFormatValidation: true },
  )

  let cumulativeGasUsed = 0n
  let counterAddress: Uint8Array | undefined
  const summaries: TransactionSummary[] = []
  const typedTransactions = canonicalTransactions.map(({ tx }) => tx)

  for (const { label, tx, sender } of canonicalTransactions) {
    // Osaka's block inclusion rule is tx.gasLimit + prior block gas used <=
    // block gas limit. runTx checks each individual limit, but not this sum.
    if (tx.gasLimit + cumulativeGasUsed > block.header.gasLimit) {
      throw new Error(`transaction ${label} exceeds the remaining block gas limit`)
    }

    const result = await runTx(vm, { tx, block, blockGasUsed: cumulativeGasUsed })
    if (!('status' in result.receipt)) {
      throw new Error('Osaka transaction unexpectedly returned a pre-Byzantium receipt')
    }
    cumulativeGasUsed = result.receipt.cumulativeBlockGasUsed
    if (cumulativeGasUsed > blockContext.gasLimit) {
      throw new Error('ordered transactions exceed the configured block gas limit')
    }
    if (result.receipt.status === 1 && result.createdAddress !== undefined) {
      counterAddress = result.createdAddress.bytes
    }

    const currentStateRoot = await vm.stateManager.getStateRoot()
    const senderAccount = await vm.stateManager.getAccount(sender)
    if (senderAccount === undefined) {
      throw new Error(`transaction ${label} sender account disappeared after execution`)
    }
    const contractAddressAfterCreate =
      tx.to === undefined ? createContractAddress(sender, tx.nonce) : undefined
    const deploymentCodeBytesAfter =
      contractAddressAfterCreate === undefined
        ? undefined
        : (await vm.stateManager.getCode(contractAddressAfterCreate)).length
    const counterSlot0After =
      counterAddress === undefined
        ? undefined
        : bytesToBigInt(
            await vm.stateManager.getStorage(new Address(counterAddress), ZERO_SLOT),
          ).toString()
    const logs = result.receipt.logs.map(([address, topics, data]) => ({
      address: bytesToHex(address),
      topics: topics.map(bytesToHex),
      data: bytesToHex(data),
    }))
    summaries.push({
      label,
      hash: bytesToHex(tx.hash()),
      senderAddress: sender.toString(),
      senderNonceAfter: senderAccount.nonce.toString(),
      senderBalanceAfter: senderAccount.balance.toString(),
      status: result.receipt.status,
      gasUsed: result.totalGasSpent.toString(),
      cumulativeGasUsed: cumulativeGasUsed.toString(),
      logs,
      ...(result.createdAddress === undefined
        ? {}
        : { createdAddress: result.createdAddress.toString() }),
      ...(deploymentCodeBytesAfter === undefined ? {} : { deploymentCodeBytesAfter }),
      stateRootAfter: bytesToHex(currentStateRoot),
      ...(counterSlot0After === undefined ? {} : { counterSlot0After }),
    })
  }

  const transactionsTrieRoot = await genTransactionsTrieRoot(typedTransactions)
  const stateRoot = await vm.stateManager.getStateRoot()
  return {
    chainId: EVM_CHAIN_ID.toString(),
    hardfork: EVM_HARDFORK,
    blockContext: {
      parentHash: bytesToHex(blockContext.parentHash),
      coinbase: blockContext.coinbase.toString(),
      difficulty: blockContext.difficulty.toString(),
      number: blockContext.number.toString(),
      timestamp: blockContext.timestamp.toString(),
      gasLimit: blockContext.gasLimit.toString(),
      baseFeePerGas: blockContext.baseFeePerGas.toString(),
      mixHash: bytesToHex(block.header.mixHash),
      blobGasUsed: block.header.blobGasUsed!.toString(),
      excessBlobGas: block.header.excessBlobGas!.toString(),
      parentBeaconBlockRoot: bytesToHex(block.header.parentBeaconBlockRoot!),
      withdrawalsRoot: bytesToHex(block.header.withdrawalsRoot!),
      requestsHash: bytesToHex(block.header.requestsHash!),
    },
    genesisStateRoot: bytesToHex(genesisStateRoot),
    transactionsTrieRoot: bytesToHex(transactionsTrieRoot),
    stateRoot: bytesToHex(stateRoot),
    totalGasUsed: cumulativeGasUsed.toString(),
    transactions: summaries,
  }
}
