import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  WithdrawalService,
  type WithdrawalServiceConfig,
} from '../src/withdrawalService.js'
import { L1PayoutAdapter } from '../src/l1PayoutAdapter.js'

const TEN_FUNDED = 10n ** 30n

function testConfig(
  dataDir: string,
  overrides: Partial<WithdrawalServiceConfig> = {},
): WithdrawalServiceConfig {
  return {
    dataDir,
    requiredConfirmations: 1,
    operatorAuthorized: true,
    chainId: 'regtest',
    balanceReader: async () => TEN_FUNDED,
    payoutConfirmationReader: async (txid) => ({ txid, confirmations: 1 }),
    payoutsEnabled: true,
    ...overrides,
  }
}

function request(
  overrides: Partial<{
    l2From: string
    l1To: string
    amountWei: bigint
    nonce: bigint
  }> = {},
) {
  return {
    version: 1,
    l2From: '0x1111111111111111111111111111111111111111',
    l1To: 'bcrt1qtest123456789012345678901234567890123456',
    amountWei: 1_000_000_000_000_000_000n,
    nonce: 1n,
    ...overrides,
  }
}

test('withdrawal lifecycle: full flow states', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(testConfig(dir))
    const req = request()

    const state = await service.requestWithdrawal(req, 'user1')
    assert.equal(state.status, 'reserved')
    assert.equal(state.reservedAmount, req.amountWei)
    assert.ok(state.auditLog.length >= 3)

    const authorized = await service.authorizeWithdrawal(state.id, 'operator1', 'approved for test')
    assert.equal(authorized.status, 'authorized')
    assert.equal(authorized.authorizedBy, 'operator1')

    const prepared = await service.preparePayout(state.id, 'operator1')
    assert.equal(prepared.status, 'payout_prepared')

    const broadcast = await service.broadcastPayout(state.id, 'a'.repeat(64), 'operator1')
    assert.equal(broadcast.status, 'payout_broadcast')
    assert.equal(broadcast.payoutTxid, 'a'.repeat(64))

    const confirmed = await service.confirmPayout(state.id, 'operator1')
    assert.equal(confirmed.status, 'completed')
    assert.equal(service.getReservedBalance(req.l2From), 0n)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: prevents duplicate requests', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(testConfig(dir))
    const req = request()
    await service.requestWithdrawal(req, 'user1')
    await assert.rejects(service.requestWithdrawal(req, 'user1'), /already exists/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: prevents double payout', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(testConfig(dir))
    const req1 = request()
    const req2 = request({
      l2From: '0x2222222222222222222222222222222222222222',
      l1To: 'bcrt1qtest123456789012345678901234567890123457',
      amountWei: 500_000_000_000_000_000n,
    })

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
    const service = await WithdrawalService.create(
      testConfig(dir, { operatorAuthorized: false }),
    )
    const state = await service.requestWithdrawal(request(), 'user1')
    await assert.rejects(
      service.authorizeWithdrawal(state.id, 'op', 'ok'),
      /operator not authorized/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: restart recovery', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(testConfig(dir))
    const req = request()

    const state = await service.requestWithdrawal(req, 'user1')
    await service.authorizeWithdrawal(state.id, 'op', 'ok')
    await service.preparePayout(state.id, 'op')
    await service.broadcastPayout(state.id, 'c'.repeat(64), 'op')

    const service2 = await WithdrawalService.create(testConfig(dir))
    const recovered = service2.getWithdrawal(state.id)
    assert.ok(recovered)
    assert.equal(recovered.status, 'payout_broadcast')
    assert.equal(recovered.payoutTxid, 'c'.repeat(64))
    assert.equal(service2.getReservedBalance(req.l2From), req.amountWei)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: reconciliation on ambiguity keeps the reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(testConfig(dir))
    const req = request()

    const state = await service.requestWithdrawal(req, 'user1')
    await service.authorizeWithdrawal(state.id, 'op', 'ok')
    await service.preparePayout(state.id, 'op')
    await service.broadcastPayout(state.id, 'd'.repeat(64), 'op')

    const reconciled = await service.reconcile(state.id, 'operator', 'reorg ambiguity')
    assert.equal(reconciled.status, 'reconciliation')
    assert.ok(reconciled.error)
    assert.equal(service.getReservedBalance(req.l2From), req.amountWei)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: payout actions are disabled by default', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(
      testConfig(dir, { payoutsEnabled: false }),
    )
    const state = await service.requestWithdrawal(request(), 'user1')
    await service.authorizeWithdrawal(state.id, 'op', 'ok')
    await assert.rejects(service.preparePayout(state.id, 'op'), /payouts are disabled/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: rejects an unfunded request and double reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    let balance = 500n
    const service = await WithdrawalService.create(
      testConfig(dir, { balanceReader: async () => balance }),
    )

    await assert.rejects(
      service.requestWithdrawal(request({ amountWei: 600n }), 'user1'),
      /insufficient L2 balance/,
    )
    assert.equal(service.getReservedBalance(request().l2From), 0n)

    await service.requestWithdrawal(request({ amountWei: 500n }), 'user1')
    assert.equal(service.getReservedBalance(request().l2From), 500n)

    balance = 600n
    await assert.rejects(
      service.requestWithdrawal(request({ amountWei: 200n, nonce: 2n }), 'user1'),
      /insufficient L2 balance/,
    )
    assert.equal(service.getReservedBalance(request().l2From), 500n)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: does not complete below the payout confirmation target', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    let observedConfirmations = 1
    const service = await WithdrawalService.create(
      testConfig(dir, {
        requiredConfirmations: 3,
        payoutConfirmationReader: async (txid) => ({
          txid,
          confirmations: observedConfirmations,
        }),
      }),
    )
    const req = request()
    const state = await service.requestWithdrawal(req, 'user1')
    await service.authorizeWithdrawal(state.id, 'op', 'ok')
    await service.preparePayout(state.id, 'op')
    await service.broadcastPayout(state.id, 'e'.repeat(64), 'op')

    const pending = await service.confirmPayout(state.id, 'op')
    assert.equal(pending.status, 'payout_broadcast')
    assert.equal(pending.confirmations, 1)
    assert.equal(service.getReservedBalance(req.l2From), req.amountWei)

    observedConfirmations = 3
    const completed = await service.confirmPayout(state.id, 'op')
    assert.equal(completed.status, 'completed')
    assert.equal(service.getReservedBalance(req.l2From), 0n)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: rejects an active record with a mismatched reservation', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(testConfig(dir))
    await service.requestWithdrawal(request(), 'user1')

    const path = join(dir, 'withdrawals.json')
    const stored = JSON.parse(await readFile(path, 'utf8')) as {
      withdrawals: Array<{ reservedAmount: string }>
      reservations: unknown[]
    }
    stored.withdrawals[0]!.reservedAmount = '0'
    stored.reservations = []
    await writeFile(path, JSON.stringify(stored))

    await assert.rejects(
      WithdrawalService.create(testConfig(dir)),
      /active status has a reserved amount/,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('withdrawal lifecycle: fails closed on a corrupt store', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'withdrawal-'))
  try {
    const service = await WithdrawalService.create(testConfig(dir))
    await service.requestWithdrawal(request(), 'user1')
    await writeFile(join(dir, 'withdrawals.json'), '{not-json')
    await assert.rejects(
      WithdrawalService.create(testConfig(dir)),
      /invalid JSON/,
    )
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
    getBlockchainInfo: async () => ({ chain: 'main', blocks: 100 }),
  }
  await assert.rejects(adapter.validateChain(mockRpc), /Wrong chain/)
})
