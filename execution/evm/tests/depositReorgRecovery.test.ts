import assert from 'node:assert/strict'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createFeeMarket1559Tx } from '@ethereumjs/tx'
import { Address, createAddressFromPrivateKey, hexToBytes } from '@ethereumjs/util'
import {
  GENESIS_TIMESTAMP,
  PersistentBlockProcessor,
  ProtocolError,
  type PersistentBlockProcessorOptions,
} from '../src/blockProcessor.js'
import {
  EVM_CHAIN_ID,
  SENDER_ADDRESS,
  SENDER_PRIVATE_KEY,
  createHarnessCommon,
} from '../src/config.js'
import { createEvmDepositOperation } from '../src/depositPrelude.js'
import { collectCanonicalDepositCredits } from '../src/depositReorgAccounting.js'
import {
  DepositReorgRecoveryError,
  rederiveCanonicalL2AfterDepositInvalidation,
  recoverDepositReorg,
} from '../src/depositReorgRecovery.js'
import {
  DepositRecoveryGateError,
  clearDepositRecoveryGate,
  depositRecoveryGatePath,
  readDepositRecoveryGate,
} from '../src/depositRecoveryGate.js'
import {
  BTCS_L1_DEPOSIT_RECORD_FORMAT,
  BTCS_L1_DEPOSIT_RECORD_VERSION,
} from '../src/btcsL1DepositStore.js'
import type { BtcsL1DepositRecord } from '../src/btcsL1DepositStore.js'

const SATOSHI_TO_WEI = 10n ** 10n
const recipientKey = hexToBytes(`0x${'22'.repeat(32)}`)
const recipient = createAddressFromPrivateKey(recipientKey)
const secondRecipientKey = hexToBytes(`0x${'44'.repeat(32)}`)
const secondRecipient = createAddressFromPrivateKey(secondRecipientKey)
const otherAccount = new Address(hexToBytes(`0x${'33'.repeat(20)}`))
const amountSats = '125000000'
const amountWei = BigInt(amountSats) * SATOSHI_TO_WEI

function recordFor(
  overrides: Partial<BtcsL1DepositRecord> = {},
): BtcsL1DepositRecord {
  return {
    format: BTCS_L1_DEPOSIT_RECORD_FORMAT,
    version: BTCS_L1_DEPOSIT_RECORD_VERSION,
    depositId: `${'a'.repeat(64)}:0`,
    txid: 'a'.repeat(64),
    depositOutputIndex: 0,
    recipientAddress: recipient.toString(),
    amountSats,
    requiredConfirmations: 6,
    state: 'confirmed',
    blockHash: 'b'.repeat(64),
    blockHeight: 200,
    confirmations: 8,
    ...overrides,
  }
}

function senderTx(nonce: bigint, to: Address, value: bigint) {
  return createFeeMarket1559Tx({
    chainId: EVM_CHAIN_ID,
    nonce,
    gasLimit: 21_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    to,
    value,
  }, { common: createHarnessCommon() }).sign(SENDER_PRIVATE_KEY)
}

function recipientTx(nonce: bigint, to: Address, value: bigint) {
  return createFeeMarket1559Tx({
    chainId: EVM_CHAIN_ID,
    nonce,
    gasLimit: 21_000n,
    maxFeePerGas: 2_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    to,
    value,
  }, { common: createHarnessCommon() }).sign(recipientKey)
}

async function fixture(
  body: (context: {
    root: string
    sourceDirectory: string
    chain: PersistentBlockProcessor
  }) => Promise<void>,
  processorOptions: PersistentBlockProcessorOptions = {},
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'btcs-l2-deposit-recovery-'))
  try {
    const sourceDirectory = join(root, 'source')
    const chain = await PersistentBlockProcessor.open(sourceDirectory, processorOptions)
    await body({ root, sourceDirectory, chain })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Credits a deposit in block 1, then builds a valid block 2 that extends block
 * 1 on a separate fresh "mirror" store. The returned RLPs are children of the
 * source chain's tip, so they can be offered to the source chain as canonical
 * extensions.
 */
async function chainWithExtensibleChild(
  root: string,
  chain: PersistentBlockProcessor,
): Promise<{
  operation: ReturnType<typeof createEvmDepositOperation>
  block1RlpHex: string
  block2RlpHex: string
}> {
  const operation = createEvmDepositOperation(recordFor())
  await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
  const block1 = await chain.getCanonicalBlockByNumber(1n)
  assert.ok(block1)
  const mirror = await PersistentBlockProcessor.open(join(root, 'mirror'))
  await mirror.acceptBlock(
    hexToBytes(block1.blockRlpHex as `0x${string}`),
    [operation],
  )
  const block2 = await mirror.buildNextBlock([], GENESIS_TIMESTAMP + 2n)
  return {
    operation,
    block1RlpHex: block1.blockRlpHex,
    block2RlpHex: block2.blockRlpHex,
  }
}

test('no recovery is needed when the invalidated deposit was never credited', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    const result = await recoverDepositReorg({
      processor: chain,
      invalidatedDepositIds: [`${'9'.repeat(64)}:0`],
      outputDirectory: join(root, 'out'),
    })

    assert.equal(result.status, 'no-recovery-needed')
    assert.equal(result.report.blocksRebuilt, 0)
    assert.deepEqual(result.report.ignoredDepositIds, [`${'9'.repeat(64)}:0`])
    assert.equal(result.gate, undefined)
    assert.equal(await readDepositRecoveryGate(sourceDirectory), undefined)
    assert.equal(await pathExists(join(root, 'out')), false)
    assert.equal(chain.tip.number, 1n)
  })
})

test('re-derivation removes an unspent invalidated credit and its balance', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    await chain.buildNextBlock(
      [senderTx(0n, otherAccount, 1n)],
      GENESIS_TIMESTAMP + 2n,
    )
    const view = await chain.createCanonicalReadView()
    const sourceTip = view.report.tip

    const report = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: [operation.depositId],
      outputDirectory: join(root, 'out'),
    })

    assert.equal(report.status, 're-derived')
    assert.equal(report.rederiveFromBlock, '1')
    assert.equal(report.blocksRebuilt, 2)
    assert.deepEqual(report.droppedDepositIds, [operation.depositId])
    assert.notEqual(report.reDerivedTip.hash, sourceTip.hash)
    assert.equal(report.sourceTip.hash, sourceTip.hash)

    const rederived = await PersistentBlockProcessor.open(report.outputDirectory)
    const rederivedView = await rederived.createCanonicalReadView()
    assert.equal(await rederivedView.getAccountBalance(recipient), 0n)
    assert.equal(rederivedView.getCanonicalDepositOperations(1n).length, 0)
    assert.deepEqual(collectCanonicalDepositCredits(rederivedView), [])

    // The source chain retains the invalid credit; re-derivation never mutates it.
    assert.equal(await view.getAccountBalance(recipient), amountWei)
    assert.equal(
      (await chain.createCanonicalReadView()).report.tip.hash,
      sourceTip.hash,
    )
  })
})

test('independent post-credit transactions survive re-derivation unchanged', async () => {
  await fixture(async ({ root, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    await chain.buildNextBlock(
      [senderTx(0n, otherAccount, 5n)],
      GENESIS_TIMESTAMP + 2n,
    )
    const view = await chain.createCanonicalReadView()

    const report = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: [operation.depositId],
      outputDirectory: join(root, 'out'),
    })

    const rederived = await PersistentBlockProcessor.open(report.outputDirectory)
    const rederivedView = await rederived.createCanonicalReadView()
    // The surviving independent transaction is preserved with its effects.
    assert.equal(await rederivedView.getAccountBalance(otherAccount), 5n)
    assert.equal(await rederivedView.getAccountNonce(SENDER_ADDRESS), 1n)
    assert.equal(rederivedView.report.blocks[2]!.receipts.length, 1)
    assert.equal(report.blocks[1]!.removedDepositIds.length, 0)
  })
})

test('re-derivation fails closed when a descendant transaction spent the credit', async () => {
  await fixture(async ({ root, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    await chain.buildNextBlock(
      [recipientTx(0n, otherAccount, amountWei / 2n)],
      GENESIS_TIMESTAMP + 2n,
    )
    const view = await chain.createCanonicalReadView()

    const outputDirectory = join(root, 'out')
    await assert.rejects(
      rederiveCanonicalL2AfterDepositInvalidation({
        canonicalView: view,
        invalidatedDepositIds: [operation.depositId],
        outputDirectory,
      }),
      (error: unknown) => {
        assert.ok(error instanceof DepositReorgRecoveryError)
        assert.equal(error.kind, 'rebuild-failed')
        assert.equal(error.details.blockHeight, '2')
        return true
      },
    )
    // The unusable partial store is cleaned up.
    assert.equal(await pathExists(outputDirectory), false)
  })
})

test('the coordinator freezes the source store and blocks continuation on failure', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    await chain.buildNextBlock(
      [recipientTx(0n, otherAccount, amountWei / 2n)],
      GENESIS_TIMESTAMP + 2n,
    )
    await assert.rejects(
      recoverDepositReorg({
        processor: chain,
        invalidatedDepositIds: [operation.depositId],
        outputDirectory: join(root, 'out'),
      }),
      DepositReorgRecoveryError,
    )

    const gate = await readDepositRecoveryGate(sourceDirectory)
    assert.ok(gate)
    assert.equal(gate.status, 'frozen')
    assert.deepEqual(gate.involvedDepositIds, [operation.depositId])
    assert.equal(gate.rederiveFromBlock, '1')

    // Real block production is now refused on the frozen store.
    await assert.rejects(
      chain.buildNextBlock([], GENESIS_TIMESTAMP + 3n),
      DepositRecoveryGateError,
    )
    await assert.rejects(
      chain.acceptBlock(new Uint8Array()),
      DepositRecoveryGateError,
    )
    // The frozen tip is unchanged.
    assert.equal((await chain.createCanonicalReadView()).report.tip.number, 2n)
  })
})

test('successful recovery adopts the re-derived tip and reopens the canonical store', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    const invalidatedTipHash = chain.tip.hash
    const result = await recoverDepositReorg({
      processor: chain,
      invalidatedDepositIds: [operation.depositId],
      outputDirectory: join(root, 'out'),
    })
    assert.equal(result.status, 're-derived')
    assert.equal(result.gate, undefined)
    assert.equal(await readDepositRecoveryGate(sourceDirectory), undefined)
    assert.equal(chain.tip.number, 1n)
    assert.equal(chain.tip.hash, result.report.reDerivedTip.hash)
    assert.notEqual(chain.tip.hash, invalidatedTipHash)
    const adoptedView = await chain.createCanonicalReadView()
    assert.deepEqual(collectCanonicalDepositCredits(adoptedView), [])
    assert.equal(adoptedView.report.tip.hash, result.report.reDerivedTip.hash)

    const continuation = await chain.buildNextBlock([], GENESIS_TIMESTAMP + 2n)
    assert.equal(continuation.summary.number, '2')
    const reopened = await PersistentBlockProcessor.open(sourceDirectory)
    assert.equal(reopened.tip.hash, continuation.summary.hash)
  })
})

test('adoption commits canonical metadata last and remains safely retryable on failure', async () => {
  let failAdoptionCommit = false
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    const originalTip = { ...chain.tip }
    const outputDirectory = join(root, 'out')
    failAdoptionCommit = true

    await assert.rejects(
      recoverDepositReorg({
        processor: chain,
        invalidatedDepositIds: [operation.depositId],
        outputDirectory,
      }),
      /injected adoption commit failure/,
    )

    assert.deepEqual(chain.tip, originalTip)
    assert.equal((await PersistentBlockProcessor.open(sourceDirectory)).tip.hash, originalTip.hash)
    assert.equal((await readDepositRecoveryGate(sourceDirectory))?.status, 'frozen')

    const adoptedTip = await chain.adoptReDerivedStore(outputDirectory)
    assert.equal(adoptedTip.number, originalTip.number)
    assert.notEqual(adoptedTip.hash, originalTip.hash)
    assert.equal(await readDepositRecoveryGate(sourceDirectory), undefined)
    assert.deepEqual(
      collectCanonicalDepositCredits(await chain.createCanonicalReadView()),
      [],
    )
  }, {
    persistenceTestHook: async (stage) => {
      if (!failAdoptionCommit || stage !== 'before-tip-rename') return
      failAdoptionCommit = false
      throw new Error('injected adoption commit failure')
    },
  })
})

test('re-including a reorged-out deposit credits it exactly once', async () => {
  await fixture(async ({ root, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    const view = await chain.createCanonicalReadView()

    const report = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: [operation.depositId],
      outputDirectory: join(root, 'out'),
    })
    const rederived = await PersistentBlockProcessor.open(report.outputDirectory)

    // The deposit becomes canonical again on L1: re-credit it on the re-derived chain.
    await rederived.buildNextBlock([], GENESIS_TIMESTAMP + 100n, [operation])
    const rederivedView = await rederived.createCanonicalReadView()
    assert.equal(await rederivedView.getAccountBalance(recipient), amountWei)
    const credits = collectCanonicalDepositCredits(rederivedView)
    assert.equal(credits.length, 1)
    assert.equal(credits[0]!.depositId, operation.depositId)
  })
})

test('re-derivation of one deposit in a multi-deposit block keeps the others', async () => {
  await fixture(async ({ root, chain }) => {
    const first = createEvmDepositOperation(recordFor())
    const second = createEvmDepositOperation(recordFor({
      depositId: `${'d'.repeat(64)}:1`,
      txid: 'd'.repeat(64),
      depositOutputIndex: 1,
      recipientAddress: secondRecipient.toString(),
      blockHash: 'e'.repeat(64),
    }))
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [first, second])
    const view = await chain.createCanonicalReadView()

    const report = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: [first.depositId],
      outputDirectory: join(root, 'out'),
    })
    assert.equal(report.blocksRebuilt, 1)
    assert.deepEqual(report.droppedDepositIds, [first.depositId])

    const rederived = await PersistentBlockProcessor.open(report.outputDirectory)
    const rederivedView = await rederived.createCanonicalReadView()
    assert.equal(await rederivedView.getAccountBalance(recipient), 0n)
    assert.equal(await rederivedView.getAccountBalance(secondRecipient), amountWei)
    assert.equal(rederivedView.getCanonicalDepositOperations(1n).length, 1)
  })
})

test('repeated recovery is deterministic', async () => {
  await fixture(async ({ root, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    await chain.buildNextBlock(
      [senderTx(0n, otherAccount, 7n)],
      GENESIS_TIMESTAMP + 2n,
    )
    const view = await chain.createCanonicalReadView()

    const first = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: [operation.depositId],
      outputDirectory: join(root, 'out-a'),
    })
    const second = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: [operation.depositId],
      outputDirectory: join(root, 'out-b'),
    })

    assert.equal(first.reDerivedTip.hash, second.reDerivedTip.hash)
    assert.deepEqual(
      first.blocks.map((block) => block.newHash),
      second.blocks.map((block) => block.newHash),
    )
  })
})

test('empty invalidation set is a no-op that creates no output', async () => {
  await fixture(async ({ root, chain }) => {
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
    const view = await chain.createCanonicalReadView()
    const report = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: [],
      outputDirectory: join(root, 'out'),
    })
    assert.equal(report.status, 'no-recovery-needed')
    assert.equal(await pathExists(join(root, 'out')), false)
  })
})

test('malformed deposit IDs are rejected', async () => {
  await fixture(async ({ root, chain }) => {
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
    const view = await chain.createCanonicalReadView()
    await assert.rejects(
      rederiveCanonicalL2AfterDepositInvalidation({
        canonicalView: view,
        invalidatedDepositIds: ['not-a-deposit-id'],
        outputDirectory: join(root, 'out'),
      }),
      ProtocolError,
    )
  })
})

test('an existing output directory is rejected before any work', async () => {
  await fixture(async ({ root, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    const view = await chain.createCanonicalReadView()
    const outputDirectory = join(root, 'out')
    await PersistentBlockProcessor.open(outputDirectory)

    await assert.rejects(
      rederiveCanonicalL2AfterDepositInvalidation({
        canonicalView: view,
        invalidatedDepositIds: [operation.depositId],
        outputDirectory,
      }),
      (error: unknown) => {
        assert.ok(error instanceof DepositReorgRecoveryError)
        assert.equal(error.kind, 'output-directory-not-usable')
        return true
      },
    )
  })
})

test('a failed recovery freeze persists across a processor reopen', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    await chain.buildNextBlock(
      [recipientTx(0n, otherAccount, amountWei / 2n)],
      GENESIS_TIMESTAMP + 2n,
    )
    await assert.rejects(
      recoverDepositReorg({
        processor: chain,
        invalidatedDepositIds: [operation.depositId],
        outputDirectory: join(root, 'out'),
      }),
      DepositReorgRecoveryError,
    )

    const reopened = await PersistentBlockProcessor.open(sourceDirectory)
    await assert.rejects(
      reopened.buildNextBlock([], GENESIS_TIMESTAMP + 2n),
      DepositRecoveryGateError,
    )
    await assert.rejects(
      reopened.acceptBlock(new Uint8Array()),
      DepositRecoveryGateError,
    )
    await clearDepositRecoveryGate(sourceDirectory)
    const accepted = await reopened.buildNextBlock([], GENESIS_TIMESTAMP + 3n)
    assert.equal(accepted.summary.number, '3')
  })
})

test('deposit recovery adopts a view that includes an in-flight extension', async () => {
  let pauseNextTipCommit = false
  let signalTipCommit!: () => void
  const tipCommitStarted = new Promise<void>((resolve) => {
    signalTipCommit = resolve
  })
  let releaseTipCommit!: () => void
  const tipCommitRelease = new Promise<void>((resolve) => {
    releaseTipCommit = resolve
  })
  let tipCommitWasReleased = false
  const release = () => {
    if (tipCommitWasReleased) return
    tipCommitWasReleased = true
    releaseTipCommit()
  }

  try {
    await fixture(async ({ root, sourceDirectory, chain }) => {
      const operation = createEvmDepositOperation(recordFor())
      await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])

      pauseNextTipCommit = true
      const extensionPromise = chain.buildNextBlock([], GENESIS_TIMESTAMP + 2n)
      await tipCommitStarted

      const recoveryPromise = recoverDepositReorg({
        processor: chain,
        invalidatedDepositIds: [operation.depositId],
        outputDirectory: join(root, 'out'),
      })
      const gateBeforeExtensionCommit = await readDepositRecoveryGate(sourceDirectory)

      release()
      const [extension, recovery] = await Promise.all([extensionPromise, recoveryPromise])

      assert.equal(gateBeforeExtensionCommit, undefined)
      assert.equal(extension.summary.number, '2')
      assert.equal(recovery.status, 're-derived')
      assert.equal(recovery.report.sourceTip.number, 2n)
      assert.equal(recovery.report.reDerivedTip.number, 2n)
      assert.equal(recovery.report.blocksRebuilt, 2)
      assert.equal(await readDepositRecoveryGate(sourceDirectory), undefined)
      assert.equal(chain.tip.number, 2n)
      assert.equal(chain.tip.hash, recovery.report.reDerivedTip.hash)
      assert.deepEqual(
        collectCanonicalDepositCredits(await chain.createCanonicalReadView()),
        [],
      )
    }, {
      beforeTipCommit: async () => {
        if (!pauseNextTipCommit) return
        pauseNextTipCommit = false
        signalTipCommit()
        await tipCommitRelease
      },
    })
  } finally {
    release()
  }
})

test('acceptBlock rejects a stale block from the invalidated branch after adoption', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const { operation, block2RlpHex } = await chainWithExtensibleChild(root, chain)

    await recoverDepositReorg({
      processor: chain,
      invalidatedDepositIds: [operation.depositId],
      outputDirectory: join(root, 'out'),
    })

    const tipBefore = { number: chain.tip.number, hash: chain.tip.hash }
    await assert.rejects(
      chain.acceptBlock(hexToBytes(block2RlpHex as `0x${string}`)),
      (error: unknown) => {
        assert.ok(error instanceof ProtocolError)
        assert.match(error.message, /parent hash does not match/)
        return true
      },
    )

    assert.equal(chain.tip.number, tipBefore.number)
    assert.equal(chain.tip.hash, tipBefore.hash)
    const reportTip = (await chain.createCanonicalReadView()).report.tip
    assert.equal(reportTip.number, tipBefore.number)
    assert.equal(reportTip.hash, tipBefore.hash)
  })
})

test('isolated replay into a fresh store still works while recovery has frozen the source', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const operation = createEvmDepositOperation(recordFor())
    await chain.buildNextBlock([], GENESIS_TIMESTAMP + 1n, [operation])
    const block1 = await chain.getCanonicalBlockByNumber(1n)
    assert.ok(block1)
    await chain.buildNextBlock(
      [recipientTx(0n, otherAccount, amountWei / 2n)],
      GENESIS_TIMESTAMP + 2n,
    )
    const block2 = await chain.getCanonicalBlockByNumber(2n)
    assert.ok(block2)

    await assert.rejects(
      recoverDepositReorg({
        processor: chain,
        invalidatedDepositIds: [operation.depositId],
        outputDirectory: join(root, 'out'),
      }),
      DepositReorgRecoveryError,
    )
    assert.equal((await readDepositRecoveryGate(sourceDirectory))?.status, 'frozen')

    const fresh = await PersistentBlockProcessor.open(join(root, 'fresh'))
    await fresh.acceptBlock(
      hexToBytes(block1.blockRlpHex as `0x${string}`),
      [operation],
    )
    const processed = await fresh.acceptBlock(
      hexToBytes(block2.blockRlpHex as `0x${string}`),
    )
    assert.equal(processed.summary.number, '2')
    assert.equal(fresh.tip.number, 2n)
  })
})

test('a malformed recovery-gate marker fails closed for both extension paths', async () => {
  await fixture(async ({ root, sourceDirectory, chain }) => {
    const { block2RlpHex } = await chainWithExtensibleChild(root, chain)
    await writeFile(
      depositRecoveryGatePath(sourceDirectory),
      '{ this is not a valid recovery gate',
    )

    await assert.rejects(chain.buildNextBlock([], GENESIS_TIMESTAMP + 3n))
    await assert.rejects(
      chain.acceptBlock(hexToBytes(block2RlpHex as `0x${string}`)),
    )

    assert.equal(chain.tip.number, 1n)
    assert.equal((await chain.createCanonicalReadView()).report.tip.number, 1n)
  })
})
