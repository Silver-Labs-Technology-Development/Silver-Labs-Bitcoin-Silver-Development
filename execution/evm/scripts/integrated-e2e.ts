#!/usr/bin/env node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PersistentBlockProcessor } from '../src/blockProcessor.js'
import { createEvmSettlementEnvelope, ZERO_COMMITMENT } from '../src/settlementEnvelope.js'
import { createEvmSettlementBatch } from '../src/settlementBatch.js'
import { encodeBtcsL1BatchData, reconstructEvmSettlementBatchFromScripts } from '../src/btcsL1BatchData.js'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import { WithdrawalService } from '../src/withdrawalService.js'
import { L1PayoutAdapter } from '../src/l1PayoutAdapter.js'

const ZERO_HASH = `0x${'0'.repeat(64)}`
const ANCHORS = {
  previousCommitment: ZERO_COMMITMENT,
  parentHash: ZERO_HASH,
  startHeight: '0',
}

async function main() {
  console.log('=== BTCS L2 Integrated E2E (Trusted Single-Operator Model) ===')
  const logs: string[] = []
  const log = (msg: string) => { console.log(msg); logs.push(msg) }
  
  log('1. Creating isolated L2 chain...')
  const chainDir = await mkdtemp(join(tmpdir(), 'btcs-l2-e2e-'))
  const processor = await PersistentBlockProcessor.open(join(chainDir, 'chain'))
  
  log('2. L2 execution - building blocks...')
  const view0 = await processor.createCanonicalReadView()
  const genesis = view0.getCanonicalBlockByNumber(0n)
  if (!genesis) throw new Error('no genesis')
  const GENESIS_TIMESTAMP = BigInt((genesis as any).block?.header?.timestamp ?? (genesis as any).summary?.timestamp ?? 1000000n)
  await processor.buildNextBlock([], GENESIS_TIMESTAMP + 1n)
  await processor.buildNextBlock([], GENESIS_TIMESTAMP + 2n)
  const view1 = await processor.createCanonicalReadView()
  log(`   Canonical view loaded`)
  
  log('3. Settlement - creating batch...')
  const g = view1.getCanonicalBlockByNumber(0n)!
  const b1 = view1.getCanonicalBlockByNumber(1n)!
  const b2 = view1.getCanonicalBlockByNumber(2n)!
  const e0 = createEvmSettlementEnvelope((g as any).blockRlpHex ?? (g as any).block?.blockRlpHex)
  const e1 = createEvmSettlementEnvelope((b1 as any).blockRlpHex ?? (b1 as any).block?.blockRlpHex, e0.commitmentHash)
  const e2 = createEvmSettlementEnvelope((b2 as any).blockRlpHex ?? (b2 as any).block?.blockRlpHex, e1.commitmentHash)
  const batch = createEvmSettlementBatch([e0, e1, e2])
  log(`   Batch hash: ${batch.batchHash}`)
  
  log('4. Publishing batch data (L1 simulation)...')
  const encoded = await encodeBtcsL1BatchData(batch, ANCHORS)
  const anchorScript = encodeBtcsL1AnchorScript(batch.batchHash)
  const fragmentScripts = encoded.fragments.map(f => f.scriptPubKeyHex)
  log(`   Fragments: ${encoded.fragments.length}`)
  
  log('5. Clean-node reconstruction...')
  const recovered = await reconstructEvmSettlementBatchFromScripts([anchorScript, ...fragmentScripts], batch.batchHash, ANCHORS)
  if (recovered.batch.batchHash !== batch.batchHash) throw new Error('reconstruction mismatch')
  if (recovered.serializedBatch.toString() !== encoded.serializedBatch.toString()) throw new Error('data mismatch')
  log('   Reconstruction verified')
  
  log('6. Withdrawal request...')
  const wdDir = await mkdtemp(join(tmpdir(), 'btcs-withdrawal-'))
  const service = await WithdrawalService.create({
    dataDir: wdDir,
    requiredConfirmations: 1,
    operatorAuthorized: true,
    chainId: 'regtest',
    balanceReader: async () => 10n ** 30n,
    payoutConfirmationReader: async (txid) => ({ txid, confirmations: 1 }),
    payoutsEnabled: true,
  })
  
  const req = {
    version: 1,
    l2From: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    l1To: 'bcrt1qtest123456789012345678901234567890123456',
    amountWei: 500000000000000000n,
    nonce: 42n,
  }
  
  const w1 = await service.requestWithdrawal(req, 'user')
  log(`   Withdrawal ID: ${w1.id}`)
  log(`   Status: ${w1.status}`)
  log(`   Reserved: ${w1.reservedAmount}`)
  
  log('7. Operator authorization...')
  const w2 = await service.authorizeWithdrawal(w1.id, 'operator', 'approved for regtest demo')
  log(`   Status: ${w2.status}, authorized by: ${w2.authorizedBy}`)
  
  log('8. Payout preparation and broadcast (regtest adapter disabled by default)...')
  const adapter = L1PayoutAdapter.createDisabled()
  log(`   Adapter enabled: ${adapter.isEnabled()}`)
  const w3 = await service.preparePayout(w1.id, 'operator')
  log(`   Status: ${w3.status}`)
  // Simulate broadcast without actual L1 tx
  const w4 = await service.broadcastPayout(w1.id, 'e'.repeat(64), 'operator')
  log(`   Status: ${w4.status}, txid: ${w4.payoutTxid}`)
  
  log('9. Payout confirmation...')
  const w5 = await service.confirmPayout(w1.id, 'operator')
  log(`   Status: ${w5.status}`)
  log(`   Reserved balance: ${service.getReservedBalance(req.l2From)}`)
  
  log('10. Restart and recovery...')
  const service2 = await WithdrawalService.create({
    dataDir: wdDir,
    requiredConfirmations: 1,
    operatorAuthorized: true,
    chainId: 'regtest',
    balanceReader: async () => 10n ** 30n,
    payoutConfirmationReader: async (txid) => ({ txid, confirmations: 1 }),
    payoutsEnabled: true,
  })
  const w6 = service2.getWithdrawal(w1.id)
  log(`   Recovered status: ${w6?.status}`)
  log(`   Recovered txid: ${w6?.payoutTxid}`)
  
  log('11. Duplicate prevention...')
  try {
    await service2.requestWithdrawal(req, 'user')
    log('   ERROR: duplicate not prevented')
    process.exit(1)
  } catch {
    log('   Duplicate request correctly rejected')
  }
  
  log('\n=== ALL STEPS COMPLETED ===')
  log('Model: Trusted single-operator (interim)')
  log('L1 payout adapter: DISABLED (safe default)')
  
  await rm(chainDir, { recursive: true, force: true })
  await rm(wdDir, { recursive: true, force: true })
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1) })
