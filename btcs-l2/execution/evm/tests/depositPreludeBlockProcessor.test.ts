import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { Address, unprefixedHexToBytes } from '@ethereumjs/util'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
  createStaticDepositBackingProvider,
} from '../src/blockProcessor.js'
import {
  createEvmDepositOperation,
} from '../src/depositPrelude.js'
import {
  BTCS_L1_DEPOSIT_RECORD_FORMAT,
  BTCS_L1_DEPOSIT_RECORD_VERSION,
} from '../src/btcsL1DepositStore.js'
import type { BtcsL1DepositRecord } from '../src/btcsL1DepositStore.js'

function makeRecord(
  overrides: Partial<BtcsL1DepositRecord> = {},
): BtcsL1DepositRecord {
  return {
    format: BTCS_L1_DEPOSIT_RECORD_FORMAT,
    version: BTCS_L1_DEPOSIT_RECORD_VERSION,
    depositId: `${'a'.repeat(64)}:0`,
    txid: 'a'.repeat(64),
    depositOutputIndex: 0,
    recipientAddress: `0x${'1'.repeat(40)}`,
    amountSats: '125000000',
    requiredConfirmations: 6,
    state: 'confirmed',
    blockHash: 'b'.repeat(64),
    blockHeight: 200,
    confirmations: 8,
    ...overrides,
  }
}

async function withTemporaryChain(
  body: (root: string, chainDirectory: string, chain: PersistentBlockProcessor) => Promise<void>,
  depositBacking = createStaticDepositBackingProvider([makeRecord()]),
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-deposit-prelude-'))
  const chainDirectory = join(root, 'chain')

  try {
    const chain = await PersistentBlockProcessor.open(chainDirectory, {
      depositBackingProvider: depositBacking,
    })
    await body(root, chainDirectory, chain)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function recipientAddress(): Address {
  return new Address(unprefixedHexToBytes('1'.repeat(40)))
}

test('deposit credit is part of the canonical state root and survives replay/reopen', async () => {
  await withTemporaryChain(async (_root, chainDirectory, chain) => {
    const operation = createEvmDepositOperation(makeRecord())
    const built = await chain.buildNextBlock(
      [],
      GENESIS_TIMESTAMP + 1n,
      [operation],
    )

    let view = await chain.createCanonicalReadView()
    assert.equal(
      await view.getAccountBalance(recipientAddress(), 1n),
      BigInt(operation.amountWei),
    )

    const replay = await chain.replay()
    assert.equal(replay.tip.hash, built.summary.hash)
    assert.equal(replay.blocks[1]?.stateRoot, built.summary.stateRoot)

    const reopened = await PersistentBlockProcessor.open(chainDirectory)
    view = await reopened.createCanonicalReadView()
    assert.equal(
      await view.getAccountBalance(recipientAddress(), 1n),
      BigInt(operation.amountWei),
    )
  })
})

test('the same deposit output cannot be credited in a later block', async () => {
  await withTemporaryChain(async (_root, _chainDirectory, chain) => {
    const operation = createEvmDepositOperation(makeRecord())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    const committedTip = chain.tip

    await assert.rejects(
      chain.buildNextBlock([], GENESIS_TIMESTAMP + 2n, [operation]),
      /already included in canonical history/,
    )

    assert.deepEqual(chain.tip, committedTip)
    const replay = await chain.replay()
    assert.equal(replay.blocks.length, 2)
  })
})

test('deposit operations are rejected when no L1 backing provider is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-deposit-prelude-'))
  try {
    const chain = await PersistentBlockProcessor.open(join(root, 'chain'))
    const operation = createEvmDepositOperation(makeRecord())
    const originalTip = chain.tip

    await assert.rejects(
      chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation]),
      /require a confirmed L1 deposit backing provider/,
    )
    assert.deepEqual(chain.tip, originalTip)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('deposit operations must match the confirmed L1 backing record exactly', async () => {
  await withTemporaryChain(
    async (_root, _chainDirectory, chain) => {
      const operation = createEvmDepositOperation(makeRecord({ amountSats: '1' }))
      const originalTip = chain.tip

      await assert.rejects(
        chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation]),
        /does not match its confirmed L1 backing record/,
      )
      assert.deepEqual(chain.tip, originalTip)
    },
    createStaticDepositBackingProvider([makeRecord({ amountSats: '2' })]),
  )
})

test('replay rejects a deposit sidecar that differs from the header commitment', async () => {
  await withTemporaryChain(async (_root, chainDirectory, chain) => {
    const operation = createEvmDepositOperation(makeRecord())
    const block = await chain.buildNextBlock(
      [],
      GENESIS_TIMESTAMP + 1n,
      [operation],
    )

    const recordPath = join(
      chainDirectory,
      'blocks',
      `${block.summary.hash.slice(2)}.json`,
    )
    const record = JSON.parse(await readFile(recordPath, 'utf8')) as {
      depositOperations: Array<{ recipientAddress: string }>
    }
    record.depositOperations[0]!.recipientAddress = `0x${'2'.repeat(40)}`
    await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')

    await assert.rejects(
      PersistentBlockProcessor.open(chainDirectory),
      /do not match the block-header commitment/,
    )
  })
})
