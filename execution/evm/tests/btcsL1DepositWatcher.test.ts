import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { encodeBtcsL1DepositScript } from '../src/btcsL1Deposit.js'
import { BtcsL1DepositStore } from '../src/btcsL1DepositStore.js'
import {
  BtcsL1DepositWatcher,
  BtcsL1DepositWatcherDeepReorgError,
  type BtcsL1DepositWatcherRpc,
} from '../src/btcsL1DepositWatcher.js'
import { readDepositRecoveryGate } from '../src/depositRecoveryGate.js'

const txid = 'a'.repeat(64)
const recipientAddress = `0x${'b'.repeat(40)}`
const depositScriptPubKeyHex = `0014${'c'.repeat(40)}`
const depositId = `${txid}:1`
const requiredConfirmations = 2

function hashFor(label: string): string {
  return createHash('sha256').update(label).digest('hex')
}

class FakeCoreRpc implements BtcsL1DepositWatcherRpc {
  tip = 3
  readonly activeHashes = new Map<number, string>()
  readonly blocks = new Map<string, { hash: string; height: number; tx: unknown[] }>()
  readonly blockHeights = new Map<string, number>()
  readonly blockTransactions = new Map<string, unknown[]>()
  failNextBlockHeader = false
  failNextGetBlock = false

  constructor() {
    for (let height = 0; height <= this.tip; height += 1) {
      this.setBlock(height, hashFor(String(height)), [])
    }
    this.setBlock(2, hashFor('2'), [this.depositTransaction()])
  }

  setBlock(height: number, hash: string, tx: unknown[]): void {
    this.activeHashes.set(height, hash)
    this.blockHeights.set(hash, height)
    this.blockTransactions.set(hash, tx)
    this.blocks.set(hash, { hash, height, tx })
  }

  reorgFrom(height: number, alternateLabel: string): string {
    for (let current = height; current <= this.tip; current += 1) {
      const hash = hashFor(alternateLabel + current)
      this.setBlock(current, hash, current === 2 ? [this.depositTransaction()] : [])
    }
    return this.activeHashes.get(2)!
  }

  depositTransaction(): unknown {
    return {
      txid,
      vout: [
        { n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipientAddress) } },
        { n: 1, value: 0.25, scriptPubKey: { hex: depositScriptPubKeyHex } },
      ],
    }
  }

  async getBlockchainInfo(): Promise<unknown> {
    return { chain: 'regtest', blocks: this.tip }
  }

  async getBlockHash(height: number): Promise<unknown> {
    const hash = this.activeHashes.get(height)
    if (hash === undefined) throw new Error('height is not on the active chain')
    return hash
  }

  async getBlock(blockHash: string): Promise<unknown> {
    if (this.failNextGetBlock) {
      this.failNextGetBlock = false
      throw new Error('temporary RPC failure')
    }
    const block = this.blocks.get(blockHash)
    if (block === undefined) throw new Error('unknown block')
    return block
  }

  async getRawTransaction(requestedTxid: string, blockHash: string): Promise<unknown> {
    if (requestedTxid !== txid) throw new Error('unknown transaction')
    const height = this.blockHeights.get(blockHash)
    if (height === undefined) throw new Error('unknown transaction block')
    const active = this.activeHashes.get(height) === blockHash
    return {
      txid,
      blockhash: blockHash,
      in_active_chain: active,
      confirmations: active ? this.tip - height + 1 : -1,
      vout: [
        { n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipientAddress) } },
        { n: 1, value: 0.25, scriptPubKey: { hex: depositScriptPubKeyHex } },
      ],
    }
  }

  async getBlockHeader(blockHash: string): Promise<unknown> {
    if (this.failNextBlockHeader) {
      this.failNextBlockHeader = false
      throw new Error('temporary RPC failure')
    }
    const height = this.blockHeights.get(blockHash)
    if (height === undefined) throw new Error('unknown block header')
    const active = this.activeHashes.get(height) === blockHash
    return {
      hash: blockHash,
      height,
      confirmations: active ? this.tip - height + 1 : -1,
    }
  }
}

async function withWatcher(
  action: (
    directory: string,
    deposits: BtcsL1DepositStore,
    rpc: FakeCoreRpc,
    watcher: BtcsL1DepositWatcher,
    l2Directory: string,
  ) => Promise<void>,
  options: { reorgWindowBlocks?: number; freezeChain?: boolean } = {},
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-deposit-watcher-'))
  const l2Directory = join(directory, 'l2')
  let watcher: BtcsL1DepositWatcher | undefined
  try {
    const deposits = await BtcsL1DepositStore.create(join(directory, 'deposits'))
    const rpc = new FakeCoreRpc()
    if (options.freezeChain) await mkdir(l2Directory)
    watcher = await BtcsL1DepositWatcher.create({
      rpc,
      deposits,
      cursorDirectory: join(directory, 'cursor'),
      depositScriptPubKeyHex,
      requiredConfirmations,
      startHeight: 1,
      reorgWindowBlocks: options.reorgWindowBlocks,
      chainDirectory: options.freezeChain ? l2Directory : undefined,
    })
    await action(join(directory, 'cursor'), deposits, rpc, watcher, l2Directory)
  } finally {
    await watcher?.close()
    await rm(directory, { recursive: true, force: true })
  }
}

test('watcher only records a deposit after the configured confirmation threshold', async () => {
  await withWatcher(async (cursorDirectory, deposits, rpc, watcher) => {
    rpc.tip = 2
    const immature = await watcher.pollOnce()
    assert.equal(immature.scannedThroughHeight, 1)
    assert.equal(immature.caughtUp, true)
    assert.equal(deposits.get(depositId), undefined)

    rpc.tip = 3
    const mature = await watcher.pollOnce()
    assert.deepEqual(mature.discoveredDepositIds, [depositId])
    assert.equal(mature.scannedThroughHeight, 2)
    assert.equal(deposits.get(depositId)?.confirmations, requiredConfirmations)

    await watcher.close()
    const reopened = await BtcsL1DepositWatcher.open({
      rpc,
      deposits,
      cursorDirectory,
      depositScriptPubKeyHex,
      requiredConfirmations,
      startHeight: 1,
    })
    const again = await reopened.pollOnce()
    assert.deepEqual(again.discoveredDepositIds, [])
    assert.deepEqual(again.reobservedDepositIds, [])
    assert.equal(deposits.list().length, 1)
    await reopened.close()
  })
})

test('shallow reorg invalidates the old inclusion and re-observes it on the replacement block', async () => {
  await withWatcher(async (_cursorDirectory, deposits, rpc, watcher) => {
    const first = await watcher.pollOnce()
    assert.deepEqual(first.discoveredDepositIds, [depositId])
    const oldHash = deposits.get(depositId)?.blockHash

    const replacementHash = rpc.reorgFrom(2, 'r')
    const recovered = await watcher.pollOnce()
    assert.deepEqual(recovered.invalidatedDepositIds, [depositId])
    assert.deepEqual(recovered.reobservedDepositIds, [depositId])
    assert.equal(recovered.commonAncestorHeight, 1)
    assert.equal(deposits.get(depositId)?.state, 'confirmed')
    assert.equal(deposits.get(depositId)?.blockHash, replacementHash)
    assert.notEqual(replacementHash, oldHash)
  })
})

test('shallow reorg that permanently removes a confirmed deposit freezes the L2 chain', async () => {
  await withWatcher(async (_cursorDirectory, _deposits, rpc, watcher, l2Directory) => {
    await watcher.pollOnce()

    rpc.reorgFrom(2, 'r')
    rpc.setBlock(2, rpc.activeHashes.get(2)!, [])
    const report = await watcher.pollOnce()
    assert.deepEqual(report.invalidatedDepositIds, [depositId])
    assert.deepEqual(report.reobservedDepositIds, [])

    const gate = await readDepositRecoveryGate(l2Directory)
    assert.ok(gate)
    assert.equal(gate.status, 'frozen')
    assert.match(gate.reason, /invalidated and not re-included/)
    assert.deepEqual(gate.involvedDepositIds, [depositId])
  }, { freezeChain: true })
})

test('freeze retries persisted invalidations after a gate-write failure', async () => {
  await withWatcher(async (_cursorDirectory, _deposits, rpc, watcher, l2Directory) => {
    await watcher.pollOnce()

    rpc.reorgFrom(2, 'r')
    rpc.setBlock(2, rpc.activeHashes.get(2)!, [])
    await rm(l2Directory, { recursive: true, force: true })
    await assert.rejects(watcher.pollOnce())
    assert.equal(await readDepositRecoveryGate(l2Directory), undefined)

    await mkdir(l2Directory)
    await watcher.pollOnce()
    const gate = await readDepositRecoveryGate(l2Directory)
    assert.ok(gate)
    assert.equal(gate.status, 'frozen')
    assert.deepEqual(gate.involvedDepositIds, [depositId])
  }, { freezeChain: true })
})

test('reorg deeper than retained history fails closed and durably freezes the L2 chain', async () => {
  await withWatcher(async (cursorDirectory, deposits, rpc, watcher, l2Directory) => {
    await watcher.pollOnce()
    const oldHash = deposits.get(depositId)?.blockHash
    const cursorBefore = await readFile(join(cursorDirectory, 'deposit-watch.json'), 'utf8')
    rpc.reorgFrom(1, 'd')

    await assert.rejects(
      watcher.pollOnce(),
      (error: unknown) => error instanceof BtcsL1DepositWatcherDeepReorgError,
    )
    const cursorAfter = await readFile(join(cursorDirectory, 'deposit-watch.json'), 'utf8')
    assert.equal(cursorAfter, cursorBefore)
    assert.equal(deposits.get(depositId)?.state, 'confirmed')
    assert.equal(deposits.get(depositId)?.blockHash, oldHash)

    const gate = await readDepositRecoveryGate(l2Directory)
    assert.ok(gate)
    assert.equal(gate.status, 'frozen')
    assert.match(gate.reason, /diverged deeper/)
    assert.deepEqual(gate.involvedDepositIds, [depositId])
  }, { reorgWindowBlocks: 1, freezeChain: true })
})

test('transient RPC failures preserve the last completed cursor and confirmed deposit', async () => {
  await withWatcher(async (_cursorDirectory, deposits, rpc, watcher) => {
    await watcher.pollOnce()
    const before = deposits.get(depositId)
    const cursorHeight = watcher['cursor'].cursorHeight
    rpc.failNextBlockHeader = true

    await assert.rejects(watcher.pollOnce(), /temporary RPC failure/)
    assert.equal(watcher['cursor'].cursorHeight, cursorHeight)
    assert.deepEqual(deposits.get(depositId), before)
  })
})

test('a second watcher cannot open the same cursor until the first watcher closes', async () => {
  await withWatcher(async (cursorDirectory, deposits, rpc, watcher) => {
    await assert.rejects(
      BtcsL1DepositWatcher.open({
        rpc,
        deposits,
        cursorDirectory,
        depositScriptPubKeyHex,
        requiredConfirmations,
        startHeight: 1,
      }),
      /timed out waiting for chain directory lock/,
    )
    await watcher.close()
    const reopened = await BtcsL1DepositWatcher.open({
      rpc,
      deposits,
      cursorDirectory,
      depositScriptPubKeyHex,
      requiredConfirmations,
      startHeight: 1,
    })
    await reopened.close()
  })
})

test('a second cursor cannot race writes to the same deposit store', async () => {
  await withWatcher(async (cursorDirectory, deposits, rpc, watcher) => {
    const secondCursorDirectory = join(cursorDirectory, 'second-watcher')
    await assert.rejects(
      BtcsL1DepositWatcher.create({
        rpc,
        deposits,
        cursorDirectory: secondCursorDirectory,
        depositScriptPubKeyHex,
        requiredConfirmations,
        startHeight: 1,
      }),
      /timed out waiting for chain directory lock/,
    )
    await watcher.close()
    const reopened = await BtcsL1DepositWatcher.create({
      rpc,
      deposits,
      cursorDirectory: secondCursorDirectory,
      depositScriptPubKeyHex,
      requiredConfirmations,
      startHeight: 1,
    })
    await reopened.close()
  })
})

test('watcher refuses non-regtest Core and releases the cursor lock after initialization failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-deposit-watcher-network-'))
  try {
    const deposits = await BtcsL1DepositStore.create(join(directory, 'deposits'))
    const rpc = new FakeCoreRpc()
    const wrongNetwork: BtcsL1DepositWatcherRpc = {
      ...rpc,
      async getBlockchainInfo() { return { chain: 'main', blocks: 3 } },
      async getBlockHash(height) { return rpc.getBlockHash(height) },
      async getBlock(blockHash) { return rpc.getBlock(blockHash) },
      async getRawTransaction(requestedTxid, blockHash) {
        return rpc.getRawTransaction(requestedTxid, blockHash)
      },
      async getBlockHeader(blockHash) { return rpc.getBlockHeader(blockHash) },
    }
    const cursorDirectory = join(directory, 'cursor')
    await assert.rejects(
      BtcsL1DepositWatcher.create({
        rpc: wrongNetwork,
        deposits,
        cursorDirectory,
        depositScriptPubKeyHex,
        requiredConfirmations,
        startHeight: 1,
      }),
      /requires chain=regtest/,
    )
    const watcher = await BtcsL1DepositWatcher.create({
      rpc,
      deposits,
      cursorDirectory,
      depositScriptPubKeyHex,
      requiredConfirmations,
      startHeight: 1,
    })
    await watcher.close()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

