import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
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

const WALLET_NAME = 'btcs-l2-deposit-e2e'

export class PreflightError extends Error {
  constructor(message: string) {
    super(`Preflight failed: ${message}`)
    this.name = 'PreflightError'
  }
}

export type E2EConfig = Readonly<{
  cliPath: string
  dataDir: string
  rpcPort: string
  cookiePath: string
}>

export type CoreChainInfo = Readonly<{
  chain: string
  blocks: number
  bestblockhash: string
}>

export type PreflightDependencies = Readonly<{
  readChainInfo?: (config: E2EConfig) => CoreChainInfo
}>

export function resolveE2EConfig(env: NodeJS.ProcessEnv): E2EConfig {
  const home = env.HOME ?? ''
  if (home === '') {
    throw new PreflightError(
      'HOME must be set so the dedicated regtest paths can be resolved',
    )
  }

  const cliPath =
    env.BTCS_CORE_CLI ??
    join(home, 'Silver-Labs/btcs-core/build-noipc/bin/bitcoinsilver-cli')
  if (cliPath === '') {
    throw new PreflightError('BTCS_CORE_CLI must not be empty')
  }

  const dataDir =
    env.BTCS_L1_REGTEST_DATADIR ??
    join(home, '.local/share/btcs-l2-deposit-regtest-20261011')
  if (dataDir === '') {
    throw new PreflightError('BTCS_L1_REGTEST_DATADIR must not be empty')
  }

  const rpcPort = env.BTCS_L1_RPC_PORT ?? '29445'
  if (
    !/^\d+$/.test(rpcPort) ||
    Number(rpcPort) < 1 ||
    Number(rpcPort) > 65535
  ) {
    throw new PreflightError(
      `BTCS_L1_RPC_PORT must be a TCP port between 1 and 65535 ` +
      `(received ${JSON.stringify(rpcPort)})`,
    )
  }

  const cookiePath =
    env.BTCS_L1_RPC_COOKIE_PATH ??
    join(dataDir, 'regtest', '.cookie')
  if (cookiePath === '') {
    throw new PreflightError('BTCS_L1_RPC_COOKIE_PATH must not be empty')
  }

  return { cliPath, dataDir, rpcPort, cookiePath }
}

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
  config: E2EConfig,
  method: string,
  params: readonly string[] = [],
  wallet?: string,
): string {
  const args = [
    '-regtest',
    `-datadir=${config.dataDir}`,
    `-rpcport=${config.rpcPort}`,
  ]

  if (wallet !== undefined) {
    args.push(`-rpcwallet=${wallet}`)
  }

  args.push(method, ...params)

  try {
    return execFileSync(config.cliPath, args, {
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
  config: E2EConfig,
  method: string,
  params: readonly string[] = [],
  wallet?: string,
): T {
  const output = coreCli(config, method, params, wallet)
  try {
    return JSON.parse(output) as T
  } catch {
    throw new Error(`BTCS Core CLI ${method} did not return valid JSON`)
  }
}

async function ensureWallet(config: E2EConfig): Promise<void> {
  const loaded = coreCliJson<string[]>(config, 'listwallets')
  if (loaded.includes(WALLET_NAME)) {
    console.log(`Wallet ready: ${WALLET_NAME}`)
    return
  }

  try {
    coreCli(config, 'loadwallet', [WALLET_NAME])
    console.log(`Loaded existing wallet: ${WALLET_NAME}`)
  } catch (loadError) {
    try {
      coreCli(config, 'createwallet', [WALLET_NAME])
      console.log(`Created wallet: ${WALLET_NAME}`)
    } catch (createError) {
      throw new Error(
        `Could neither load nor create the dedicated test wallet. ` +
        `Load error: ${errorText(loadError)}; ` +
        `create error: ${errorText(createError)}`,
      )
    }
  }

  const nowLoaded = coreCliJson<string[]>(config, 'listwallets')
  assert.ok(nowLoaded.includes(WALLET_NAME), 'test wallet must be loaded')
}

export function parseRpcCookie(raw: string): { username: string; password: string } {
  const cookie = raw.trim()
  const separator = cookie.indexOf(':')
  if (separator <= 0 || separator >= cookie.length - 1) {
    throw new PreflightError(
      'RPC cookie is malformed; expected a non-empty user and password ' +
      'separated by a colon',
    )
  }

  return {
    username: cookie.slice(0, separator),
    password: cookie.slice(separator + 1),
  }
}

export async function readRpcCookie(
  cookiePath: string,
): Promise<{ username: string; password: string }> {
  let raw: string
  try {
    raw = await readFile(cookiePath, 'utf8')
  } catch {
    throw new PreflightError(
      `cannot read the local RPC cookie at ${cookiePath}. ` +
      `Set BTCS_L1_RPC_COOKIE_PATH if this node stores it elsewhere.`,
    )
  }

  return parseRpcCookie(raw)
}

export async function assertCliExecutable(cliPath: string): Promise<void> {
  const info = await stat(cliPath).catch(() => undefined)
  if (info === undefined) {
    throw new PreflightError(
      `BTCS Core CLI not found at ${cliPath}. ` +
      `Set BTCS_CORE_CLI to the bitcoinsilver-cli path.`,
    )
  }
  if (!info.isFile()) {
    throw new PreflightError(
      `BTCS Core CLI path ${cliPath} is not a regular file.`,
    )
  }

  const executable = await access(cliPath, constants.X_OK).then(
    () => true,
    () => false,
  )
  if (!executable) {
    throw new PreflightError(
      `BTCS Core CLI at ${cliPath} is not executable. ` +
      `Fix its permissions or point BTCS_CORE_CLI elsewhere.`,
    )
  }
}

export async function assertDataDirectory(dataDir: string): Promise<void> {
  const info = await stat(dataDir).catch(() => undefined)
  if (info === undefined) {
    throw new PreflightError(
      `regtest data directory ${dataDir} does not exist. Start the dedicated ` +
      `node for that directory or set BTCS_L1_REGTEST_DATADIR; this runner ` +
      `never creates or initializes it.`,
    )
  }
  if (!info.isDirectory()) {
    throw new PreflightError(
      `regtest data directory ${dataDir} is not a directory.`,
    )
  }
}

export async function preflight(
  config: E2EConfig,
  dependencies: PreflightDependencies = {},
): Promise<CoreChainInfo> {
  await assertCliExecutable(config.cliPath)
  await assertDataDirectory(config.dataDir)
  await readRpcCookie(config.cookiePath)

  let chainInfo: CoreChainInfo
  try {
    chainInfo =
      dependencies.readChainInfo !== undefined
        ? dependencies.readChainInfo(config)
        : coreCliJson<CoreChainInfo>(config, 'getblockchaininfo')
  } catch (error) {
    if (error instanceof PreflightError) {
      throw error
    }
    throw new PreflightError(
      `BTCS Core RPC is unreachable at 127.0.0.1:${config.rpcPort} using ` +
      `${config.cliPath} and data directory ${config.dataDir}. Start the ` +
      `dedicated node for that directory or check the port. ` +
      `Detail: ${errorText(error)}`,
    )
  }

  if (chainInfo.chain !== 'regtest') {
    throw new PreflightError(
      `refusing to run: Core reports chain=${JSON.stringify(chainInfo.chain)}, ` +
      `but this end-to-end test requires chain=regtest.`,
    )
  }

  return chainInfo
}

async function main(): Promise<void> {
  const config = resolveE2EConfig(process.env)

  console.log('1/9 Preflighting the dedicated BTCS regtest node')

  const chainInfo = await preflight(config)

  console.log(JSON.stringify({
    chain: chainInfo.chain,
    startingHeight: chainInfo.blocks,
    bestBlockHash: chainInfo.bestblockhash,
  }, null, 2))

  console.log('2/9 Preparing the dedicated regtest wallet')
  await ensureWallet(config)

  const minerAddress = coreCli(
    config,
    'getnewaddress',
    [],
    WALLET_NAME,
  )

  console.log('3/9 Mining 101 local regtest blocks for spendable test funds')
  coreCliJson<string[]>(config, 'generatetoaddress', ['101', minerAddress])

  const depositAddress = coreCli(
    config,
    'getnewaddress',
    [],
    WALLET_NAME,
  )

  const addressInfo = coreCliJson<{
    scriptPubKey?: unknown
  }>(config, 'getaddressinfo', [depositAddress], WALLET_NAME)

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
    config,
    'createrawtransaction',
    [
      JSON.stringify([]),
      JSON.stringify(outputs),
    ],
  )

  assert.ok(unsigned.length > 0, 'unsigned transaction must contain hex')

  const funded = coreCliJson<{ hex: string }>(
    config,
    'fundrawtransaction',
    [unsigned],
    WALLET_NAME,
  )

  assert.ok(funded.hex.length > 0, 'funded transaction must contain hex')

  const signed = coreCliJson<{
    hex: string
    complete: boolean
  }>(
    config,
    'signrawtransactionwithwallet',
    [funded.hex],
    WALLET_NAME,
  )

  assert.equal(signed.complete, true, 'regtest transaction must be fully signed')
  assert.ok(signed.hex.length > 0)

  const txid = coreCli(config, 'sendrawtransaction', [signed.hex])
  assert.match(txid, /^[0-9a-f]{64}$/)

  console.log(`Broadcast local regtest transaction: ${txid}`)

  console.log('5/9 Mining confirmations and locating actual transaction inclusion')

  const minedHashes = coreCliJson<string[]>(
    config,
    'generatetoaddress',
    ['2', minerAddress],
  )

  let inclusionBlockHash: string | undefined

  for (const hash of minedHashes) {
    const block = coreCliJson<{
      hash?: string
      height?: number
      tx?: unknown
    }>(config, 'getblock', [hash, '1'])

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
    config,
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

  const credentials = await readRpcCookie(config.cookiePath)

  const rpc = new BtcsL1CoreRpcClient({
    url: `http://127.0.0.1:${config.rpcPort}`,
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

const isDirectExecution =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href

if (isDirectExecution) {
  main().catch((error: unknown) => {
    console.error('FAIL: BTCS regtest deposit-settlement demo')
    console.error(errorText(error))
    process.exitCode = 1
  })
}
