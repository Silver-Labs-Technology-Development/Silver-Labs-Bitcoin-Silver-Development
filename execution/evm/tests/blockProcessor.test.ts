import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createBlockFromRLP } from '@ethereumjs/block'
import { genTransactionsTrieRoot } from '@ethereumjs/block'
import { RLP } from '@ethereumjs/rlp'
import { Hardfork, Mainnet, createCustomCommon } from '@ethereumjs/common'
import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import { Address, bytesToHex, createContractAddress, hexToBytes, utf8ToBytes } from '@ethereumjs/util'
import { keccak_256 } from '@noble/hashes/sha3.js'
import {
  BLOCK_GAS_LIMIT,
  GENESIS_TIMESTAMP,
  MAX_SERIALIZED_BLOCK_BYTES,
  MAX_TRANSACTIONS_PER_BLOCK,
  STORE_SCHEMA_VERSION,
  LOCAL_CHAIN_PROFILE,
  PersistentBlockProcessor,
  ProtocolError,
  type PersistenceStage,
} from '../src/blockProcessor.js'
import {
  EVM_CHAIN_ID,
  SENDER_ADDRESS,
  SENDER_PRIVATE_KEY,
  createHarnessCommon,
} from '../src/config.js'
import { compileCounter } from '../src/compile.js'
import { signFeeMarketTransaction } from '../src/transactions.js'
import { recoverStateCheckpoint } from '../src/stateCheckpointRecovery.js'

function eventTopic(signature: string): string {
  return bytesToHex(keccak_256(utf8ToBytes(signature)))
}

function bytesToBigInt(value: Uint8Array): bigint {
  return value.reduce((sum, byte) => (sum << 8n) | BigInt(byte), 0n)
}

async function withStore<T>(run: (directory: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-v011-'))
  try {
    return await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

function contractTransactions() {
  const compiled = compileCounter()
  const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
  const incrementSelector = compiled.methodIdentifiers['increment()']
  assert.ok(incrementSelector)
  return {
    compiled,
    contractAddress,
    deployment: signFeeMarketTransaction({
      nonce: 0n,
      data: compiled.creationBytecode,
      gasLimit: 500_000n,
    }),
    increment: signFeeMarketTransaction({
      nonce: 1n,
      to: contractAddress,
      data: hexToBytes(`0x${incrementSelector}`),
      gasLimit: 150_000n,
    }),
  }
}

function withHeaderField(blockRlp: Uint8Array, index: number, value: Uint8Array): Uint8Array {
  const decoded = RLP.decode(blockRlp) as unknown[]
  const header = decoded[0]
  assert.ok(Array.isArray(header))
  header[index] = value
  return RLP.encode(decoded as never)
}

type StoredBlockRecord = {
  format: string
  schemaVersion: number
  blockHash: string
  height: string
  blockRlpHex: string
  receiptRlpHexes: string[]
  outcomes: Array<Record<string, unknown>>
}

type StoredChainMetadata = {
  canonicalHeight: string
  canonicalTipHash: string
  genesisHash: string
  [key: string]: unknown
}

async function readStoredRecord(directory: string, hash: string): Promise<StoredBlockRecord> {
  return JSON.parse(
    await readFile(join(directory, 'blocks', `${hash.slice(2)}.json`), 'utf8'),
  ) as StoredBlockRecord
}

async function writeStoredRecord(
  directory: string,
  hash: string,
  record: StoredBlockRecord,
): Promise<void> {
  await writeFile(
    join(directory, 'blocks', `${hash.slice(2)}.json`),
    `${JSON.stringify(record)}\n`,
  )
}

async function repointCanonicalBlock(
  directory: string,
  previousHash: string,
  blockRlp: Uint8Array,
): Promise<{ hash: string; recordPath: string }> {
  const record = await readStoredRecord(directory, previousHash)
  const block = createBlockFromRLP(blockRlp, { common: createHarnessCommon() })
  const hash = bytesToHex(block.hash()).toLowerCase()
  record.blockHash = hash
  record.blockRlpHex = bytesToHex(blockRlp).toLowerCase()
  const recordPath = join(directory, 'blocks', `${hash.slice(2)}.json`)
  await writeFile(recordPath, `${JSON.stringify(record)}\n`)
  const metadataPath = join(directory, 'chain.json')
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as StoredChainMetadata
  metadata.canonicalTipHash = hash
  await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`)
  return { hash, recordPath }
}

async function assertRejectedWithoutChanging(
  directory: string,
  paths: readonly string[],
  expected: RegExp,
): Promise<void> {
  const before = await Promise.all(paths.map((path) => readFile(path)))
  await assert.rejects(PersistentBlockProcessor.open(directory), expected)
  const after = await Promise.all(paths.map((path) => readFile(path)))
  assert.deepEqual(after, before)
}

test('genesis is fixed, persisted, and reopens with the same state root and funded account', async () => {
  await withStore(async (directory) => {
    const first = await PersistentBlockProcessor.open(directory)
    const firstReplay = await first.replay()
    assert.equal(first.tip.number, 0n)
    assert.equal(firstReplay.blocks.length, 1)
    assert.equal(firstReplay.blocks[0]?.timestamp, GENESIS_TIMESTAMP.toString())
    assert.equal(
      await first.getAccountBalance(SENDER_ADDRESS),
      10_000n * 10n ** 18n,
    )

    const reopened = await PersistentBlockProcessor.open(directory)
    const reopenedReplay = await reopened.replay()
    assert.deepEqual(reopened.tip, first.tip)
    assert.deepEqual(reopenedReplay, firstReplay)
  })
})

test('deploys Counter in a block and increments it in the next block', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const { contractAddress, deployment, increment } = contractTransactions()

    const deployed = await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    assert.equal(deployed.summary.number, '1')
    assert.equal(deployed.summary.receipts[0]?.status, 1)
    assert.ok(BigInt(deployed.summary.receipts[0]?.gasUsed ?? '0') > 0n)
    assert.equal(bytesToBigInt(await chain.getStorage(contractAddress, new Uint8Array(32))), 0n)

    const incremented = await chain.buildNextBlock([increment], GENESIS_TIMESTAMP + 2n)
    assert.equal(incremented.summary.number, '2')
    assert.equal(incremented.summary.receipts[0]?.status, 1)
    assert.equal(bytesToBigInt(await chain.getStorage(contractAddress, new Uint8Array(32))), 1n)
    const log = incremented.summary.receipts[0]?.logs[0]
    assert.ok(log)
    assert.deepEqual(log.topics, [eventTopic('Incremented(uint256)')])
    assert.equal(log.data, `0x${'00'.repeat(31)}01`)
    assert.equal(chain.tip.hash, incremented.summary.hash)
  })
})

test('canonical replay exports a recoverable durable checkpoint with contract state', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const { contractAddress, deployment, increment } = contractTransactions()

    const deployed = await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    assert.equal(deployed.summary.receipts[0]?.status, 1)

    const incremented = await chain.buildNextBlock([increment], GENESIS_TIMESTAMP + 2n)
    assert.equal(incremented.summary.receipts[0]?.status, 1)

    const canonicalBalance = await chain.getAccountBalance(SENDER_ADDRESS)
    const canonicalCode = await chain.getCode(contractAddress)
    const checkpointPath = join(directory, 'checkpoint')

    const manifest = await chain.exportStateCheckpoint(checkpointPath)
    assert.equal(manifest.profileId, LOCAL_CHAIN_PROFILE)
    assert.equal(manifest.blockHeight, '2')
    assert.equal(manifest.blockHash, incremented.summary.hash)
    assert.equal(manifest.stateRoot, incremented.summary.stateRoot)

    const canonicalView = await chain.createCanonicalReadView()
    const recovered = await recoverStateCheckpoint(
      checkpointPath,
      canonicalView,
      LOCAL_CHAIN_PROFILE,
    )

    try {
      assert.equal(recovered.manifest.stateRoot, incremented.summary.stateRoot)
      assert.equal(
        bytesToBigInt(
          await recovered.stateManager.getStorage(contractAddress, new Uint8Array(32)),
        ),
        1n,
      )
      assert.deepEqual(
        new Uint8Array(await recovered.stateManager.getCode(contractAddress)),
        new Uint8Array(canonicalCode),
      )
      assert.equal(
        (await recovered.stateManager.getAccount(SENDER_ADDRESS))?.balance,
        canonicalBalance,
      )
      assert.equal(
        bytesToHex(await recovered.stateManager.getStateRoot()),
        incremented.summary.stateRoot,
      )
    } finally {
      await recovered.close()
    }
  })
})

test('persistent reopen and genesis replay reproduce roots, receipts, outcomes, and logs', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const { deployment, increment, contractAddress } = contractTransactions()
    const deployed = await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    const incremented = await chain.buildNextBlock([increment], GENESIS_TIMESTAMP + 2n)
    const before = await chain.replay()

    const reopened = await PersistentBlockProcessor.open(directory)
    const after = await reopened.replay()
    assert.deepEqual(after, before)
    assert.deepEqual(after.blocks[1], deployed.summary)
    assert.deepEqual(after.blocks[2], incremented.summary)
    assert.equal(after.blocks.length, 3)
    assert.equal(after.tip.number, 2n)
    assert.equal(bytesToBigInt(await reopened.getStorage(contractAddress, new Uint8Array(32))), 1n)

    for (const summary of after.blocks) {
      assert.match(summary.hash, /^0x[0-9a-f]{64}$/)
      assert.match(summary.transactionsRoot, /^0x[0-9a-f]{64}$/)
      assert.match(summary.receiptsRoot, /^0x[0-9a-f]{64}$/)
      assert.match(summary.stateRoot, /^0x[0-9a-f]{64}$/)
      assert.match(summary.requestsRoot, /^0x[0-9a-f]{64}$/)
    }
  })
})

test('included reverted calls keep protocol gas effects but roll back storage and logs', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const { compiled, contractAddress, deployment } = contractTransactions()
    const revertSelector = compiled.methodIdentifiers['incrementThenRevert()']
    const incrementSelector = compiled.methodIdentifiers['increment()']
    assert.ok(revertSelector)
    assert.ok(incrementSelector)

    await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    const reverted = await chain.buildNextBlock(
      [signFeeMarketTransaction({
        nonce: 1n,
        to: contractAddress,
        data: hexToBytes(`0x${revertSelector}`),
        gasLimit: 150_000n,
      })],
      GENESIS_TIMESTAMP + 2n,
    )
    assert.equal(reverted.summary.receipts[0]?.status, 0)
    assert.ok(BigInt(reverted.summary.receipts[0]?.gasUsed ?? '0') > 0n)
    assert.deepEqual(reverted.summary.receipts[0]?.logs, [])
    assert.equal(bytesToBigInt(await chain.getStorage(contractAddress, new Uint8Array(32))), 0n)

    const incremented = await chain.buildNextBlock(
      [signFeeMarketTransaction({
        nonce: 2n,
        to: contractAddress,
        data: hexToBytes(`0x${incrementSelector}`),
        gasLimit: 150_000n,
      })],
      GENESIS_TIMESTAMP + 3n,
    )
    assert.equal(incremented.summary.receipts[0]?.status, 1)
    assert.equal(bytesToBigInt(await chain.getStorage(contractAddress, new Uint8Array(32))), 1n)
  })
})

test('BLOCKHASH reads the actual canonical parent block hash during build and replay', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const contractAddress = createContractAddress(SENDER_ADDRESS, 0n)
    const runtime = hexToBytes('0x60014060005260206000f3')
    const creation = hexToBytes(`0x600b600c600039600b6000f3${Buffer.from(runtime).toString('hex')}`)
    const deployed = await chain.buildNextBlock(
      [signFeeMarketTransaction({ nonce: 0n, data: creation, gasLimit: 200_000n })],
      GENESIS_TIMESTAMP + 1n,
    )
    const called = await chain.buildNextBlock(
      [signFeeMarketTransaction({ nonce: 1n, to: contractAddress, gasLimit: 50_000n })],
      GENESIS_TIMESTAMP + 2n,
    )
    const expectedHashWord = `0x${deployed.summary.hash.slice(2).padStart(64, '0')}`
    assert.equal(called.summary.receipts[0]?.status, 1)
    assert.equal(called.summary.receipts[0]?.returnData, expectedHashWord)

    const replay = await chain.replay()
    assert.equal(replay.blocks[2]?.receipts[0]?.returnData, expectedHashWord)
    assert.equal(replay.blocks[2]?.parentHash, deployed.summary.hash)
  })
})

test('rejects a wrong parent hash and skipped block number without changing the canonical tip', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const { deployment } = contractTransactions()
    const valid = await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    const tipAfterValid = chain.tip

    const wrongParent = withHeaderField(
      withHeaderField(
        hexToBytes(valid.blockRlpHex as `0x${string}`),
        0,
        new Uint8Array(32).fill(0x7f),
      ),
      8,
      Uint8Array.of(2),
    )
    await assert.rejects(chain.acceptBlock(wrongParent), /parent hash/)
    assert.deepEqual(chain.tip, tipAfterValid)

    const skippedNumber = withHeaderField(
      hexToBytes(valid.blockRlpHex as `0x${string}`),
      8,
      Uint8Array.of(3),
    )
    await assert.rejects(chain.acceptBlock(skippedNumber), /block number/)
    assert.deepEqual(chain.tip, tipAfterValid)
  })
})

test('rejects wrong-chain and invalid-nonce transactions without advancing the tip', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const startingTip = chain.tip
    const wrongChainCommon = createCustomCommon(
      { name: 'v011-wrong-chain-test', chainId: Number(EVM_CHAIN_ID + 1n) },
      Mainnet,
      { hardfork: Hardfork.Osaka },
    )
    const wrongChain = createFeeMarket1559Tx(
      {
        chainId: EVM_CHAIN_ID + 1n,
        nonce: 0n,
        gasLimit: 21_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
        maxFeePerGas: 2_000_000_000n,
        to: SENDER_ADDRESS,
        value: 0n,
      },
      { common: wrongChainCommon },
    ).sign(SENDER_PRIVATE_KEY)
    await assert.rejects(
      chain.buildNextBlock([wrongChain], GENESIS_TIMESTAMP + 1n),
      /chain ID/,
    )
    const invalidNonce = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    await assert.rejects(
      chain.buildNextBlock([invalidNonce], GENESIS_TIMESTAMP + 1n),
      /nonce/i,
    )
    assert.deepEqual(chain.tip, startingTip)
    assert.equal((await chain.replay()).blocks.length, 1)
  })
})

test('enforces block gas reservation instead of sorting or normalizing transactions', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const loopInitcode = hexToBytes('0x600056')
    const consumesBlockGas = signFeeMarketTransaction({
      nonce: 0n,
      data: loopInitcode,
      gasLimit: 16_777_216n,
    })
    const cannotFitAfterOog = signFeeMarketTransaction({
      nonce: 1n,
      to: SENDER_ADDRESS,
      gasLimit: 16_777_216n,
    })
    await assert.rejects(
      chain.buildNextBlock([consumesBlockGas, cannotFitAfterOog], GENESIS_TIMESTAMP + 1n),
      /remaining gas|block gas/i,
    )
    assert.equal(chain.tip.number, 0n)

    const nonceZero = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    const nonceOne = signFeeMarketTransaction({ nonce: 1n, to: SENDER_ADDRESS })
    await assert.rejects(
      chain.buildNextBlock([nonceOne, nonceZero], GENESIS_TIMESTAMP + 1n),
      /nonce/i,
    )
    assert.equal(chain.tip.number, 0n)
  })
})

test('a failed canonical-tip write leaves only an orphan record and reopens at the old tip', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory, {
      beforeTipCommit: () => {
        throw new Error('injected interruption before tip commit')
      },
    })
    const { deployment } = contractTransactions()
    await assert.rejects(
      chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n),
      /injected interruption/,
    )
    assert.equal(chain.tip.number, 0n)

    const reopened = await PersistentBlockProcessor.open(directory)
    assert.equal(reopened.tip.number, 0n)
    assert.equal((await reopened.replay()).blocks.length, 1)

    // The interrupted block is content-addressed and can be safely reused on retry.
    const accepted = await reopened.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    assert.equal(accepted.summary.number, '1')
  })
})

test('canonical replay ignores corruption in an unreachable orphan record', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory, {
      beforeTipCommit: () => {
        throw new Error('leave verified block as orphan')
      },
    })
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    await assert.rejects(chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n), /leave verified block/)

    const metadata = JSON.parse(await readFile(join(directory, 'chain.json'), 'utf8')) as {
      canonicalTipHash: string
    }
    const blockDirectory = join(directory, 'blocks')
    const records = (await readdir(blockDirectory)).filter((name) => name.endsWith('.json'))
    const orphanName = records.find((name) => name !== `${metadata.canonicalTipHash.slice(2)}.json`)
    assert.ok(orphanName)
    const orphanPath = join(blockDirectory, orphanName)
    await writeFile(orphanPath, '{corrupt orphan')

    const reopened = await PersistentBlockProcessor.open(directory)
    assert.equal(reopened.tip.number, 0n)
    assert.equal((await reopened.replay()).blocks.length, 1)
  })
})

test('rejects malformed or oversized serialized block input before changing the tip', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    await assert.rejects(chain.acceptBlock(Uint8Array.of(0xff)), ProtocolError)
    await assert.rejects(
      chain.acceptBlock(new Uint8Array(MAX_SERIALIZED_BLOCK_BYTES + 1)),
      /parser limit/,
    )
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS })
    await assert.rejects(
      chain.buildNextBlock(
        Array.from({ length: MAX_TRANSACTIONS_PER_BLOCK + 1 }, () => tx),
        GENESIS_TIMESTAMP + 1n,
      ),
      /transaction parser limit/,
    )
    assert.equal(chain.tip.number, 0n)
    assert.equal(BLOCK_GAS_LIMIT, 30_000_000n)
  })
})

test('content-addressed records and canonical tip metadata contain the accepted block', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const { deployment } = contractTransactions()
    const accepted = await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    const metadata = JSON.parse(await readFile(join(directory, 'chain.json'), 'utf8')) as {
      canonicalHeight: string
      canonicalTipHash: string
      schemaVersion: number
    }
    assert.equal(metadata.schemaVersion, STORE_SCHEMA_VERSION)
    assert.equal(metadata.canonicalHeight, '1')
    assert.equal(metadata.canonicalTipHash, accepted.summary.hash)
    assert.equal(chain.tip.hash, accepted.summary.hash)
  })
})

test('replay rejects a tampered receipt sidecar', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const { deployment } = contractTransactions()
    const accepted = await chain.buildNextBlock([deployment], GENESIS_TIMESTAMP + 1n)
    const recordPath = join(directory, 'blocks', `${accepted.summary.hash.slice(2)}.json`)
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as {
      receiptRlpHexes: string[]
    }
    record.receiptRlpHexes[0] = '0x00'
    await writeFile(recordPath, `${JSON.stringify(record)}\n`)
    await assert.rejects(PersistentBlockProcessor.open(directory), /receipt bytes differ/)
  })
})

test('replay rejects execution-sidecar tampering without rewriting the record', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    const accepted = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const recordPath = join(directory, 'blocks', `${accepted.summary.hash.slice(2)}.json`)
    const record = await readStoredRecord(directory, accepted.summary.hash)
    record.outcomes[0]!.status = 0
    await writeFile(recordPath, `${JSON.stringify(record)}\n`)
    await assertRejectedWithoutChanging(directory, [recordPath], /execution outcomes differ/)
  })
})

test('replay rejects changed stored headers, parent hashes, and execution roots without repair', async () => {
  const cases: ReadonlyArray<{ name: string; index: number; value: Uint8Array; error: RegExp }> = [
    { name: 'extraData header field', index: 12, value: Uint8Array.of(1), error: /consensus\/context field/ },
    {
      name: 'parent hash',
      index: 0,
      value: new Uint8Array(32).fill(0x7f),
      error: /cannot read canonical block record|parent hash/,
    },
    { name: 'transaction root', index: 4, value: new Uint8Array(32).fill(0x7f), error: /transaction trie/ },
    { name: 'receipt root', index: 5, value: new Uint8Array(32).fill(0x7f), error: /receiptTrie|receipt trie/ },
    { name: 'state root', index: 3, value: new Uint8Array(32).fill(0x7f), error: /stateRoot|state root/ },
  ]

  for (const item of cases) {
    await withStore(async (directory) => {
      const chain = await PersistentBlockProcessor.open(directory)
      const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
      const accepted = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
      const changedRlp = withHeaderField(
        hexToBytes(accepted.blockRlpHex as `0x${string}`),
        item.index,
        item.value,
      )
      const changed = await repointCanonicalBlock(directory, accepted.summary.hash, changedRlp)
      const metadataPath = join(directory, 'chain.json')
      await assertRejectedWithoutChanging(
        directory,
        [metadataPath, changed.recordPath],
        item.error,
      )
    })
  }
})

test('replay rejects a modified signed transaction after its transaction root is recomputed', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const original = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    const accepted = await chain.buildNextBlock([original], GENESIS_TIMESTAMP + 1n)
    const decoded = RLP.decode(
      hexToBytes(accepted.blockRlpHex as `0x${string}`),
    ) as unknown[]
    const header = decoded[0]
    const transactions = decoded[1]
    assert.ok(Array.isArray(header))
    assert.ok(Array.isArray(transactions))
    transactions[0] = signFeeMarketTransaction({
      nonce: 0n,
      to: SENDER_ADDRESS,
      value: 1n,
      gasLimit: 21_000n,
    }).serialize()
    header[4] = await genTransactionsTrieRoot([
      signFeeMarketTransaction({
        nonce: 0n,
        to: SENDER_ADDRESS,
        value: 1n,
        gasLimit: 21_000n,
      }),
    ])
    const changedRlp = RLP.encode(decoded as never)
    const changed = await repointCanonicalBlock(directory, accepted.summary.hash, changedRlp)
    await assertRejectedWithoutChanging(
      directory,
      [join(directory, 'chain.json'), changed.recordPath],
      /state root|receipt trie root|execution outcomes differ/,
    )
  })
})

test('replay rejects a content-address field that disagrees with the stored filename and header', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    const accepted = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const recordPath = join(directory, 'blocks', `${accepted.summary.hash.slice(2)}.json`)
    const record = await readStoredRecord(directory, accepted.summary.hash)
    record.blockHash = `0x${'00'.repeat(32)}`
    await writeStoredRecord(directory, accepted.summary.hash, record)
    await assertRejectedWithoutChanging(
      directory,
      [recordPath],
      /format, schema, or content address/,
    )
  })
})

test('replay rejects a missing tip block and tips that point to mismatched records', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    const accepted = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const tipRecordPath = join(directory, 'blocks', `${accepted.summary.hash.slice(2)}.json`)
    const metadataPath = join(directory, 'chain.json')
    const metadataBefore = await readFile(metadataPath)
    await unlink(tipRecordPath)
    await assert.rejects(PersistentBlockProcessor.open(directory), /cannot read canonical block record/)
    assert.deepEqual(await readFile(metadataPath), metadataBefore)
  })

  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    const accepted = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const metadataPath = join(directory, 'chain.json')
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8')) as StoredChainMetadata
    metadata.canonicalTipHash = `0x${'ff'.repeat(32)}`
    await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`)
    const metadataBefore = await readFile(metadataPath)
    await assertRejectedWithoutChanging(
      directory,
      [metadataPath],
      /cannot read canonical block record/,
    )

    metadata.canonicalHeight = '1'
    // A height-one tip cannot use the height-zero genesis record.
    metadata.canonicalTipHash = metadata.genesisHash
    await writeFile(metadataPath, `${JSON.stringify(metadata)}\n`)
    const mismatchedBefore = await readFile(metadataPath)
    await assertRejectedWithoutChanging(
      directory,
      [metadataPath],
      /height does not match its ancestry/,
    )
    assert.deepEqual(await readFile(metadataPath), mismatchedBefore)
    assert.notDeepEqual(metadataBefore, mismatchedBefore)
  })
})

test('metadata parsing is bounded, schema-pinned, and never repaired on failure', async () => {
  const cases: ReadonlyArray<{ name: string; mutate: (directory: string) => Promise<void>; error: RegExp }> = [
    {
      name: 'malformed JSON',
      mutate: (directory) => writeFile(join(directory, 'chain.json'), '{"format":'),
      error: /cannot open chain metadata/,
    },
    {
      name: 'truncated JSON',
      mutate: (directory) => writeFile(join(directory, 'chain.json'), '{"format":"btcs-l2-local-chain"'),
      error: /cannot open chain metadata/,
    },
    {
      name: 'oversized bytes',
      mutate: (directory) => writeFile(join(directory, 'chain.json'), new Uint8Array(65_537)),
      error: /65536-byte limit/,
    },
    {
      name: 'unsupported schema version',
      mutate: async (directory) => {
        const path = join(directory, 'chain.json')
        const metadata = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>
        metadata.schemaVersion = STORE_SCHEMA_VERSION + 1
        await writeFile(path, `${JSON.stringify(metadata)}\n`)
      },
      error: /schemaVersion/,
    },
  ]

  for (const item of cases) {
    await withStore(async (directory) => {
      await PersistentBlockProcessor.open(directory)
      const metadataPath = join(directory, 'chain.json')
      await item.mutate(directory)
      await assertRejectedWithoutChanging(directory, [metadataPath], item.error)
    })
  }
})

test('unsupported block record schema versions are rejected without rewriting history', async () => {
  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    const accepted = await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const recordPath = join(directory, 'blocks', `${accepted.summary.hash.slice(2)}.json`)
    const record = await readStoredRecord(directory, accepted.summary.hash)
    record.schemaVersion = STORE_SCHEMA_VERSION + 1
    await writeStoredRecord(directory, accepted.summary.hash, record)
    await assertRejectedWithoutChanging(directory, [recordPath], /format, schema, or content address/)
  })
})

test('missing metadata recovers only an exact genesis-only store, not accepted block history', async () => {
  await withStore(async (directory) => {
    const original = await PersistentBlockProcessor.open(directory)
    const genesisTip = original.tip
    await unlink(join(directory, 'chain.json'))
    const recovered = await PersistentBlockProcessor.open(directory)
    assert.deepEqual(recovered.tip, genesisTip)
    assert.equal((await recovered.replay()).blocks.length, 1)
  })

  await withStore(async (directory) => {
    const chain = await PersistentBlockProcessor.open(directory)
    const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
    await chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n)
    const metadataPath = join(directory, 'chain.json')
    await unlink(metadataPath)
    const blockFilesBefore = (await readdir(join(directory, 'blocks'))).sort()
    await assert.rejects(
      PersistentBlockProcessor.open(directory),
      /metadata is missing from a store that contains block history/,
    )
    await assert.rejects(readFile(metadataPath))
    assert.deepEqual((await readdir(join(directory, 'blocks'))).sort(), blockFilesBefore)
  })
})

test('reopen ignores abandoned, truncated atomic-write temporary files', async () => {
  await withStore(async (directory) => {
    await PersistentBlockProcessor.open(directory)
    const blockTemp = join(directory, 'blocks', '.01234567-89ab-cdef-0123-456789abcdef.tmp')
    const metadataTemp = join(directory, '.fedcba98-7654-3210-fedc-ba9876543210.tmp')
    await writeFile(blockTemp, '{"format":"btcs-l2-block-record"')
    await writeFile(metadataTemp, '{"format":"btcs-l2-local-chain"')

    const reopened = await PersistentBlockProcessor.open(directory)
    assert.equal(reopened.tip.number, 0n)
    assert.equal((await reopened.replay()).blocks.length, 1)
    assert.ok((await readFile(blockTemp)).length > 0)
    assert.ok((await readFile(metadataTemp)).length > 0)
  })
})

test('simulated failures at every block and tip persistence boundary reopen consistently', async () => {
  const oldTipStages: PersistenceStage[] = [
    'before-block-record-write',
    'block-record-temp-opened',
    'block-record-temp-partially-written',
    'block-record-temp-written',
    'block-record-file-synced',
    'before-block-record-rename',
    'block-record-renamed',
    'block-record-before-directory-sync',
    'block-record-directory-synced',
    'after-block-record-durable',
    'before-tip-update',
    'tip-temp-opened',
    'tip-temp-partially-written',
    'tip-temp-written',
    'tip-file-synced',
    'before-tip-rename',
  ]
  const committedTipStages: PersistenceStage[] = [
    'tip-renamed',
    'tip-before-directory-sync',
    'tip-durable',
    'after-tip-commit',
  ]

  for (const stage of [...oldTipStages, ...committedTipStages]) {
    await withStore(async (directory) => {
      await PersistentBlockProcessor.open(directory)
      const chain = await PersistentBlockProcessor.open(directory, {
        persistenceTestHook: (current) => {
          if (current === stage) throw new Error(`injected persistence failure at ${stage}`)
        },
      })
      const tx = signFeeMarketTransaction({ nonce: 0n, to: SENDER_ADDRESS, gasLimit: 21_000n })
      await assert.rejects(
        chain.buildNextBlock([tx], GENESIS_TIMESTAMP + 1n),
        new RegExp(`injected persistence failure at ${stage}`),
      )

      const shouldBeCommitted = committedTipStages.includes(stage)
      assert.equal(chain.tip.number, shouldBeCommitted ? 1n : 0n, stage)
      const reopened = await PersistentBlockProcessor.open(directory)
      assert.equal(reopened.tip.number, shouldBeCommitted ? 1n : 0n, stage)
      const replay = await reopened.replay()
      assert.equal(replay.blocks.length, shouldBeCommitted ? 2 : 1, stage)
      assert.deepEqual(replay.tip, reopened.tip, stage)
    })
  }
})

test('opening a persistent chain rejects a different selected profile', async () => {
  await withStore(async (directory) => {
    await PersistentBlockProcessor.open(directory)
    const metadata = JSON.parse(await readFile(join(directory, 'chain.json'), 'utf8')) as {
      profileId: string
    }
    metadata.profileId = 'untrusted-profile'
    await writeFile(join(directory, 'chain.json'), `${JSON.stringify(metadata)}\n`)
    await assert.rejects(PersistentBlockProcessor.open(directory), /profileId/)
  })
})
