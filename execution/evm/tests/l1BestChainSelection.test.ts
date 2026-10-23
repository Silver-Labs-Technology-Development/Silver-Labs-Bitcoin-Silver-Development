import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BestChainSelector,
  computeBlockHash,
  computeChainwork,
  createCheckpoint,
  DEFAULT_CHAIN_PARAMS,
  type ChainConsensusParams,
  type Checkpoint,
  type HeaderChainEntry,
  type L1Header,
} from '../src/l1HeaderVerifier.js'
import {
  HEIGHT_555_HASH,
  HEIGHT_555_MERKLE_ROOT,
  HEIGHT_555_PREVIOUS_HASH,
  HEIGHT_555_TIME,
  HEIGHT_556_HASH,
  HEIGHT_556_MERKLE_ROOT,
  HEIGHT_556_PREVIOUS_HASH,
  HEIGHT_556_TIME,
  REAL_PROOF,
  REAL_TXID,
} from './fixtures/btcsL1ProofFixture.js'

import type { BtcsL1ConfirmationRequest } from '../src/btcsL1Confirmation.js'
import type { BtcsL1DepositRequest } from '../src/btcsL1Deposit.js'

const CHECKPOINT_NETWORK = 'regtest'

function makeChildHeader(
  parent: L1Header,
  height: number,
  timeOffset = 600,
  bits: string = parent.bits as string,
): L1Header {
  for (let nonce = 0; nonce < 1_000_000; nonce++) {
    const draft: L1Header = {
      hash: '',
      version: 1,
      previousblockhash: parent.hash,
      merkleroot: '0'.repeat(64),
      time: (parent.time as number) + timeOffset,
      bits,
      nonce,
      height,
    }
    const hash = computeBlockHash(draft)
    const target = BigInt('0x7fffff') << BigInt(232)
    if (BigInt(`0x${hash}`) <= target) {
      return { ...draft, hash } as L1Header
    }
  }
  throw new Error('could not find valid nonce within test budget')
}

function makeFixtureCheckpoint(): Checkpoint {
  const target = BigInt('0x7fffff') << BigInt(232)
  const chainwork = computeChainwork(target)
  return createCheckpoint(
    {
      hash: HEIGHT_556_HASH,
      version: 1,
      previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      merkleroot: HEIGHT_556_MERKLE_ROOT,
      time: HEIGHT_556_TIME,
      bits: '207fffff',
      nonce: 0,
      height: 556,
    },
    chainwork,
    DEFAULT_CHAIN_PARAMS,
  )
}

/*============================================================================
  Checkpoint validation
============================================================================*/

test('best chain selector: rejects checkpoint with mismatched network', () => {
  const checkpoint: Checkpoint = {
    network: 'main',
    height: 556,
    hash: HEIGHT_556_HASH,
    bits: '207fffff',
    time: HEIGHT_556_TIME,
    chainwork: computeChainwork(BigInt('0x7fffff') << BigInt(232)),
  }
  assert.throws(
    () =>
      new BestChainSelector(checkpoint, { ...DEFAULT_CHAIN_PARAMS, network: 'regtest' }),
    /does not match/,
  )
})

test('best chain selector: rejects checkpoint with invalid hash', () => {
  assert.throws(
    () =>
      createCheckpoint(
        {
          hash: 'not-a-hash',
          version: 1,
          previousblockhash: '0'.repeat(64),
          merkleroot: '0'.repeat(64),
          time: 1,
          bits: '207fffff',
          nonce: 0,
          height: 0,
        },
        computeChainwork(BigInt('0x7fffff') << BigInt(232)),
        DEFAULT_CHAIN_PARAMS,
      ),
    /hash must be 64/,
  )
})

test('best chain selector: rejects checkpoint with target exceeding PoW limit', () => {
  assert.throws(
    () =>
      createCheckpoint(
        {
          hash: HEIGHT_556_HASH,
          version: 1,
          previousblockhash: HEIGHT_556_PREVIOUS_HASH,
          merkleroot: HEIGHT_556_MERKLE_ROOT,
          time: HEIGHT_556_TIME,
          bits: '2100ffff',
          nonce: 0,
          height: 556,
        },
        computeChainwork(BigInt('0x7fffff') << BigInt(232)),
        DEFAULT_CHAIN_PARAMS,
      ),
    /exceeds the proof-of-work limit/,
  )
})

/*============================================================================
  Header validation: PoW, linkage, height, serialization
============================================================================*/

test('best chain selector: accepts a valid child of the checkpoint', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const child = makeChildHeader(
    {
      hash: HEIGHT_556_HASH,
      previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      merkleroot: HEIGHT_556_MERKLE_ROOT,
      time: HEIGHT_556_TIME,
      bits: '207fffff',
      nonce: 0,
      height: 556,
    },
    557,
  )
  assert.ok(selector.addHeader(child))
  assert.equal(selector.getChainHeight(), 557)
})

test('best chain selector: rejects header that does not connect to checkpoint', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const orphan: L1Header = {
    hash: 'a'.repeat(64),
    previousblockhash: 'b'.repeat(64),
    merkleroot: '0'.repeat(64),
    version: 1,
    time: 1,
    bits: '207fffff',
    nonce: 0,
    height: 999,
  }
  const orphanHash = computeBlockHash(orphan)
  const orphanWithHash: L1Header = { ...orphan, hash: orphanHash }
  assert.throws(() => selector.addHeader(orphanWithHash), /does not connect/)
})

test('best chain selector: rejects broken parent linkage', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const child = makeChildHeader(
    {
      hash: HEIGHT_556_HASH,
      previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      merkleroot: HEIGHT_556_MERKLE_ROOT,
      time: HEIGHT_556_TIME,
      bits: '207fffff',
      nonce: 0,
      height: 556,
    },
    557,
  )
  assert.ok(selector.addHeader(child))

  const badGrandchild: L1Header = {
    ...child,
    hash: '',
    previousblockhash: 'f'.repeat(64),
    height: 558,
  }
  const badGrandchildHash = computeBlockHash(badGrandchild)
  const badGrandchildWithHash: L1Header = { ...badGrandchild, hash: badGrandchildHash }
  assert.throws(() => selector.addHeader(badGrandchildWithHash), /does not follow parent height|does not connect/)
})

test('best chain selector: rejects inconsistent height sequence', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const child = makeChildHeader(
    {
      hash: HEIGHT_556_HASH,
      previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      merkleroot: HEIGHT_556_MERKLE_ROOT,
      time: HEIGHT_556_TIME,
      bits: '207fffff',
      nonce: 0,
      height: 556,
    },
    557,
  )
  assert.ok(selector.addHeader(child))

  const badHeight: L1Header = {
    ...child,
    hash: '',
    previousblockhash: child.hash,
    height: 559,
  }
  const badHeightHash = computeBlockHash(badHeight)
  const badHeightWithHash: L1Header = { ...badHeight, hash: badHeightHash }
  assert.throws(() => selector.addHeader(badHeightWithHash), /does not follow parent height/)
})

test('best chain selector: rejects header whose hash does not match fields', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const child = makeChildHeader(
    {
      hash: HEIGHT_556_HASH,
      previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      merkleroot: HEIGHT_556_MERKLE_ROOT,
      time: HEIGHT_556_TIME,
      bits: '207fffff',
      nonce: 0,
      height: 556,
    },
    557,
  )
  const tampered: L1Header = { ...child, hash: 'f'.repeat(64) }
  assert.throws(() => selector.addHeader(tampered), /hash does not match/)
})

test('best chain selector: rejects header with target exceeding PoW limit', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const child = makeChildHeader(
    {
      hash: HEIGHT_556_HASH,
      previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      merkleroot: HEIGHT_556_MERKLE_ROOT,
      time: HEIGHT_556_TIME,
      bits: '207fffff',
      nonce: 0,
      height: 556,
    },
    557,
  )
  assert.ok(selector.addHeader(child))

  const badTarget: L1Header = {
    ...child,
    hash: '',
    previousblockhash: child.hash,
    height: 558,
    bits: '2100ffff', // exponent 33 => target larger than powLimit
  }
  const badTargetHash = computeBlockHash(badTarget)
  const badTargetWithHash: L1Header = { ...badTarget, hash: badTargetHash }
  assert.throws(() => selector.addHeader(badTargetWithHash), /exceeds proof-of-work limit/)
})

test('best chain selector: rejects header failing proof of work', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const child = makeChildHeader(
    {
      hash: HEIGHT_556_HASH,
      previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      merkleroot: HEIGHT_556_MERKLE_ROOT,
      time: HEIGHT_556_TIME,
      bits: '207fffff',
      nonce: 0,
      height: 556,
    },
    557,
  )
  assert.ok(selector.addHeader(child))

  const veryHard: L1Header = {
    ...child,
    hash: '',
    previousblockhash: child.hash,
    height: 558,
    bits: '1a00ffff',
  }
  const veryHardHash = computeBlockHash(veryHard)
  const veryHardWithHash: L1Header = { ...veryHard, hash: veryHardHash }
  assert.throws(() => selector.addHeader(veryHardWithHash), /proof-of-work target/)
})

/*============================================================================
  Chainwork computation
============================================================================*/

test('chainwork: computes integer work from target', () => {
  const target = BigInt('0x7fffff') << BigInt(232)
  const work = computeChainwork(target)
  assert.ok(work > 0n)
  const expected = (BigInt(1) << BigInt(256)) / (target + 1n)
  assert.equal(work, expected)
})

test('chainwork: higher target means less work', () => {
  const easyTarget = BigInt('0x7fffff') << BigInt(232)
  const hardTarget = BigInt(1) << BigInt(200)
  assert.ok(computeChainwork(easyTarget) < computeChainwork(hardTarget))
})

/*============================================================================
  Best chain selection: cumulative work, not height
============================================================================*/

test('best chain selection: longer chain at same difficulty wins', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }

  // Chain A: 3 blocks (557-559)
  const a1 = makeChildHeader(base, 557)
  const a2 = makeChildHeader(a1, 558)
  const a3 = makeChildHeader(a2, 559)
  selector.addHeader(a1)
  selector.addHeader(a2)
  selector.addHeader(a3)
  assert.equal(selector.getChainHeight(), 559)
  assert.equal(selector.getSelectedTip()!.header.hash, a3.hash)

  // Chain B: 5 blocks (557-561) - longer, same difficulty => more work
  const b1 = makeChildHeader(base, 557)
  const b2 = makeChildHeader(b1, 558)
  const b3 = makeChildHeader(b2, 559)
  const b4 = makeChildHeader(b3, 560)
  const b5 = makeChildHeader(b4, 561)
  selector.addHeader(b1)
  selector.addHeader(b2)
  selector.addHeader(b3)
  selector.addHeader(b4)
  selector.addHeader(b5)

  const tip = selector.getSelectedTip()!
  assert.equal(tip.header.height, 561)
  assert.equal(tip.header.hash, b5.hash)
})

test('best chain selection: lower-work fork does not displace selected chain', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }

  const m1 = makeChildHeader(base, 557)
  const m2 = makeChildHeader(m1, 558)
  const m3 = makeChildHeader(m2, 559)
  selector.addHeader(m1)
  selector.addHeader(m2)
  selector.addHeader(m3)

  const heightBefore = selector.getChainHeight()
  const tipBefore = selector.getSelectedTip()!.header.hash

  const f1 = makeChildHeader(base, 557)
  const f2 = makeChildHeader(f1, 558)
  selector.addHeader(f1)
  selector.addHeader(f2)

  assert.equal(selector.getChainHeight(), heightBefore)
  assert.equal(selector.getSelectedTip()!.header.hash, tipBefore)
})

test('best chain selection: equal-work tie is deterministic by lowest hash', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }

  const t1 = makeChildHeader(base, 557, 600)
  const t2 = makeChildHeader(base, 557, 601)
  assert.notEqual(t1.hash, t2.hash)

  selector.addHeader(t1)
  selector.addHeader(t2)

  const tip = selector.getSelectedTip()!
  const expected = t1.hash < t2.hash ? t1 : t2
  assert.equal(tip.header.hash, expected.hash)
})

/*============================================================================
  Chain membership (reorg protection)
============================================================================*/

test('best chain selection: isOnSelectedChain returns true for main chain blocks', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }
  const c1 = makeChildHeader(base, 557)
  const c2 = makeChildHeader(c1, 558)
  selector.addHeader(c1)
  selector.addHeader(c2)

  assert.ok(selector.isOnSelectedChain(HEIGHT_556_HASH))
  assert.ok(selector.isOnSelectedChain(c1.hash))
  assert.ok(selector.isOnSelectedChain(c2.hash))
})

test('best chain selection: isOnSelectedChain returns false for forked blocks', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }
  const m1 = makeChildHeader(base, 557)
  const m2 = makeChildHeader(m1, 558)
  selector.addHeader(m1)
  selector.addHeader(m2)

  const f1 = makeChildHeader(base, 557, 700)
  selector.addHeader(f1)

  assert.ok(selector.isOnSelectedChain(m1.hash))
  assert.ok(selector.isOnSelectedChain(m2.hash))
  assert.ok(!selector.isOnSelectedChain(f1.hash))
})

test('best chain selection: isOnSelectedChain returns false for unknown hash', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  assert.ok(!selector.isOnSelectedChain('0'.repeat(64)))
})

test('reorg: higher-work chain replaces selected chain; old fork blocks no longer selected', () => {
  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }

  const o1 = makeChildHeader(base, 557)
  const o2 = makeChildHeader(o1, 558)
  const o3 = makeChildHeader(o2, 559)
  selector.addHeader(o1)
  selector.addHeader(o2)
  selector.addHeader(o3)
  assert.ok(selector.isOnSelectedChain(o3.hash))

  const n1 = makeChildHeader(base, 557, 700)
  const n2 = makeChildHeader(n1, 558, 700)
  const n3 = makeChildHeader(n2, 559, 700)
  const n4 = makeChildHeader(n3, 560, 700)
  const n5 = makeChildHeader(n4, 561, 700)
  selector.addHeader(n1)
  selector.addHeader(n2)
  selector.addHeader(n3)
  selector.addHeader(n4)
  selector.addHeader(n5)

  assert.equal(selector.getChainHeight(), 561)
  assert.equal(selector.getSelectedTip()!.header.hash, n5.hash)
  assert.ok(!selector.isOnSelectedChain(o3.hash))
  assert.ok(!selector.isOnSelectedChain(o2.hash))
  assert.ok(!selector.isOnSelectedChain(o1.hash))
})

/*============================================================================
  Integration with confirmation/deposit acceptance
============================================================================*/

test('confirmation: rejects block not on locally selected chain', async () => {
  const { verifyBtcsL1AnchorConfirmation } = await import('../src/btcsL1Confirmation.js')
  const { encodeBtcsL1AnchorScript } = await import('../src/btcsL1Anchor.js')

  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }
  const c1 = makeChildHeader(base, 557)
  selector.addHeader(c1)

  const txid = '1'.repeat(64)
  const forkBlockHash = '2'.repeat(64)
  const batchHash = '3'.repeat(64)
  const request: BtcsL1ConfirmationRequest = { txid, blockHash: forkBlockHash, batchHash, requiredConfirmations: 1 }

  const rpc = {
    async getRawTransaction() {
      return { txid, blockhash: forkBlockHash, in_active_chain: true, confirmations: 10, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }] }
    },
    async getBlockHeader() {
      return { hash: forkBlockHash, height: 557, confirmations: 10 }
    },
  }

  await assert.rejects(
    verifyBtcsL1AnchorConfirmation(rpc, request, { bestChainSelector: selector }),
    /not a member of the locally selected best chain/,
  )
})

test('deposit: rejects block not on locally selected chain', async () => {
  const { verifyBtcsL1Deposit } = await import('../src/btcsL1Deposit.js')
  const { encodeBtcsL1DepositPayload } = await import('../src/btcsL1Deposit.js')

  const selector = new BestChainSelector(makeFixtureCheckpoint())
  const base: L1Header = {
    hash: HEIGHT_556_HASH,
    previousblockhash: HEIGHT_556_PREVIOUS_HASH,
    merkleroot: HEIGHT_556_MERKLE_ROOT,
    time: HEIGHT_556_TIME,
    bits: '207fffff',
    nonce: 0,
    height: 556,
  }
  const c1 = makeChildHeader(base, 557)
  selector.addHeader(c1)

  const recipient = `0x${'b'.repeat(40)}`
  const depositScript = `0014${'a'.repeat(40)}`
  const txid = '1'.repeat(64)
  const forkBlockHash = '2'.repeat(64)
  const request: BtcsL1DepositRequest = {
    txid,
    blockHash: forkBlockHash,
    recipientAddress: recipient,
    depositScriptPubKeyHex: depositScript,
    requiredConfirmations: 6,
  }

  const rpc = {
    async getRawTransaction() {
      return {
        txid,
        blockhash: forkBlockHash,
        in_active_chain: true,
        confirmations: 10,
        vout: [
          { n: 0, value: 0, scriptPubKey: { hex: `6a1c${encodeBtcsL1DepositPayload(recipient)}` } },
          { n: 1, value: 12.3456789, scriptPubKey: { hex: depositScript } },
        ],
      }
    },
    async getBlockHeader() {
      return { hash: forkBlockHash, height: 557, confirmations: 10 }
    },
  }

  await assert.rejects(
    verifyBtcsL1Deposit(rpc, request, { bestChainSelector: selector }),
    /not a member of the locally selected best chain/,
  )
})

test('confirmation: accepts block on locally selected chain with local-inclusion-proof model', async () => {
  const { verifyBtcsL1AnchorConfirmation } = await import('../src/btcsL1Confirmation.js')
  const { encodeBtcsL1AnchorScript } = await import('../src/btcsL1Anchor.js')
  type BtcsL1ConfirmationRequest = {
    txid: string
    blockHash: string
    batchHash: string
    requiredConfirmations: number
  }

  const selector = new BestChainSelector(makeFixtureCheckpoint())
  assert.ok(selector.isOnSelectedChain(HEIGHT_556_HASH))

  const batchHash = '3'.repeat(64)
  const request: BtcsL1ConfirmationRequest = {
    txid: REAL_TXID,
    blockHash: HEIGHT_556_HASH,
    batchHash,
    requiredConfirmations: 1,
  }

  const rpc = {
    async getRawTransaction() {
      return {
        txid: REAL_TXID,
        blockhash: HEIGHT_556_HASH,
        in_active_chain: true,
        confirmations: 10,
        vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }],
      }
    },
    async getBlockHeader() {
      return {
        hash: HEIGHT_556_HASH,
        height: 556,
        confirmations: 10,
        merkleroot: HEIGHT_556_MERKLE_ROOT,
        previousblockhash: HEIGHT_556_PREVIOUS_HASH,
      }
    },
    async getTxOutProof() {
      return REAL_PROOF
    },
  }

  const report = await verifyBtcsL1AnchorConfirmation(rpc, request, {
    bestChainSelector: selector,
  })
  assert.equal(report.verificationModel, 'local-best-chain+local-inclusion-proof')
  assert.equal(report.inclusionProofVerified, true)
})

test('confirmation: accepts block on locally selected chain without inclusion proof as local-best-chain-only', async () => {
  const { verifyBtcsL1AnchorConfirmation } = await import('../src/btcsL1Confirmation.js')
  const { encodeBtcsL1AnchorScript } = await import('../src/btcsL1Anchor.js')
  type BtcsL1ConfirmationRequest = {
    txid: string
    blockHash: string
    batchHash: string
    requiredConfirmations: number
  }

  const selector = new BestChainSelector(makeFixtureCheckpoint())
  assert.ok(selector.isOnSelectedChain(HEIGHT_556_HASH))

  const batchHash = '3'.repeat(64)
  const request: BtcsL1ConfirmationRequest = {
    txid: '1'.repeat(64),
    blockHash: HEIGHT_556_HASH,
    batchHash,
    requiredConfirmations: 1,
  }

  const rpc = {
    async getRawTransaction() {
      return {
        txid: '1'.repeat(64),
        blockhash: HEIGHT_556_HASH,
        in_active_chain: true,
        confirmations: 10,
        vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }],
      }
    },
    async getBlockHeader() {
      return { hash: HEIGHT_556_HASH, height: 556, confirmations: 10 }
    },
  }

  const report = await verifyBtcsL1AnchorConfirmation(rpc, request, {
    bestChainSelector: selector,
  })
  assert.equal(report.verificationModel, 'local-best-chain-only')
  assert.equal(report.inclusionProofVerified, false)
})

test('confirmation: without bestChainSelector falls back to trusted-RPC model', async () => {
  const { verifyBtcsL1AnchorConfirmation } = await import('../src/btcsL1Confirmation.js')
  const { encodeBtcsL1AnchorScript } = await import('../src/btcsL1Anchor.js')
  type BtcsL1ConfirmationRequest = {
    txid: string
    blockHash: string
    batchHash: string
    requiredConfirmations: number
  }

  const batchHash = '3'.repeat(64)
  const request: BtcsL1ConfirmationRequest = {
    txid: '1'.repeat(64),
    blockHash: '2'.repeat(64),
    batchHash,
    requiredConfirmations: 1,
  }

  const rpc = {
    async getRawTransaction() {
      return {
        txid: '1'.repeat(64),
        blockhash: '2'.repeat(64),
        in_active_chain: true,
        confirmations: 10,
        vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }],
      }
    },
    async getBlockHeader() {
      return { hash: '2'.repeat(64), height: 120, confirmations: 10 }
    },
  }

  const report = await verifyBtcsL1AnchorConfirmation(rpc, request)
  assert.equal(report.verificationModel, 'trusted-btcs-core-rpc')
  assert.equal(report.inclusionProofVerified, false)
})