import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProtocolError } from './blockProcessor.js'
import { computeWithdrawalId, validateWithdrawalRequest, type WithdrawalRequest } from './withdrawal.js'

export type WithdrawalStatus =
  | 'requested'
  | 'validated'
  | 'reserved'
  | 'authorized'
  | 'payout_prepared'
  | 'payout_broadcast'
  | 'payout_confirmed'
  | 'completed'
  | 'rejected'
  | 'cancelled'
  | 'expired'
  | 'reconciliation'

export type WithdrawalState = Readonly<{
  id: string
  request: WithdrawalRequest
  status: WithdrawalStatus
  reservedAmount: bigint
  reservedAt?: number
  authorizedAt?: number
  authorizedBy?: string
  authorizationNote?: string
  payoutTxid?: string
  payoutPreparedAt?: number
  payoutBroadcastAt?: number
  payoutConfirmedAt?: number
  completedAt?: number
  confirmations?: number
  requiredConfirmations: number
  error?: string
  auditLog: readonly AuditEntry[]
  createdAt: number
  updatedAt: number
}>

export type AuditEntry = Readonly<{
  timestamp: number
  action: string
  actor: string
  details: string
}>

export type WithdrawalServiceConfig = Readonly<{
  dataDir: string
  requiredConfirmations: number
  operatorAuthorized: boolean
  chainId: 'regtest'
}>

export class WithdrawalService {
  private withdrawals = new Map<string, WithdrawalState>()
  private balanceReservations = new Map<string, bigint>() // address -> reserved amount
  private config: WithdrawalServiceConfig
  private dataFile: string

  constructor(config: WithdrawalServiceConfig) {
    this.config = config
    this.dataFile = join(config.dataDir, 'withdrawals.json')
  }

  static async create(config: WithdrawalServiceConfig): Promise<WithdrawalService> {
    await mkdir(config.dataDir, { recursive: true })
    const service = new WithdrawalService(config)
    await service.load()
    return service
  }

  private async load(): Promise<void> {
    try {
      const data = await readFile(this.dataFile, 'utf8')
      const parsed = JSON.parse(data)
      for (const w of parsed.withdrawals || []) {
        this.withdrawals.set(w.id, {
          ...w,
          reservedAmount: BigInt(w.reservedAmount),
          request: { ...w.request, amountWei: BigInt(w.request.amountWei), nonce: BigInt(w.request.nonce) },
        })
      }
      for (const [addr, amt] of parsed.reservations || []) {
        this.balanceReservations.set(addr, BigInt(amt))
      }
    } catch {
      // Start fresh if no data
    }
  }

  private async save(): Promise<void> {
    const data = {
      withdrawals: Array.from(this.withdrawals.values()).map(w => ({
        ...w,
        reservedAmount: w.reservedAmount.toString(),
        request: { ...w.request, amountWei: w.request.amountWei.toString(), nonce: w.request.nonce.toString() },
      })),
      reservations: Array.from(this.balanceReservations.entries()).map(([k, v]) => [k, v.toString()]),
    }
    await writeFile(this.dataFile, JSON.stringify(data, null, 2))
  }

  private addAudit(state: WithdrawalState, action: string, actor: string, details: string): WithdrawalState {
    const entry: AuditEntry = { timestamp: Date.now(), action, actor, details }
    return { ...state, auditLog: [...state.auditLog, entry], updatedAt: Date.now() }
  }

  async requestWithdrawal(request: unknown, actor: string): Promise<WithdrawalState> {
    const validated = validateWithdrawalRequest(request)
    const id = computeWithdrawalId(validated)
    
    if (this.withdrawals.has(id)) {
      throw new ProtocolError('withdrawal request already exists')
    }

    let state: WithdrawalState = {
      id,
      request: validated,
      status: 'requested',
      reservedAmount: 0n,
      requiredConfirmations: this.config.requiredConfirmations,
      auditLog: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    
    state = this.addAudit(state, 'requested', actor, `Withdrawal requested for ${validated.amountWei} wei to ${validated.l1To}`)
    state = { ...state, status: 'validated' }
    state = this.addAudit(state, 'validated', actor, 'Request validated')
    
    // Reserve funds
    const currentReserved = this.balanceReservations.get(validated.l2From) || 0n
    this.balanceReservations.set(validated.l2From, currentReserved + validated.amountWei)
    state = { ...state, status: 'reserved', reservedAmount: validated.amountWei, reservedAt: Date.now() }
    state = this.addAudit(state, 'reserved', actor, `Reserved ${validated.amountWei} wei`)
    
    this.withdrawals.set(id, state)
    await this.save()
    return state
  }

  async authorizeWithdrawal(id: string, actor: string, note: string): Promise<WithdrawalState> {
    if (!this.config.operatorAuthorized) {
      throw new ProtocolError('operator not authorized')
    }
    
    let state = this.withdrawals.get(id)
    if (!state) throw new ProtocolError('withdrawal not found')
    if (state.status !== 'reserved') throw new ProtocolError(`cannot authorize from status ${state.status}`)
    
    state = this.addAudit(state, 'authorized', actor, `Authorized by operator: ${note}`)
    state = { ...state, status: 'authorized', authorizedAt: Date.now(), authorizedBy: actor, authorizationNote: note }
    
    this.withdrawals.set(id, state)
    await this.save()
    return state
  }

  async preparePayout(id: string, actor: string): Promise<WithdrawalState> {
    let state = this.withdrawals.get(id)
    if (!state) throw new ProtocolError('withdrawal not found')
    if (state.status !== 'authorized') throw new ProtocolError(`cannot prepare from status ${state.status}`)
    
    state = this.addAudit(state, 'payout_prepared', actor, 'Payout prepared for broadcast')
    state = { ...state, status: 'payout_prepared', payoutPreparedAt: Date.now() }
    
    this.withdrawals.set(id, state)
    await this.save()
    return state
  }

  async broadcastPayout(id: string, payoutTxid: string, actor: string): Promise<WithdrawalState> {
    let state = this.withdrawals.get(id)
    if (!state) throw new ProtocolError('withdrawal not found')
    if (state.status !== 'payout_prepared') throw new ProtocolError(`cannot broadcast from status ${state.status}`)
    if (!/^[0-9a-f]{64}$/.test(payoutTxid)) throw new ProtocolError('invalid txid')
    
    // Check if this txid already used
    for (const [wid, w] of this.withdrawals.entries()) {
      if (wid !== id && w.payoutTxid === payoutTxid) {
        throw new ProtocolError('payout txid already used')
      }
    }
    
    state = this.addAudit(state, 'payout_broadcast', actor, `Broadcast payout tx ${payoutTxid}`)
    state = { ...state, status: 'payout_broadcast', payoutTxid, payoutBroadcastAt: Date.now() }
    
    this.withdrawals.set(id, state)
    await this.save()
    return state
  }

  async confirmPayout(id: string, confirmations: number, actor: string): Promise<WithdrawalState> {
    let state = this.withdrawals.get(id)
    if (!state) throw new ProtocolError('withdrawal not found')
    if (state.status !== 'payout_broadcast' && state.status !== 'payout_confirmed') {
      throw new ProtocolError(`cannot confirm from status ${state.status}`)
    }
    
    state = { ...state, confirmations }
    
    if (confirmations >= state.requiredConfirmations && state.status !== 'completed') {
      state = this.addAudit(state, 'payout_confirmed', actor, `Payout confirmed with ${confirmations} confirmations`)
      state = { ...state, status: 'payout_confirmed', payoutConfirmedAt: Date.now() }
      state = this.addAudit(state, 'completed', actor, 'Withdrawal completed')
      state = { ...state, status: 'completed', completedAt: Date.now() }
      // Release reservation
      const currentReserved = this.balanceReservations.get(state.request.l2From) || 0n
      this.balanceReservations.set(state.request.l2From, currentReserved - state.reservedAmount)
    }
    
    this.withdrawals.set(id, state)
    await this.save()
    return state
  }

  async reconcile(id: string, actor: string, reason: string): Promise<WithdrawalState> {
    let state = this.withdrawals.get(id)
    if (!state) throw new ProtocolError('withdrawal not found')
    
    state = this.addAudit(state, 'reconciliation', actor, reason)
    state = { ...state, status: 'reconciliation', error: reason }
    
    this.withdrawals.set(id, state)
    await this.save()
    return state
  }

  getWithdrawal(id: string): WithdrawalState | undefined {
    return this.withdrawals.get(id)
  }

  listWithdrawals(): readonly WithdrawalState[] {
    return Array.from(this.withdrawals.values())
  }

  getReservedBalance(address: string): bigint {
    return this.balanceReservations.get(address.toLowerCase()) || 0n
  }

  async restartRecovery(): Promise<{ recovered: number; reconciled: number }> {
    let recovered = 0
    let reconciled = 0
    for (const [id, state] of this.withdrawals.entries()) {
      if (state.status === 'payout_broadcast' && !state.payoutConfirmedAt) {
        // Mark for reconciliation check on restart
        let newState = this.addAudit(state, 'restart_recovery', 'system', 'Recovered pending payout after restart')
        this.withdrawals.set(id, newState)
        recovered++
      }
    }
    await this.save()
    return { recovered, reconciled }
  }
}
