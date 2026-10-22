import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { WithdrawalService } from '../src/withdrawalService.js'
import { L1PayoutAdapter } from '../src/l1PayoutAdapter.js'
import { computeWithdrawalId } from '../src/withdrawal.js'

test('withdrawal lifecycle: full flow states', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create({
      dataDir: dir,
      requiredConfirmations: 1,
      operatorAuthorized: true,
      chainId: 'regtest',
    })
    
    const req = {
      version: 1,
      l2From: '0x1111111111111111111111111111111111111111',
      l1To: 'bcrt1qtest123456789012345678901234567890123456',
      amountWei: 1000000000000000000n,
      nonce: 1n,
    }
    
    const state = await service.requestWithdrawal(req, 'user1')
    assert.equal(state.status, 'reserved')
    assert.equal(state.reservedAmount, 1000000000000000000n)
    assert.ok(state.auditLog.length >= 3)
    
    const authorized = await service.authorizeWithdrawal(state.id, 'operator1', 'approved for test')
    assert.equal(authorized.status, 'authorized')
    assert.equal(authorized.authorizedBy, 'operator1')
    
    const prepared = await service.preparePayout(state.id, 'operator1')
    assert.equal(prepared.status, 'payout_prepared')
    
    const broadcast = await service.broadcastPayout(state.id, 'a'.repeat(64), 'operator1')
    assert.equal(broadcast.status, 'payout_broadcast')
    assert.equal(broadcast.payoutTxid, 'a'.repeat(64))
    
    const confirmed = await service.confirmPayout(state.id, 1, 'operator1')
    assert.equal(confirmed.status, 'completed')
    assert.equal(service.getReservedBalance(req.l2From), 0n)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: prevents duplicate requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create({
      dataDir: dir,
      requiredConfirmations: 1,
      operatorAuthorized: true,
      chainId: 'regtest',
    })
    
    const req = {
      version: 1,
      l2From: '0x1111111111111111111111111111111111111111',
      l1To: 'bcrt1qtest123456789012345678901234567890123456',
      amountWei: 1000000000000000000n,
      nonce: 1n,
    }
    
    await service.requestWithdrawal(req, 'user1')
    await assert.rejects(service.requestWithdrawal(req, 'user1'), /already exists/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: prevents double payout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create({
      dataDir: dir,
      requiredConfirmations: 1,
      operatorAuthorized: true,
      chainId: 'regtest',
    })
    
    const req1 = {
      version: 1,
      l2From: '0x1111111111111111111111111111111111111111',
      l1To: 'bcrt1qtest123456789012345678901234567890123456',
      amountWei: 1000000000000000000n,
      nonce: 1n,
    }
    const req2 = {
      version: 1,
      l2From: '0x2222222222222222222222222222222222222222',
      l1To: 'bcrt1qtest123456789012345678901234567890123457',
      amountWei: 500000000000000000n,
      nonce: 1n,
    }
    
    const s1 = await service.requestWithdrawal(req1, 'user1')
    await service.authorizeWithdrawal(s1.id, 'op', 'ok')
    await service.preparePayout(s1.id, 'op')
    await service.broadcastPayout(s1.id, 'b'.repeat(64), 'op')
    
    const s2 = await service.requestWithdrawal(req2, 'user2')
    await service.authorizeWithdrawal(s2.id, 'op', 'ok')
    await service.preparePayout(s2.id, 'op')
    await assert.rejects(service.broadcastPayout(s2.id, 'b'.repeat(64), 'op'), /already used/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: cannot authorize without operator', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create({
      dataDir: dir,
      requiredConfirmations: 1,
      operatorAuthorized: false,
      chainId: 'regtest',
    })
    
    const req = {
      version: 1,
      l2From: '0x1111111111111111111111111111111111111111',
      l1To: 'bcrt1qtest123456789012345678901234567890123456',
      amountWei: 1000000000000000000n,
      nonce: 1n,
    }
    
    const state = await service.requestWithdrawal(req, 'user1')
    await assert.rejects(service.authorizeWithdrawal(state.id, 'op', 'ok'), /operator not authorized/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: restart recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create({
      dataDir: dir,
      requiredConfirmations: 1,
      operatorAuthorized: true,
      chainId: 'regtest',
    })
    
    const req = {
      version: 1,
      l2From: '0x1111111111111111111111111111111111111111',
      l1To: 'bcrt1qtest123456789012345678901234567890123456',
      amountWei: 1000000000000000000n,
      nonce: 1n,
    }
    
    const state = await service.requestWithdrawal(req, 'user1')
    await service.authorizeWithdrawal(state.id, 'op', 'ok')
    await service.preparePayout(state.id, 'op')
    await service.broadcastPayout(state.id, 'c'.repeat(64), 'op')
    
    // Simulate restart
    const service2 = await WithdrawalService.create({
      dataDir: dir,
      requiredConfirmations: 1,
      operatorAuthorized: true,
      chainId: 'regtest',
    })
    
    const recovered = service2.getWithdrawal(state.id)
    assert.ok(recovered)
    assert.equal(recovered!.status, 'payout_broadcast')
    assert.equal(recovered!.payoutTxid, 'c'.repeat(64))
    assert.equal(service2.getReservedBalance(req.l2From), 1000000000000000000n)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: reconciliation on ambiguity', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create({
      dataDir: dir,
      requiredConfirmations: 1,
      operatorAuthorized: true,
      chainId: 'regtest',
    })
    
    const req = {
      version: 1,
      l2From: '0x1111111111111111111111111111111111111111',
      l1To: 'bcrt1qtest123456789012345678901234567890123456',
      amountWei: 1000000000000000000n,
      nonce: 1n,
    }
    
    const state = await service.requestWithdrawal(req, 'user1')
    await service.authorizeWithdrawal(state.id, 'op', 'ok')
    await service.preparePayout(state.id, 'op')
    await service.broadcastPayout(state.id, 'd'.repeat(64), 'op')
    
    const reconciled = await service.reconcile(state.id, 'operator', 'reorg ambiguity')
    assert.equal(reconciled.status, 'reconciliation')
    assert.ok(reconciled.error)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('l1 payout adapter: disabled by default', () => {
  const adapter = L1PayoutAdapter.createDisabled()
  assert.equal(adapter.isEnabled(), false)
})

test('l1 payout adapter: refuses wrong chain', async () => {
  const adapter = new L1PayoutAdapter({ enabled: true, chainId: 'regtest', maxAmountSats: 1000000n })
  const mockRpc: any = {
    getBlockchainInfo: async () => ({ chain: 'main', blocks: 100 })
  }
  await assert.rejects(adapter.validateChain(mockRpc), /Wrong chain/)
})
