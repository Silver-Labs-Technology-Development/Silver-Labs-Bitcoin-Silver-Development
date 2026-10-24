import { randomUUID } from 'node:crypto'
import { open, readFile, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

/**
 * Persisted, fail-closed production gate for the L2 deposit bridge.
 *
 * When a credited L1 deposit is found to be non-canonical, the affected chain
 * store must stop accepting new canonical blocks until the reorg has been
 * resolved (by re-derivation or by an operator-approved recovery). The gate is
 * a small JSON marker written into the chain directory. Its presence means
 * "frozen"; its absence means "open".
 *
 * This module deliberately depends on nothing but Node built-ins so that the
 * block processor can consult it without creating an import cycle.
 */
export const DEPOSIT_RECOVERY_GATE_FORMAT = 'btcs-l2-deposit-recovery-gate'
export const DEPOSIT_RECOVERY_GATE_VERSION = 1
export const DEPOSIT_RECOVERY_GATE_FILENAME = 'deposit-recovery-gate.json'

const MAX_GATE_BYTES = 64 * 1024
const UINT_RE = /^(0|[1-9][0-9]*)$/
const DEPOSIT_ID_RE = /^[0-9a-f]{64}:(0|[1-9][0-9]*)$/

export type DepositRecoveryGateState = Readonly<{
  format: typeof DEPOSIT_RECOVERY_GATE_FORMAT
  version: typeof DEPOSIT_RECOVERY_GATE_VERSION
  status: 'frozen'
  reason: string
  involvedDepositIds: readonly string[]
  rederiveFromBlock?: string
  /** Canonical L2 height the gate was engaged at (diagnostic only). */
  engagedAtHeight: string
}>

/**
 * Raised when block production is attempted against a frozen chain store.
 * Carries the persisted gate state so callers can report the reason and the
 * deposits responsible.
 */
export class DepositRecoveryGateError extends Error {
  override name = 'DepositRecoveryGateError'

  constructor(
    readonly gate: DepositRecoveryGateState,
    message: string,
  ) {
    super(message)
  }
}

function gatePath(directory: string): string {
  return resolve(directory, DEPOSIT_RECOVERY_GATE_FILENAME)
}

function requireUint(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UINT_RE.test(value)) {
    throw new Error(`${label} must be a non-negative integer string`)
  }
  return value
}

function parseGate(value: unknown): DepositRecoveryGateState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('deposit recovery gate must be a JSON object')
  }
  const gate = value as Record<string, unknown>
  if (gate.format !== DEPOSIT_RECOVERY_GATE_FORMAT) {
    throw new Error('deposit recovery gate has an unexpected format')
  }
  if (gate.version !== DEPOSIT_RECOVERY_GATE_VERSION) {
    throw new Error('deposit recovery gate has an unsupported version')
  }
  if (gate.status !== 'frozen') {
    throw new Error('deposit recovery gate status must be "frozen"')
  }
  if (typeof gate.reason !== 'string' || gate.reason.length === 0) {
    throw new Error('deposit recovery gate reason must be a non-empty string')
  }
  if (!Array.isArray(gate.involvedDepositIds)) {
    throw new Error('deposit recovery gate involvedDepositIds must be an array')
  }
  const involvedDepositIds: string[] = []
  for (const depositId of gate.involvedDepositIds) {
    if (typeof depositId !== 'string' || !DEPOSIT_ID_RE.test(depositId)) {
      throw new Error('deposit recovery gate has an invalid deposit ID')
    }
    involvedDepositIds.push(depositId)
  }
  const engagedAtHeight = requireUint(gate.engagedAtHeight, 'engagedAtHeight')
  if (gate.rederiveFromBlock === undefined) {
    return {
      format: DEPOSIT_RECOVERY_GATE_FORMAT,
      version: DEPOSIT_RECOVERY_GATE_VERSION,
      status: 'frozen',
      reason: gate.reason,
      involvedDepositIds,
      engagedAtHeight,
    }
  }
  const rederiveFromBlock = requireUint(gate.rederiveFromBlock, 'rederiveFromBlock')
  return {
    format: DEPOSIT_RECOVERY_GATE_FORMAT,
    version: DEPOSIT_RECOVERY_GATE_VERSION,
    status: 'frozen',
    reason: gate.reason,
    involvedDepositIds,
    rederiveFromBlock,
    engagedAtHeight,
  }
}

/**
 * Read the persisted gate. Returns `undefined` when the store is open. A
 * malformed marker is treated as frozen (fail closed) rather than ignored.
 */
export async function readDepositRecoveryGate(
  directory: string,
): Promise<DepositRecoveryGateState | undefined> {
  let raw: Buffer
  try {
    raw = await readFile(gatePath(directory))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  if (raw.byteLength > MAX_GATE_BYTES) {
    throw new Error('deposit recovery gate exceeds the local size limit')
  }
  return parseGate(JSON.parse(raw.toString('utf8')) as unknown)
}

/** Persist the gate marker atomically and durably (fsync file and directory). */
export async function writeDepositRecoveryGate(
  directory: string,
  state: DepositRecoveryGateState,
): Promise<void> {
  const validated = parseGate(state)
  const target = gatePath(directory)
  const temporary = resolve(directory, `.${randomUUID()}.deposit-gate.tmp`)
  const encoded = Buffer.from(`${JSON.stringify(validated)}\n`, 'utf8')

  let handle: Awaited<ReturnType<typeof open>> | undefined
  let renamed = false
  try {
    handle = await open(temporary, 'wx', 0o600)
    await handle.writeFile(encoded)
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporary, target)
    renamed = true

    const directoryHandle = await open(directory, 'r')
    try {
      await directoryHandle.sync()
    } finally {
      await directoryHandle.close()
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined)
    if (!renamed) await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/** Remove the gate marker durably, reopening the store to block production. */
export async function clearDepositRecoveryGate(directory: string): Promise<void> {
  try {
    await rm(gatePath(directory))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return
  }
  const directoryHandle = await open(directory, 'r')
  try {
    await directoryHandle.sync()
  } finally {
    await directoryHandle.close()
  }
}

/**
 * Fail-closed guard for the canonical block-production path. Throws
 * {@link DepositRecoveryGateError} when the store is frozen.
 */
export async function assertDepositRecoveryOpen(directory: string): Promise<void> {
  const gate = await readDepositRecoveryGate(directory)
  if (gate === undefined) return
  throw new DepositRecoveryGateError(
    gate,
    `deposit recovery gate is frozen: ${gate.reason}`,
  )
}

export function depositRecoveryGatePath(directory: string): string {
  return gatePath(directory)
}
