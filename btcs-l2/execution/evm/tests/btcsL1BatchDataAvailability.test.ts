import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PersistentBlockProcessor, ProtocolError } from '../src/blockProcessor.js'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import {
  inspectBtcsL1BatchDataAvailability,
  type BtcsL1BatchDataAvailabilityReport,
  type BtcsL1BatchDataCoreRpc,
} from '../src/btcsL1BatchDataAvailability.js'
import { encodeBtcsL1BatchData } from '../src/btcsL1BatchData.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ANCHORS = {
  previousCommitment: ZERO_COMMITMENT,
  parentHash: ZERO_HASH,
  startHeight: '0',
}

type FakeBlock = Readonly<{
  hash: string
  height: number
  tx: readonly unknown[]
}>

type FakeRpc = {
  rpc: BtcsL1BatchDataCoreRpc
  replace(blocks: readonly FakeBlock[]): void
  /**
   * Run `mutate` once, immediately after the `callCount`-th successful call to
   * `method`. The triggering call still returns the value computed from the
   * pre-mutation chain, so tests can deterministically change the chain partway
   * through a scan without any timing dependence.
   */
  mutateAfter(method: keyof BtcsL1BatchDataCoreRpc, callCount: number, mutate: () => void): void
}

function hashFor(height: number, branch: string): string {
  const chars = branch.replace(/[^a-f0-9]/gi, 'a').toLowerCase()
  let prefix = ''
  for (let i = 0; i < 4; i += 1) prefix += chars[i % chars.length]
  return prefix + height.toString(16).padStart(60, '0')
}

function makeFakeRpc(initial: readonly FakeBlock[]): FakeRpc {
  let blocks = [...initial]
  const calls: Record<string, number> = {}
  const triggers = new Map<string, { at: number; mutate: () => void }>()

  function after(method: keyof BtcsL1BatchDataCoreRpc): void {
    const count = (calls[method] ?? 0) + 1
    calls[method] = count
    const trigger = triggers.get(method)
    if (trigger !== undefined && trigger.at === count) {
      triggers.delete(method)
      trigger.mutate()
    }
  }

  return {
    rpc: {
      getBlockchainInfo: async () => {
        const info = { chain: 'regtest', blocks: blocks.length - 1 }
        after('getBlockchainInfo')
        return info
      },
      getBlockHash: async (height: number) => {
        const result = blocks[height]?.hash
        after('getBlockHash')
        return result
      },
      getBlock: async (hash: string) => {
        const result = blocks.find((block) => block.hash === hash)
        after('getBlock')
        return result
      },
    },
    replace(next) {
      blocks = [...next]
    },
    mutateAfter(method, callCount, mutate) {
      triggers.set(method, { at: callCount, mutate })
    },
  }
}

function txidFor(index: number): string {
  return index.toString(16).padStart(64, '0')
}

async function withDirectory(run: (directory: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-batch-availability-'))
  try {
    await run(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

type Publication = Readonly<{
  batchHash: string
  encoded: Awaited<ReturnType<typeof encodeBtcsL1BatchData>>
  anchorTxid: string
  fragmentTxids: readonly string[]
  transactions: readonly unknown[]
  block0: FakeBlock
  block1: FakeBlock
}>

async function buildPublication(directory: string): Promise<Publication> {
  const processor = await PersistentBlockProcessor.open(join(directory, 'chain'))
  const view = await processor.createCanonicalReadView()
  const genesis = view.getCanonicalBlockByNumber(0n)
  assert.ok(genesis)
  const batch = createEvmSettlementBatch([createEvmSettlementEnvelope(genesis.blockRlpHex)])
  const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
  const anchorTxid = txidFor(10)
  const fragmentTxids = encoded.fragments.map((_, index) => txidFor(index + 11))
  const transactions = [
    {
      txid: anchorTxid,
      vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batch.batchHash) } }],
    },
    ...encoded.fragments.map((fragment, index) => ({
      txid: fragmentTxids[index],
      vout: [{ scriptPubKey: { hex: fragment.scriptPubKeyHex } }],
    })),
  ]
  return {
    batchHash: batch.batchHash,
    encoded,
    anchorTxid,
    fragmentTxids,
    transactions,
    block0: { hash: hashFor(0, 'a'), height: 0, tx: transactions },
    block1: { hash: hashFor(1, 'a'), height: 1, tx: [] },
  }
}

function requestFor(
  fake: FakeRpc,
  publication: Publication,
  previousReport?: BtcsL1BatchDataAvailabilityReport,
) {
  return {
    rpc: fake.rpc,
    batchHash: publication.batchHash,
    anchorTxid: publication.anchorTxid,
    fragmentTxids: publication.fragmentTxids,
    anchors: ANCHORS,
    startHeight: 0,
    requiredConfirmations: 2,
    ...(previousReport === undefined ? {} : { previousReport }),
  }
}

test('reports awaiting-confirmations until the confirmation target is met, then available with full reconstruction', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const fake = makeFakeRpc([publication.block0])

    const waiting = await inspectBtcsL1BatchDataAvailability(requestFor(fake, publication))
    assert.equal(waiting.status, 'awaiting-confirmations')
    assert.equal(waiting.missingTxids.length, 0)
    assert.equal(waiting.fragmentCount, publication.encoded.fragments.length)

    fake.replace([publication.block0, publication.block1])
    const available = await inspectBtcsL1BatchDataAvailability(
      requestFor(fake, publication, waiting),
    )
    assert.equal(available.status, 'available')
    assert.equal(available.anchor?.confirmations, 2)
    assert.ok(available.fragments.every((item) => item.confirmations === 2))
    assert.equal(available.reconstructedBytes, publication.encoded.serializedBatch.byteLength)
  })
})

test('reports orphaned anchor and fragments when a reorg removes the publication', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const fake = makeFakeRpc([publication.block0, publication.block1])
    const available = await inspectBtcsL1BatchDataAvailability(requestFor(fake, publication))
    assert.equal(available.status, 'available')

    fake.replace([
      { hash: hashFor(0, 'b'), height: 0, tx: [] },
      { hash: hashFor(1, 'b'), height: 1, tx: [] },
    ])
    const orphaned = await inspectBtcsL1BatchDataAvailability(
      requestFor(fake, publication, available),
    )
    assert.equal(orphaned.status, 'incomplete')
    assert.equal(orphaned.missingTxids.length, publication.fragmentTxids.length + 1)
    assert.equal(orphaned.orphanedTxids.length, publication.fragmentTxids.length + 1)
  })
})

test('revalidates a replacement inclusion and restores availability', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const fake = makeFakeRpc([publication.block0, publication.block1])
    const available = await inspectBtcsL1BatchDataAvailability(requestFor(fake, publication))
    assert.equal(available.status, 'available')

    const reincludeBlock1: FakeBlock = {
      hash: hashFor(1, 'c'),
      height: 1,
      tx: publication.transactions,
    }
    fake.replace([
      { hash: hashFor(0, 'c'), height: 0, tx: [] },
      reincludeBlock1,
      { hash: hashFor(2, 'c2'), height: 2, tx: [] },
    ])
    const reobserved = await inspectBtcsL1BatchDataAvailability(
      requestFor(fake, publication, available),
    )
    assert.equal(reobserved.status, 'available')
    assert.equal(reobserved.anchor?.blockHash, reincludeBlock1.hash)
    assert.equal(reobserved.reorganizedTxids.length, publication.fragmentTxids.length + 1)
    assert.equal(reobserved.orphanedTxids.length, 0)
  })
})

test('fails closed when the chain tip height increases during the scan', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const fake = makeFakeRpc([publication.block0, publication.block1])
    fake.mutateAfter('getBlock', 1, () => {
      fake.replace([
        publication.block0,
        publication.block1,
        { hash: hashFor(2, 'a'), height: 2, tx: [] },
      ])
    })

    await assert.rejects(
      inspectBtcsL1BatchDataAvailability(requestFor(fake, publication)),
      (error: unknown) =>
        error instanceof ProtocolError && /tip height changed during/.test(error.message),
    )
  })
})

test('fails closed when a previously scanned block changes at an unchanged tip height', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const fake = makeFakeRpc([publication.block0, publication.block1])
    fake.mutateAfter('getBlock', 1, () => {
      fake.replace([
        { hash: hashFor(0, 'b'), height: 0, tx: [] },
        { hash: hashFor(1, 'b'), height: 1, tx: [] },
      ])
    })

    await assert.rejects(
      inspectBtcsL1BatchDataAvailability(requestFor(fake, publication)),
      (error: unknown) =>
        error instanceof ProtocolError && /active chain changed during/.test(error.message),
    )
  })
})

test('fails closed with a typed error when a fragment transaction contains a malformed fragment', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    // BTCD magic + version present but header cut short
    const malformedFragmentTx = {
      txid: publication.fragmentTxids[0],
      vout: [{ scriptPubKey: { hex: '6a054254434401' } }],
    }
    const block0: FakeBlock = {
      hash: hashFor(0, 'd'),
      height: 0,
      tx: [
        { txid: publication.anchorTxid, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(publication.batchHash) } }] },
        malformedFragmentTx,
        ...publication.transactions.slice(2),
      ],
    }
    const fake = makeFakeRpc([block0, { hash: hashFor(1, 'd'), height: 1, tx: [] }])
    await assert.rejects(
      inspectBtcsL1BatchDataAvailability(requestFor(fake, publication)),
      (error: unknown) => {
        if (!(error instanceof ProtocolError)) return false
        return /malformed batch-data fragment/.test(error.message) || /truncated/.test(error.message)
      },
    )
  })
})

test('fails closed when a fragment transaction contains another batch hash', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const otherBatchHash = 'b'.repeat(64)
    const otherScript = encodeBtcsL1AnchorScript(otherBatchHash).replace('6a27' + '4254434c32' + otherBatchHash.slice(0, 10), '') // wrong approach
  })
})

test('reports incomplete when a fragment transaction has no matching fragment and no conflicting batch hash', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const unrelatedDataTx = {
      txid: publication.fragmentTxids[0],
      vout: [{ scriptPubKey: { hex: '6a03deadbeef' } }],
    }
    const block0: FakeBlock = {
      hash: hashFor(0, 'e'),
      height: 0,
      tx: [
        { txid: publication.anchorTxid, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(publication.batchHash) } }] },
        unrelatedDataTx,
        ...publication.transactions.slice(2),
      ],
    }
    const fake = makeFakeRpc([block0, { hash: hashFor(1, 'e'), height: 1, tx: [] }])
    const report = await inspectBtcsL1BatchDataAvailability(requestFor(fake, publication))
    assert.equal(report.status, 'incomplete')
    assert.ok(report.missingTxids.includes(publication.fragmentTxids[0]))
  })
})

test('fails closed on duplicate publication transaction in the scan range', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const duplicate = publication.transactions[0]
    const block0: FakeBlock = {
      hash: hashFor(0, 'f'),
      height: 0,
      tx: [...publication.transactions, duplicate],
    }
    const fake = makeFakeRpc([block0, { hash: hashFor(1, 'f'), height: 1, tx: [] }])
    await assert.rejects(
      inspectBtcsL1BatchDataAvailability(requestFor(fake, publication)),
      (error: unknown) => error instanceof ProtocolError && /appears more than once/.test(error.message),
    )
  })
})

test('rejects anchor transaction with wrong commitment script', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const block0: FakeBlock = {
      hash: hashFor(0, 'g'),
      height: 0,
      tx: [
        { txid: publication.anchorTxid, vout: [{ scriptPubKey: { hex: '6a27' + '4254434c32' + '0'.repeat(64) } }] },
        ...publication.transactions.slice(1),
      ],
    }
    const fake = makeFakeRpc([block0, { hash: hashFor(1, 'g'), height: 1, tx: [] }])
    await assert.rejects(
      inspectBtcsL1BatchDataAvailability(requestFor(fake, publication)),
      (error: unknown) => error instanceof ProtocolError && /exactly one matching commitment/.test(error.message),
    )
  })
})

test('rejects fragment transaction containing another batch hash', async () => {
  await withDirectory(async (directory) => {
    const publication = await buildPublication(directory)
    const { encodeBtcsL1BatchData: encodeB } = await import('../src/btcsL1BatchData.js')
    const { createEvmSettlementBatch: createB } = await import('../src/settlementBatch.js')
    const { createEvmSettlementEnvelope: createE } = await import('../src/settlementEnvelope.js')
    const { PersistentBlockProcessor: PBP } = await import('../src/blockProcessor.js')
    const proc = await PBP.open(join(directory, 'chain2'))
    const view = await proc.createCanonicalReadView()
    const genesis = view.getCanonicalBlockByNumber(0n)
    assert.ok(genesis)
    const envelope0b = createE(genesis.blockRlpHex)
    const timestamp = BigInt(Math.floor(Date.now() / 1000)) + 1000n
    await proc.buildNextBlock([], timestamp)
    const view2 = await proc.createCanonicalReadView()
    const child = view2.getCanonicalBlockByNumber(1n)
    assert.ok(child)
    const envelope1b = createE(child.blockRlpHex, envelope0b.commitmentHash)
    const batch2 = createB([envelope0b, envelope1b])
    const enc2 = await encodeB(batch2, ANCHORS)
    assert.notEqual(batch2.batchHash, publication.batchHash)
    const wrongHashTx = {
      txid: publication.fragmentTxids[0],
      vout: [{ scriptPubKey: { hex: enc2.fragments[0]!.scriptPubKeyHex } }],
    }
    const block0: FakeBlock = {
      hash: hashFor(0, 'h'),
      height: 0,
      tx: [
        { txid: publication.anchorTxid, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(publication.batchHash) } }] },
        wrongHashTx,
        ...publication.transactions.slice(2),
      ],
    }
    const fake = makeFakeRpc([block0, { hash: hashFor(1, 'h'), height: 1, tx: [] }])
    await assert.rejects(
      inspectBtcsL1BatchDataAvailability(requestFor(fake, publication)),
      (error: unknown) => error instanceof ProtocolError && /another batch hash/.test(error.message),
    )
  })
})
