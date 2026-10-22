import { ProtocolError } from './blockProcessor.js'

export const WITHDRAWAL_VERSION = 1
export const WITHDRAWAL_ID_LENGTH = 32

export type WithdrawalRequest = Readonly<{
  version: number
  l2From: string
  l1To: string
  amountWei: bigint
  nonce: bigint
  data?: string
}>

export type WithdrawalRecord = Readonly<{
  id: string
  request: WithdrawalRequest
  status: 'pending' | 'finalized' | 'completed' | 'rejected' | 'expired'
  l2BlockHeight?: bigint
  l2TxHash?: string
  l1TxHash?: string
  reason?: string
  createdAt: number
  updatedAt: number
}>

export type WithdrawalStore = {
  get(id: string): WithdrawalRecord | undefined
  list(): readonly WithdrawalRecord[]
  create(request: WithdrawalRequest): WithdrawalRecord
  update(id: string, update: Partial<WithdrawalRecord>): WithdrawalRecord
  getEscrowed(): bigint
  getPending(): bigint
  getCompleted(): bigint
}

export function computeWithdrawalId(request: WithdrawalRequest): string {
  // Deterministic ID based on request
  const data = JSON.stringify({
    version: request.version,
    l2From: request.l2From.toLowerCase(),
    l1To: request.l1To.toLowerCase(),
    amountWei: request.amountWei.toString(),
    nonce: request.nonce.toString(),
    data: request.data ?? '',
  })
  // Use simple hash for now - replace with keccak256 in production
  let hash = 0n
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5n) - hash + BigInt(data.charCodeAt(i))) & ((1n << 256n) - 1n)
  }
  return hash.toString(16).padStart(64, '0')
}

export function validateWithdrawalRequest(request: unknown): WithdrawalRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new ProtocolError('withdrawal request must be an object')
  }
  const r = request as Record<string, unknown>
  
  if (typeof r.version !== 'number' || r.version !== WITHDRAWAL_VERSION) {
    throw new ProtocolError('invalid withdrawal version')
  }
  if (typeof r.l2From !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(r.l2From)) {
    throw new ProtocolError('invalid l2From address')
  }
  if (typeof r.l1To !== 'string' || r.l1To.length < 8 || r.l1To.length > 90) {
    throw new ProtocolError('invalid l1To address')
  }
  if (typeof r.amountWei !== 'bigint' || r.amountWei <= 0n) {
    throw new ProtocolError('invalid withdrawal amount')
  }
  if (typeof r.nonce !== 'bigint' || r.nonce < 0n) {
    throw new ProtocolError('invalid withdrawal nonce')
  }
  if (r.data !== undefined && typeof r.data !== 'string') {
    throw new ProtocolError('invalid withdrawal data')
  }
  
  return {
    version: r.version,
    l2From: r.l2From.toLowerCase(),
    l1To: r.l1To,
    amountWei: r.amountWei,
    nonce: r.nonce,
    data: r.data as string | undefined,
  }
}

export function isWithdrawalEnabled(): boolean {
  // SECURITY: Withdrawals disabled by default - requires protocol decision
  return process.env.BTCS_ENABLE_WITHDRAWALS === 'true' && process.env.BTCS_WITHDRAWALS_UNSAFE === 'true'
}

export function canProcessPayout(): boolean {
  // SECURITY: Payouts NEVER enabled in this environment
  return false
}
