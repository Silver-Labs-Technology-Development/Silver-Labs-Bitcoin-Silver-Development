import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Address, hexToBytes, unprefixedHexToBytes } from '@ethereumjs/util'

import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
} from '../src/blockProcessor.js'
import {
  encodeBtcsL1DepositPayload,
} from '../src/btcsL1Deposit.js'
import {
  BtcsL1CoreRpcClient,
} from '../src/btcsL1CoreRpc.js'
import {
  verifyAndRecordBtcsL1Deposit,
} from '../src/btcsL1DepositWorkflow.js'
import {
  BtcsL1DepositStore,
} from '../src/btcsL1DepositStore.js'
import {
  createEvmDepositOperation,
} from '../src/depositPrelude.js'
import {
  createEvmSettlementEnvelope,
  ZERO_COMMITMENT,
} from '../src/settlementEnvelope.js'
import {
  createEvmSettlementBatch,
} from '../src/settlementBatch.js'
import {
  verifyEvmSettlementBatchExecution,
} from '../src/settlementBatchReplay.js'

const CLI_PATH =
  process.env.BTCS_CORE_CLI ??
  join(process.env.HOME ?? '', 'Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli')

const DATADIR =
  process.env.BTCS_L1_REGTEST_DATADIR ??
  join(process.env.HOME ?? '', '.local/share/btcs-l2-deposit-regtest-20261011')

const RPC_PORT = process.env.BTCS_L1_RPC_PORT ?? '29445'
const COOKIE_PATH =
  process.env.BTCS_L1_RPC_COOKIE_PATH ??
  join(DATADIR, 'regtest', '.cookie')

const WALLET_NAME = 'btcs-l2-deposit-e2e'
const REQUIRED_CONFIRMATIONS = 2
const DEPOSIT_AMOUNT_BTC = 0.1
const RECIPIENT_ADDRESS = `0x${'1'.repeat(40)}`
const ZERO_HASH = `0x${'0'.repeat(64)}`

type RpcError = Error & {
  stderr?: Buffer | string
  stdout?: Buffer | string
}

function errorText(error: unknown): string {
  if (error instanceof Error) {
    const rpcError = error as RpcError
    const detail = rpcError.stderr ?? rpcError.stdout
    if (detail !== undefined && String(detail).trim() !== '') {
      return String(detail).trim().slice(-1600)
    }
    return error.message
  }
  return String(error)
}

function coreCli(
  method: string,
  params: readonly string[] = [],
  wallet?: string,
): string {
  const args = [
    '-regtest',
    `-datadir=${DATADIR}`,
    `-rpcport=${RPC_PORT}`,
  ]

  if (wallet !== undefined) {
    args.push(`-rpcwallet=${wallet}`)
  }

  args.push(method, ...params)

  try {
    return execFileSync(CLI_PATH, args, {
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch (error) {
    throw new Error(`BTCS Core CLI ${method} failed: ${errorText(error)}`)
  }
}

function coreCliJson<T>(
  method: string,
  params: readonly string[] = [],
  wallet?: string,
): T {
  const output = coreCli(method, params, wallet)
  try {
    return JSON.parse(output) as T
  } catch {
    throw new Error(`BTCS Core CLI ${method} did not return valid JSON`)
  }
}

async function ensureWallet(): Promise<void> {
  const loaded = coreCliJson<string[]>('listwallets')
  if (loaded.includes(WALLET_NAME)) {
    console.log(`Wallet ready: ${WALLET_NAME}`)
    return
  }

  try {
    coreCli('loadwallet', [WALLET_NAME])
    console.log(`Loaded existing wallet: ${WALLET_NAME}`)
  } catch (loadError) {
    try {
      coreCli('createwallet', [WALLET_NAME])
      console.log(`Created wallet: ${WALLET_NAME}`)
    } catch (createError) {
      throw new Error(
        `Could neither load nor create the dedicated test wallet. ` +
        `Load error: ${errorText(loadError)}; ` +
        `create error: ${errorText(createError)}`,
      )
    }
  }

  const nowLoaded = coreCliJson<string[]>('listwallets')
  assert.ok(nowLoaded.includes(WALLET_NAME), 'test wallet must be loaded')
}

async function readRpcCookie(): Promise<{ username: string; password: string }> {
  let cookie: string
  try {
    cookie = (await readFile(COOKIE_PATH, 'utf8')).trim()
  } catch {
    throw new Error(
      `Cannot read the local RPC cookie at ${COOKIE_PATH}. ` +
      `Set BTCS_L1_RPC_COOKIE_PATH if this node stores it elsewhere.`,
    )
  }

  const separator = cookie.indexOf(':')
  assert.ok(separator > 0 && separator < cookie.length - 1,
    'RPC cookie must contain a username and password separated by a colon')

  return {
    username: cookie.slice(0, separator),
    password: cookie.slice(separator + 1),
  }
}

async function main(): Promise<void> {
  assert.ok(
    process.env.HOME,
    'HOME must be set so the dedicated regtest paths can be resolved',
  )
  assert.ok(
    /^\d+$/.test(RPC_PORT) &&
    Number(RPC_PORT) >= 1 &&
    Number(RPC_PORT) <= 65535,
    'BTCS_L1_RPC_PORT must be a valid TCP port',
  )

  console.log('1/9 Checking the dedicated BTCS regtest node')

  const chainInfo = coreCliJson<{
    chain: string
    blocks: number
    bestblockhash: string
  }>('getblockchaininfo')

  assert.equal(
    chainInfo.chain,
    'regtest',
    'Refusing to run unless the selected Core node reports chain=regtest',
  )

  console.log(JSON.stringify({
    chain: chainInfo.chain,
    startingHeight: chainInfo.blocks,
    bestBlockHash: chainInfo.bestblockhash,
  }, null, 2))

  console.log('2/9 Preparing the dedicated regtest wallet')
  await ensureWallet()

  const minerAddress = coreCli(
    'getnewaddress',
    [],
    WALLET_NAME,
  )

  console.log('3/9 Mining 101 local regtest blocks for spendable test funds')
  coreCliJson<string[]>('generatetoaddress', ['101', minerAddress])

  const depositAddress = coreCli(
    'getnewaddress',
    [],
    WALLET_NAME,
  )

  const addressInfo = coreCliJson<{
    scriptPubKey?: unknown
  }>('getaddressinfo', [depositAddress], WALLET_NAME)

  assert.equal(typeof addressInfo.scriptPubKey, 'string')
  const depositScriptPubKeyHex = (
    addressInfo.scriptPubKey as string
  ).toLowerCase()

  assert.ok(/^(?:[0-9a-f]{2})+$/.test(depositScriptPubKeyHex))
  assert.ok(
    !depositScriptPubKeyHex.startsWith('6a'),
    'The payment destination must not be an OP_RETURN script',
  )

  console.log('4/9 Constructing and broadcasting the real L1 deposit transaction')

  const payloadHex = encodeBtcsL1DepositPayload(RECIPIENT_ADDRESS)

  const outputs = [
    { [depositAddress]: DEPOSIT_AMOUNT_BTC },
    { data: payloadHex },
  ]

  const unsigned = coreCli(
    'createrawtransaction',
    [
      JSON.stringify([]),
      JSON.stringify(outputs),
    ],
  )

  assert.ok(unsigned.length > 0, 'unsigned transaction must contain hex')

  const funded = coreCliJson<{ hex: string }>(
    'fundrawtransaction',
    [unsigned],
    WALLET_NAME,
  )

  assert.ok(funded.hex.length > 0, 'funded transaction must contain hex')

  const signed = coreCliJson<{
    hex: string
    complete: boolean
  }>(
    'signrawtransactionwithwallet',
    [funded.hex],
    WALLET_NAME,
  )

  assert.equal(signed.complete, true, 'regtest transaction must be fully signed')
  assert.ok(signed.hex.length > 0)

  const txid = coreCli('sendrawtransaction', [signed.hex])
  assert.match(txid, /^[0-9a-f]{64}$/)

  console.log(`Broadcast local regtest transaction: ${txid}`)

  console.log('5/9 Mining confirmations and locating actual transaction inclusion')

  const minedHashes = coreCliJson<string[]>(
    'generatetoaddress',
    ['2', minerAddress],
  )

  let inclusionBlockHash: string | undefined

  for (const hash of minedHashes) {
    const block = coreCliJson<{
      hash?: string
      height?: number
      tx?: unknown
    }>('getblock', [hash, '1'])

    if (
      Array.isArray(block.tx) &&
      block.tx.some((entry) => entry === txid)
    ) {
      inclusionBlockHash = hash
      break
    }
  }

  assert.ok(
    inclusionBlockHash,
    'The broadcast transaction must be found in a newly mined canonical regtest block',
  )

  const inclusionHeader = coreCliJson<{
    hash: string
    height: number
    confirmations: number
  }>(
    'getblockheader',
    [inclusionBlockHash, 'true'],
  )

  assert.equal(inclusionHeader.hash, inclusionBlockHash)
  assert.ok(Number.isSafeInteger(inclusionHeader.height))
  assert.ok(inclusionHeader.height >= 0)

  console.log(JSON.stringify({
    txid,
    inclusionBlockHash,
    inclusionBlockHeight: inclusionHeader.height,
    confirmations: inclusionHeader.confirmations,
  }, null, 2))

  console.log('6/9 Verifying the L1 deposit using the project RPC verifier')

  const credentials = await readRpcCookie()

  const rpc = new BtcsL1CoreRpcClient({
    url: `http://127.0.0.1:${RPC_PORT}`,
    username: credentials.username,
    password: credentials.password,
    timeoutMs: 10_000,
  })

  const scratchDirectory = await mkdtemp(
    join(tmpdir(), 'btcs-l2-deposit-settlement-e2e-'),
  )

  try {
    const storeDirectory = join(scratchDirectory, 'deposits')
    let store = await BtcsL1DepositStore.create(storeDirectory)

    const record = await verifyAndRecordBtcsL1Deposit(
      rpc,
      store,
      {
        txid,
        blockHash: inclusionBlockHash,
        recipientAddress: RECIPIENT_ADDRESS,
        depositScriptPubKeyHex,
        requiredConfirmations: REQUIRED_CONFIRMATIONS,
      },
    )

    assert.equal(record.state, 'confirmed')
    assert.equal(record.txid, txid)
    assert.equal(record.blockHash, inclusionBlockHash)
    assert.equal(record.blockHeight, inclusionHeader.height)
    assert.ok(
      (record.confirmations ?? 0) >= REQUIRED_CONFIRMATIONS,
      'verified deposit must have the required active-chain confirmations',
    )
    assert.ok(BigInt(record.amountSats) > 0n)

    console.log('Verified deposit record:', record.depositId)

    console.log('7/9 Reopening the persisted store and applying the L2 deposit operation')

    store = await BtcsL1DepositStore.open(storeDirectory)
    const persistedRecord = store.get(record.depositId)

    assert.ok(persistedRecord, 'verified record must survive store reopening')
    assert.deepEqual(persistedRecord, record)

    const operation = createEvmDepositOperation(persistedRecord)

    assert.equal(operation.depositId, record.depositId)
    assert.equal(
      BigInt(operation.amountWei),
      BigInt(record.amountSats) * (10n ** 10n),
      'sat-to-wei conversion must be exact',
    )

    const chainDirectory = join(scratchDirectory, 'source-chain')
    const source = await PersistentBlockProcessor.open(chainDirectory)

    const genesis = await source.getCanonicalBlockByNumber(0n)
    assert.ok(genesis, 'fresh source chain must have its fixed genesis')

    const genesisEnvelope = createEvmSettlementEnvelope(genesis.blockRlpHex)

    const recipient = new Address(
      unprefixedHexToBytes(RECIPIENT_ADDRESS.slice(2)),
    )

    const genesisBalance = await source.getAccountBalance(recipient, 0n)

    const child = await source.buildNextBlock(
      [],
      GENESIS_TIMESTAMP + 1n,
      [operation],
    )

    assert.equal(child.summary.number, '1')
    assert.deepEqual(
      await source.createCanonicalReadView().then(
        (view) => view.getCanonicalDepositOperations(1n),
      ),
      [operation],
      'the canonical block record must preserve the deposit operation',
    )

    const sourceView = await source.createCanonicalReadView()
    const expectedBalance = genesisBalance + BigInt(operation.amountWei)
    const creditedBalance = await sourceView.getAccountBalance(recipient, 1n)

    assert.equal(
      creditedBalance,
      expectedBalance,
      'L2 recipient balance must increase by the exact deposit amount',
    )

    const sourceReplay = await source.replay()
    assert.equal(sourceReplay.tip.hash, child.summary.hash)
    assert.equal(sourceReplay.blocks[1]?.stateRoot, child.summary.stateRoot)

    const reopenedSource = await PersistentBlockProcessor.open(chainDirectory)
    const reopenedReplay = await reopenedSource.replay()
    const reopenedView = await reopenedSource.createCanonicalReadView()

    assert.equal(
      await reopenedView.getAccountBalance(recipient, 1n),
      expectedBalance,
      'L2 recipient credit must survive chain reopening',
    )
    assert.equal(
      reopenedReplay.blocks[1]?.stateRoot,
      child.summary.stateRoot,
      'reopened chain replay must reproduce the same state root',
    )
    assert.deepEqual(
      (await reopenedSource.createCanonicalReadView()).getCanonicalDepositOperations(1n),
      [operation],
    )

    console.log('8/9 Building settlement v2 and independently replaying execution')

    const childEnvelope = createEvmSettlementEnvelope(
      child.blockRlpHex,
      genesisEnvelope.commitmentHash,
      [operation],
    )

    assert.deepEqual(childEnvelope.depositOperations, [operation])
    assert.equal(childEnvelope.stateRoot, child.summary.stateRoot)

    const batch = createEvmSettlementBatch([
      genesisEnvelope,
      childEnvelope,
    ])

    const settlementReplay = await verifyEvmSettlementBatchExecution(
      batch,
      ZERO_COMMITMENT,
      ZERO_HASH,
      '0',
    )

    assert.equal(settlementReplay.executionVerified, true)
    assert.equal(settlementReplay.startHeight, '0')
    assert.equal(settlementReplay.endHeight, '1')
    assert.equal(settlementReplay.blocksVerified, 2)
    assert.equal(settlementReplay.childBlocksReexecuted, 1)

    // Re-execute into another fresh local chain as an explicit state-root
    // and recipient-balance assertion in addition to the batch verifier.
    const independentDirectory = join(
      scratchDirectory,
      'explicit-independent-replay',
    )
    const independent = await PersistentBlockProcessor.open(independentDirectory)

    const independentGenesis = await independent.getCanonicalBlockByNumber(0n)
    assert.ok(independentGenesis)
    assert.equal(
      independentGenesis.blockRlpHex,
      genesisEnvelope.blockRlpHex,
      'independent replay must start from the fixed local genesis',
    )

    const independentlyProcessed = await independent.acceptBlock(
      hexToBytes(childEnvelope.blockRlpHex as `0x${string}`),
      childEnvelope.depositOperations,
    )

    assert.equal(
      independentlyProcessed.summary.stateRoot,
      child.summary.stateRoot,
      'independent re-execution must match the source L2 state root',
    )

    const independentView = await independent.createCanonicalReadView()
    assert.equal(
      await independentView.getAccountBalance(recipient, 1n),
      expectedBalance,
      'independent re-execution must reproduce the recipient credit',
    )

    assert.deepEqual(
      (await independent.createCanonicalReadView()).getCanonicalDepositOperations(1n),
      [operation],
    )

    console.log('9/9 All deposit and settlement assertions passed')

    console.log(JSON.stringify({
      status: 'PASS',
      chain: chainInfo.chain,
      l1: {
        txid,
        inclusionBlockHash,
        inclusionBlockHeight: record.blockHeight,
        confirmations: record.confirmations,
        depositId: record.depositId,
        amountSats: record.amountSats,
      },
      l2: {
        chainProfile: 'btcs-l2-local-v0.12-deposit-prelude',
        blockHash: child.summary.hash,
        blockHeight: '1',
        recipient: RECIPIENT_ADDRESS,
        creditedAmountWei: operation.amountWei,
        stateRoot: child.summary.stateRoot,
        operationCommitted: true,
        persistenceReplayVerified: true,
      },
      settlement: {
        version: batch.version,
        batchHash: batch.batchHash,
        executionVerified: settlementReplay.executionVerified,
        blocksVerified: settlementReplay.blocksVerified,
        childBlocksReexecuted: settlementReplay.childBlocksReexecuted,
        independentStateRootMatched:
          independentlyProcessed.summary.stateRoot === child.summary.stateRoot,
        independentRecipientBalanceMatched:
          (await independentView.getAccountBalance(recipient, 1n)) === expectedBalance,
      },
      limitations: [
        'L1 deposit verification uses trusted local BTCS Core RPC.',
        'This demo does not establish trustless L1 inclusion proofs.',
        'This demo does not implement safe L1 reorg recovery after L2 spending.',
        'This demo does not implement withdrawals or production escrow.',
      ],
    }, null, 2))
  } finally {
    await rm(scratchDirectory, { recursive: true, force: true })
  }
}

main().catch((error: unknown) => {
  console.error('FAIL: BTCS regtest deposit-settlement demo')
  console.error(errorText(error))
  process.exitCode = 1
})
