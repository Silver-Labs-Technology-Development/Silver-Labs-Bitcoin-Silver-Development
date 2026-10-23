import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
} from 'node:fs/promises'
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
  /** Trusted read of the address's spendable L2 balance. */
  balanceReader: (address: string) => Promise<bigint>
  /** Trusted L1 payout confirmation lookup. Never accept a caller-supplied count. */
  payoutConfirmationReader: (
    payoutTxid: string,
    requiredConfirmations: number,
  ) => Promise<Readonly<{ txid: string; confirmations: number }>>
  /** Payout actions remain disabled unless explicitly constructed for a test/regtest run. */
  payoutsEnabled?: boolean
}>

const ACTIVE_RESERVATION_STATUSES = new Set<WithdrawalStatus>([
  'reserved',
  'authorized',
  'payout_prepared',
  'payout_broadcast',
  'payout_confirmed',
  'reconciliation',
])

const TXID_RE = /^[0-9a-f]{64}$/
const MAX_STORE_BYTES = 16 * 1024 * 1024

function cloneState(state: WithdrawalState): WithdrawalState {
  return {
    ...state,
    request: { ...state.request },
    auditLog: state.auditLog.map((entry) => ({ ...entry })),
  }
}

function parseBigInt(value: unknown, label: string): bigint {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new ProtocolError(`${label} must be an integer string`)
  }
  if (typeof value === 'number' && !Number.isSafeInteger(value)) {
    throw new ProtocolError(`${label} must be a safe integer or integer string`)
  }
  try {
    const parsed = BigInt(value)
    if (parsed < 0n) throw new Error('negative')
    return parsed
  } catch {
    throw new ProtocolError(`${label} must be a non-negative integer`)
  }
}

function validateStoredState(value: unknown): WithdrawalState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('withdrawal record must be an object')
  }
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || !TXID_RE.test(record.id)) {
    throw new ProtocolError('withdrawal record has an invalid id')
  }
  if (typeof record.request !== 'object' || record.request === null) {
    throw new ProtocolError('withdrawal record has an invalid request')
  }
  const rawRequest = record.request as Record<string, unknown>
  const request: WithdrawalRequest = {
    version: Number(rawRequest.version),
    l2From: typeof rawRequest.l2From === 'string' ? rawRequest.l2From.toLowerCase() : '',
    l1To: typeof rawRequest.l1To === 'string' ? rawRequest.l1To : '',
    amountWei: parseBigInt(rawRequest.amountWei, 'withdrawal amount'),
    nonce: parseBigInt(rawRequest.nonce, 'withdrawal nonce'),
    data: typeof rawRequest.data === 'string' ? rawRequest.data : undefined,
  }
  const validated = validateWithdrawalRequest(request)
  if (computeWithdrawalId(validated) !== record.id) {
    throw new ProtocolError('withdrawal record id does not match its request')
  }

  if (typeof record.status !== 'string') {
    throw new ProtocolError('withdrawal record has an invalid status')
  }
  const status = record.status as WithdrawalStatus
  if (
    ![
      'requested',
      'validated',
      'reserved',
      'authorized',
      'payout_prepared',
      'payout_broadcast',
      'payout_confirmed',
      'completed',
      'rejected',
      'cancelled',
      'expired',
      'reconciliation',
    ].includes(status)
  ) {
    throw new ProtocolError('withdrawal record has an unknown status')
  }

  const reservedAmount = parseBigInt(record.reservedAmount, 'reserved amount')
  if (
    ACTIVE_RESERVATION_STATUSES.has(status) &&
    reservedAmount !== validated.amountWei
  ) {
    throw new ProtocolError(
      'withdrawal active status has a reserved amount that does not match its request',
    )
  }
  if (
    (status === 'requested' || status === 'validated') &&
    reservedAmount !== 0n
  ) {
    throw new ProtocolError(
      'unreserved withdrawal status cannot carry a reserved amount',
    )
  }
  if (!Array.isArray(record.auditLog)) {
    throw new ProtocolError('withdrawal record has an invalid audit log')
  }
  const auditLog = record.auditLog.map((entry) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ProtocolError('withdrawal audit entry must be an object')
    }
    const item = entry as Record<string, unknown>
    if (
      typeof item.timestamp !== 'number' ||
      typeof item.action !== 'string' ||
      typeof item.actor !== 'string' ||
      typeof item.details !== 'string'
    ) {
      throw new ProtocolError('withdrawal audit entry is malformed')
    }
    return {
      timestamp: item.timestamp,
      action: item.action,
      actor: item.actor,
      details: item.details,
    }
  })

  const requiredConfirmations = Number(record.requiredConfirmations)
  if (!Number.isSafeInteger(requiredConfirmations) || requiredConfirmations < 1) {
    throw new ProtocolError('withdrawal record has invalid required confirmations')
  }

  return {
    ...(record as unknown as WithdrawalState),
    id: record.id,
    request: validated,
    status,
    reservedAmount,
    requiredConfirmations,
    auditLog,
  }
}

export class WithdrawalService {
  private withdrawals = new Map<string, WithdrawalState>()
  private balanceReservations = new Map<string, bigint>() // lowercase address -> reserved amount
  private config: WithdrawalServiceConfig
  private dataFile: string
  private mutationQueue: Promise<void> = Promise.resolve()
  private persistenceUncertain = false

  constructor(config: WithdrawalServiceConfig) {
    if (!Number.isSafeInteger(config.requiredConfirmations) || config.requiredConfirmations < 1) {
      throw new ProtocolError('required confirmations must be a positive safe integer')
    }
    if (typeof config.balanceReader !== 'function') {
      throw new ProtocolError('withdrawal service requires a balanced L2 balance reader')
    }
    if (typeof config.payoutConfirmationReader !== 'function') {
      throw new ProtocolError('withdrawal service requires a trusted L1 payout confirmation reader')
    }
    this.config = config
    this.dataFile = join(config.dataDir, 'withdrawals.json')
  }

  static async create(config: WithdrawalServiceConfig): Promise<WithdrawalService> {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 })
    const service = new WithdrawalService(config)
    await service.load()
    return service
  }

  private async load(): Promise<void> {
    let bytes: Buffer
    try {
      const info = await lstat(this.dataFile)
      if (!info.isFile() || info.size > MAX_STORE_BYTES) {
        throw new ProtocolError('withdrawal store is not a regular file or exceeds the size limit')
      }
      bytes = await readFile(this.dataFile)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }

    if (bytes.byteLength > MAX_STORE_BYTES) {
      throw new ProtocolError('withdrawal store exceeds the size limit')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(bytes.toString('utf8'))
    } catch {
      throw new ProtocolError('withdrawal store contains invalid JSON')
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new ProtocolError('withdrawal store must be a JSON object')
    }
    const snapshot = parsed as Record<string, unknown>
    if (
      Object.keys(snapshot).some((key) => key !== 'withdrawals' && key !== 'reservations') ||
      !Array.isArray(snapshot.withdrawals) ||
      !Array.isArray(snapshot.reservations)
    ) {
      throw new ProtocolError('withdrawal store has missing or unsupported fields')
    }

    const derivedReservations = new Map<string, bigint>()
    for (const raw of snapshot.withdrawals) {
      const state = validateStoredState(raw)
      if (this.withdrawals.has(state.id)) {
        throw new ProtocolError('withdrawal store contains duplicate withdrawal ids')
      }
      this.withdrawals.set(state.id, state)
      if (ACTIVE_RESERVATION_STATUSES.has(state.status)) {
        const key = state.request.l2From.toLowerCase()
        derivedReservations.set(
          key,
          (derivedReservations.get(key) ?? 0n) + state.reservedAmount,
        )
      }
    }

    const storedReservations = new Map<string, bigint>()
    for (const entry of snapshot.reservations) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string') {
        throw new ProtocolError('withdrawal store has an invalid reservation entry')
      }
      const key = entry[0].toLowerCase()
      const amount = parseBigInt(entry[1], 'reserved balance')
      if (storedReservations.has(key)) {
        throw new ProtocolError('withdrawal store contains duplicate reservation addresses')
      }
      storedReservations.set(key, amount)
    }

    const keys = new Set([...derivedReservations.keys(), ...storedReservations.keys()])
    for (const key of keys) {
      if ((derivedReservations.get(key) ?? 0n) !== (storedReservations.get(key) ?? 0n)) {
        throw new ProtocolError('withdrawal reservation accounting does not match its records')
      }
    }
    this.balanceReservations = derivedReservations
  }

  private async save(): Promise<void> {
    const data = {
      withdrawals: Array.from(this.withdrawals.values()).map((w) => ({
        ...w,
        reservedAmount: w.reservedAmount.toString(),
        request: {
          ...w.request,
          amountWei: w.request.amountWei.toString(),
          nonce: w.request.nonce.toString(),
        },
      })),
      reservations: Array.from(this.balanceReservations.entries())
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => [k, v.toString()]),
    }
    const bytes = Buffer.from(`${JSON.stringify(data, null, 2)}\n`, 'utf8')
    if (bytes.byteLength > MAX_STORE_BYTES) {
      throw new ProtocolError('withdrawal store exceeds the size limit')
    }

    const temporary = `${this.dataFile}.${randomUUID()}.tmp`
    let handle: Awaited<ReturnType<typeof open>> | undefined
    let renamed = false
    try {
      handle = await open(temporary, 'wx', 0o600)
      await handle.writeFile(bytes)
      await handle.sync()
      await handle.close()
      handle = undefined
      await rename(temporary, this.dataFile)
      renamed = true
      const directory = await open(this.config.dataDir, 'r')
      try {
        await directory.sync()
      } finally {
        await directory.close()
      }
    } catch (error) {
      if (handle !== undefined) await handle.close().catch(() => undefined)
      if (!renamed) await unlink(temporary).catch(() => undefined)
      // Any failed write may leave memory ahead of disk. Require a restart
      // instead of risking a later write that silently commits the mutation.
      this.persistenceUncertain = true
      throw new ProtocolError(
        `withdrawal store write failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  private assertUsable(): void {
    if (this.persistenceUncertain) {
      throw new ProtocolError(
        'withdrawal store persistence outcome is uncertain; restart before continuing',
      )
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private addAudit(state: WithdrawalState, action: string, actor: string, details: string): WithdrawalState {
    const entry: AuditEntry = { timestamp: Date.now(), action, actor, details }
    return { ...state, auditLog: [...state.auditLog, entry], updatedAt: Date.now() }
  }

  async requestWithdrawal(request: unknown, actor: string): Promise<WithdrawalState> {
    return this.enqueue(async () => {
      this.assertUsable()
      const validated = validateWithdrawalRequest(request)
      const id = computeWithdrawalId(validated)

      if (this.withdrawals.has(id)) {
        throw new ProtocolError('withdrawal request already exists')
      }

      const from = validated.l2From.toLowerCase()
      const spendable = await this.config.balanceReader(from)
      if (typeof spendable !== 'bigint' || spendable < 0n) {
        throw new ProtocolError('L2 balance reader returned an invalid balance')
      }
      const currentReserved = this.balanceReservations.get(from) ?? 0n
      if (spendable < currentReserved + validated.amountWei) {
        throw new ProtocolError('insufficient L2 balance for withdrawal')
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

      this.balanceReservations.set(from, currentReserved + validated.amountWei)
      state = { ...state, status: 'reserved', reservedAmount: validated.amountWei, reservedAt: Date.now() }
      state = this.addAudit(state, 'reserved', actor, `Reserved ${validated.amountWei} wei`)

      this.withdrawals.set(id, state)
      try {
        await this.save()
      } catch (error) {
        this.withdrawals.delete(id)
        this.balanceReservations.set(from, currentReserved)
        throw error
      }
      return cloneState(state)
    })
  }

  async authorizeWithdrawal(id: string, actor: string, note: string): Promise<WithdrawalState> {
    return this.enqueue(async () => {
      this.assertUsable()
      if (!this.config.operatorAuthorized) {
        throw new ProtocolError('operator not authorized')
      }

      const state = this.withdrawals.get(id)
      if (!state) throw new ProtocolError('withdrawal not found')
      if (state.status !== 'reserved') throw new ProtocolError(`cannot authorize from status ${state.status}`)

      let next = this.addAudit(state, 'authorized', actor, `Authorized by operator: ${note}`)
      next = { ...next, status: 'authorized', authorizedAt: Date.now(), authorizedBy: actor, authorizationNote: note }

      this.withdrawals.set(id, next)
      await this.save()
      return cloneState(next)
    })
  }

  async preparePayout(id: string, actor: string): Promise<WithdrawalState> {
    return this.enqueue(async () => {
      this.assertUsable()
      if (this.config.payoutsEnabled !== true) {
        throw new ProtocolError('payouts are disabled')
      }

      const state = this.withdrawals.get(id)
      if (!state) throw new ProtocolError('withdrawal not found')
      if (state.status !== 'authorized') throw new ProtocolError(`cannot prepare from status ${state.status}`)
      if (state.reservedAmount !== state.request.amountWei) {
        throw new ProtocolError('withdrawal reservation does not match the request')
      }

      let next = this.addAudit(state, 'payout_prepared', actor, 'Payout prepared for broadcast')
      next = { ...next, status: 'payout_prepared', payoutPreparedAt: Date.now() }

      this.withdrawals.set(id, next)
      await this.save()
      return cloneState(next)
    })
  }

  async broadcastPayout(id: string, payoutTxid: string, actor: string): Promise<WithdrawalState> {
    return this.enqueue(async () => {
      this.assertUsable()
      if (this.config.payoutsEnabled !== true) {
        throw new ProtocolError('payouts are disabled')
      }
      if (!TXID_RE.test(payoutTxid)) throw new ProtocolError('invalid txid')

      const state = this.withdrawals.get(id)
      if (!state) throw new ProtocolError('withdrawal not found')
      if (state.status !== 'payout_prepared') throw new ProtocolError(`cannot broadcast from status ${state.status}`)

      for (const [wid, w] of this.withdrawals.entries()) {
        if (wid !== id && w.payoutTxid === payoutTxid) {
          throw new ProtocolError('payout txid already used')
        }
      }

      let next = this.addAudit(state, 'payout_broadcast', actor, `Broadcast payout tx ${payoutTxid}`)
      next = { ...next, status: 'payout_broadcast', payoutTxid, payoutBroadcastAt: Date.now() }

      this.withdrawals.set(id, next)
      await this.save()
      return cloneState(next)
    })
  }

  async confirmPayout(id: string, actor: string): Promise<WithdrawalState> {
    return this.enqueue(async () => {
      this.assertUsable()
      if (this.config.payoutsEnabled !== true) {
        throw new ProtocolError('payouts are disabled')
      }

      const state = this.withdrawals.get(id)
      if (!state) throw new ProtocolError('withdrawal not found')
      if (state.status === 'completed') return cloneState(state)
      if (state.status !== 'payout_broadcast') {
        throw new ProtocolError(`cannot confirm from status ${state.status}`)
      }
      if (state.payoutTxid === undefined) {
        throw new ProtocolError('withdrawal has no payout transaction to confirm')
      }

      const report = await this.config.payoutConfirmationReader(
        state.payoutTxid,
        state.requiredConfirmations,
      )
      if (
        typeof report !== 'object' ||
        report === null ||
        report.txid !== state.payoutTxid ||
        !Number.isSafeInteger(report.confirmations) ||
        report.confirmations < 1
      ) {
        throw new ProtocolError('payout confirmation report does not match the withdrawal')
      }

      if (report.confirmations < state.requiredConfirmations) {
        let observed = this.addAudit(
          state,
          'payout_observed',
          actor,
          `Payout has ${report.confirmations} of ${state.requiredConfirmations} required confirmations`,
        )
        observed = { ...observed, confirmations: report.confirmations }
        this.withdrawals.set(id, observed)
        await this.save()
        return cloneState(observed)
      }

      const from = state.request.l2From.toLowerCase()
      const currentReserved = this.balanceReservations.get(from) ?? 0n
      if (currentReserved < state.reservedAmount) {
        throw new ProtocolError('withdrawal reservation accounting underflow')
      }

      let next = this.addAudit(
        state,
        'payout_confirmed',
        actor,
        `Payout confirmed with ${report.confirmations} confirmations`,
      )
      next = {
        ...next,
        status: 'payout_confirmed',
        confirmations: report.confirmations,
        payoutConfirmedAt: Date.now(),
      }
      next = this.addAudit(next, 'completed', actor, 'Withdrawal completed')
      next = { ...next, status: 'completed', completedAt: Date.now() }

      const nextReserved = currentReserved - state.reservedAmount
      if (nextReserved === 0n) {
        this.balanceReservations.delete(from)
      } else {
        this.balanceReservations.set(from, nextReserved)
      }
      this.withdrawals.set(id, next)

      try {
        await this.save()
      } catch (error) {
        this.withdrawals.set(id, state)
        if (currentReserved === 0n) {
          this.balanceReservations.delete(from)
        } else {
          this.balanceReservations.set(from, currentReserved)
        }
        throw error
      }
      return cloneState(next)
    })
  }

  async reconcile(id: string, actor: string, reason: string): Promise<WithdrawalState> {
    return this.enqueue(async () => {
      this.assertUsable()
      const state = this.withdrawals.get(id)
      if (!state) throw new ProtocolError('withdrawal not found')
      if (state.status === 'completed' || state.status === 'cancelled' || state.status === 'expired') {
        throw new ProtocolError(`cannot reconcile from status ${state.status}`)
      }

      let next = this.addAudit(state, 'reconciliation', actor, reason)
      next = { ...next, status: 'reconciliation', error: reason }

      this.withdrawals.set(id, next)
      await this.save()
      return cloneState(next)
    })
  }

  getWithdrawal(id: string): WithdrawalState | undefined {
    const state = this.withdrawals.get(id)
    return state === undefined ? undefined : cloneState(state)
  }

  listWithdrawals(): readonly WithdrawalState[] {
    return Array.from(this.withdrawals.values()).map(cloneState)
  }

  getReservedBalance(address: string): bigint {
    return this.balanceReservations.get(address.toLowerCase()) || 0n
  }

  async restartRecovery(): Promise<{ recovered: number; reconciled: number }> {
    return this.enqueue(async () => {
      this.assertUsable()
      let recovered = 0
      let reconciled = 0
      for (const [id, state] of this.withdrawals.entries()) {
        if (state.status === 'payout_broadcast' && !state.payoutConfirmedAt) {
          const newState = this.addAudit(
            state,
            'restart_recovery',
            'system',
            'Recovered pending payout after restart',
          )
          this.withdrawals.set(id, newState)
          recovered++
        }
      }
      await this.save()
      return { recovered, reconciled }
    })
  }
}
