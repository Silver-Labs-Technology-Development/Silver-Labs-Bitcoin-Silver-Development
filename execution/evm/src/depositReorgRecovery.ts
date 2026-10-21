import { rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createBlockFromRLP } from '@ethereumjs/block'
import type { TypedTransaction } from '@ethereumjs/tx'
import { hexToBytes } from '@ethereumjs/util'
import {
  PersistentBlockProcessor,
  ProtocolError,
  type CanonicalReadView,
  type ChainTip,
} from './blockProcessor.js'
import { createHarnessCommon } from './config.js'
import { collectCanonicalDepositCredits } from './depositReorgAccounting.js'
import type { DepositCredit } from './depositReorgAccounting.js'
import {
  DEPOSIT_RECOVERY_GATE_FORMAT,
  DEPOSIT_RECOVERY_GATE_VERSION,
  clearDepositRecoveryGate,
  readDepositRecoveryGate,
  writeDepositRecoveryGate,
} from './depositRecoveryGate.js'
import type { DepositRecoveryGateState } from './depositRecoveryGate.js'

export const DEPOSIT_REORG_RECOVERY_FORMAT = 'btcs-l2-deposit-reorg-recovery'
export const DEPOSIT_REORG_RECOVERY_VERSION = 1

const DEPOSIT_ID_RE = /^[0-9a-f]{64}:(0|[1-9][0-9]*)$/

export type DepositReorgRecoveryFailureKind =
  | 'output-directory-not-usable'
  | 'rebuild-failed'
  | 'residual-credit'

/** A deterministic failure to re-derive canonical L2 after a deposit invalidation. */
export class DepositReorgRecoveryError extends Error {
  override name = 'DepositReorgRecoveryError'

  constructor(
    readonly kind: DepositReorgRecoveryFailureKind,
    message: string,
    readonly details: Readonly<{
      blockHeight?: string
      removedDepositIds?: readonly string[]
    }> = {},
  ) {
    super(message)
  }
}

export type ReDerivedBlock = Readonly<{
  height: string
  previousHash: string
  newHash: string
  removedDepositIds: readonly string[]
}>

export type DepositReorgRecoveryReport = Readonly<{
  format: typeof DEPOSIT_REORG_RECOVERY_FORMAT
  version: typeof DEPOSIT_REORG_RECOVERY_VERSION
  status: 'no-recovery-needed' | 're-derived'
  sourceTip: ChainTip
  reDerivedTip: ChainTip
  outputDirectory: string
  /** First canonical height that had to be rebuilt (present when re-derived). */
  rederiveFromBlock?: string
  blocksRebuilt: number
  /** Canonical credits removed from history, ascending by creditedAtBlock. */
  droppedDepositIds: readonly string[]
  /** Requested IDs that were never credited on the canonical chain. */
  ignoredDepositIds: readonly string[]
  blocks: readonly ReDerivedBlock[]
}>

export type DepositReorgRecoveryResult = Readonly<{
  status: 'no-recovery-needed' | 're-derived'
  gate: DepositRecoveryGateState | undefined
  report: DepositReorgRecoveryReport
}>

function requireDepositId(value: unknown): string {
  if (typeof value !== 'string' || !DEPOSIT_ID_RE.test(value)) {
    throw new ProtocolError('deposit ID must be a transaction ID and output index')
  }
  return value
}

function normalizeInvalidated(ids: readonly string[]): readonly string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const id of ids) {
    const validated = requireDepositId(id)
    if (!seen.has(validated)) {
      seen.add(validated)
      ordered.push(validated)
    }
  }
  return ordered
}

function selectDroppedCredits(
  view: CanonicalReadView,
  invalidated: readonly string[],
): { dropped: readonly DepositCredit[]; ignored: readonly string[] } {
  const invalidatedSet = new Set(invalidated)
  const credits = collectCanonicalDepositCredits(view)
  const dropped: DepositCredit[] = []
  for (const credit of credits) {
    if (invalidatedSet.has(credit.depositId)) dropped.push(credit)
  }
  const credited = new Set(credits.map((credit) => credit.depositId))
  const ignored = invalidated.filter((id) => !credited.has(id))
  return { dropped, ignored }
}

function earliestCreditedBlock(dropped: readonly DepositCredit[]): bigint {
  let earliest: bigint | undefined
  for (const credit of dropped) {
    const height = BigInt(credit.creditedAtBlock)
    if (earliest === undefined || height < earliest) earliest = height
  }
  if (earliest === undefined) throw new ProtocolError('no dropped credits to re-derive')
  return earliest
}

async function assertFreshOutputDirectory(outputDirectory: string): Promise<void> {
  try {
    await stat(resolve(outputDirectory))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  throw new DepositReorgRecoveryError(
    'output-directory-not-usable',
    `re-derivation output directory already exists: ${outputDirectory}`,
  )
}

/**
 * Re-derive canonical L2 state after one or more credited deposits cease to be
 * canonical.
 *
 * The function replays the untouched prefix into a fresh chain store, then
 * rebuilds every block from the earliest affected height with the invalidated
 * deposit credits removed. Only the existing, verified block production and
 * import primitives are used, so the re-derived chain is byte-for-byte
 * verifiable by the same rules as the canonical chain.
 *
 * If any rebuilt block can no longer execute — for example a later transaction
 * spent the removed credit — the function fails closed with a
 * {@link DepositReorgRecoveryError} of kind `rebuild-failed`; it never invents
 * a replacement chain. The source chain store is not modified.
 *
 * The returned chain lives only in `outputDirectory`. This lower-level helper
 * does not adopt it; the operator-facing `recoverDepositReorg` flow does.
 */
export async function rederiveCanonicalL2AfterDepositInvalidation(
  input: Readonly<{
    canonicalView: CanonicalReadView
    invalidatedDepositIds: readonly string[]
    outputDirectory: string
  }>,
): Promise<DepositReorgRecoveryReport> {
  const invalidated = normalizeInvalidated(input.invalidatedDepositIds)
  const view = input.canonicalView
  const sourceTip = view.report.tip
  const outputDirectory = resolve(input.outputDirectory)
  const { dropped, ignored } = selectDroppedCredits(view, invalidated)

  if (dropped.length === 0) {
    return {
      format: DEPOSIT_REORG_RECOVERY_FORMAT,
      version: DEPOSIT_REORG_RECOVERY_VERSION,
      status: 'no-recovery-needed',
      sourceTip,
      reDerivedTip: sourceTip,
      outputDirectory,
      blocksRebuilt: 0,
      droppedDepositIds: [],
      ignoredDepositIds: ignored,
      blocks: [],
    }
  }

  const rederiveFromBlock = earliestCreditedBlock(dropped)
  const droppedDepositIds = dropped
    .map((credit) => credit.depositId)
    .sort()
  const invalidatedSet = new Set(invalidated)

  await assertFreshOutputDirectory(outputDirectory)
  const rederived = await PersistentBlockProcessor.open(outputDirectory)

  try {
    // Replay the canonical prefix that is unaffected by the removed credits.
    for (let height = 1n; height < rederiveFromBlock; height += 1n) {
      const data = view.getCanonicalBlockByNumber(height)
      if (data === undefined) {
        throw new ProtocolError(`canonical block ${height} is missing during replay`)
      }
      await rederived.acceptBlock(
        hexToBytes(data.blockRlpHex as `0x${string}`),
        view.getCanonicalDepositOperations(height),
      )
    }

    // Rebuild every block from the earliest removed credit through the tip.
    const rebuiltBlocks: ReDerivedBlock[] = []
    for (let height = rederiveFromBlock; height <= sourceTip.number; height += 1n) {
      const data = view.getCanonicalBlockByNumber(height)
      if (data === undefined) {
        throw new ProtocolError(`canonical block ${height} is missing during re-derivation`)
      }
      const block = createBlockFromRLP(hexToBytes(data.blockRlpHex as `0x${string}`), {
        common: createHarnessCommon(),
      })
      const operations = view.getCanonicalDepositOperations(height)
      const removedDepositIds = operations
        .filter((operation) => invalidatedSet.has(operation.depositId))
        .map((operation) => operation.depositId)
      const retained = operations.filter(
        (operation) => !invalidatedSet.has(operation.depositId),
      )

      let processed
      try {
        processed = await rederived.buildNextBlock(
          block.transactions as readonly TypedTransaction[],
          block.header.timestamp,
          retained,
        )
      } catch (error) {
        throw new DepositReorgRecoveryError(
          'rebuild-failed',
          `re-derivation of block ${height} failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          { blockHeight: height.toString(10), removedDepositIds },
        )
      }

      rebuiltBlocks.push({
        height: height.toString(10),
        previousHash: data.summary.hash,
        newHash: processed.summary.hash,
        removedDepositIds,
      })
    }

    const rederivedView = await rederived.createCanonicalReadView()
    const reDerivedTip = rederivedView.report.tip
    for (let height = 0n; height <= reDerivedTip.number; height += 1n) {
      for (const operation of rederivedView.getCanonicalDepositOperations(height)) {
        if (invalidatedSet.has(operation.depositId)) {
          throw new DepositReorgRecoveryError(
            'residual-credit',
            `invalidated deposit ${operation.depositId} is still credited at block ${height}`,
            { blockHeight: height.toString(10), removedDepositIds: [operation.depositId] },
          )
        }
      }
    }

    return {
      format: DEPOSIT_REORG_RECOVERY_FORMAT,
      version: DEPOSIT_REORG_RECOVERY_VERSION,
      status: 're-derived',
      sourceTip,
      reDerivedTip,
      outputDirectory,
      rederiveFromBlock: rederiveFromBlock.toString(10),
      blocksRebuilt: rebuiltBlocks.length,
      droppedDepositIds,
      ignoredDepositIds: ignored,
      blocks: rebuiltBlocks,
    }
  } catch (error) {
    // The partial re-derived store is unusable; remove it so a retry starts clean.
    await rm(outputDirectory, { recursive: true, force: true })
    throw error
  }
}

/**
 * Operator-facing coordination for one deposit reorg.
 *
 * Detects whether any requested deposit is actually credited on the canonical
 * chain. When it is, the source chain store is frozen first (persisted,
 * fail-closed against new block production), and then canonical re-derivation
 * is attempted into `outputDirectory`.
 *
 * On success the verified re-derived blocks are copied into the frozen source
 * store, its chain metadata is atomically advanced to the recovered tip, and
 * the recovery gate is removed only after that commit.
 */
export async function recoverDepositReorg(
  input: Readonly<{
    processor: PersistentBlockProcessor
    invalidatedDepositIds: readonly string[]
    outputDirectory: string
  }>,
): Promise<DepositReorgRecoveryResult> {
  const result = await input.processor.withDepositRecoveryLock(
    async (view): Promise<DepositReorgRecoveryResult> => {
    const invalidated = normalizeInvalidated(input.invalidatedDepositIds)
    const { dropped } = selectDroppedCredits(view, invalidated)

    if (dropped.length === 0) {
      const report = await rederiveCanonicalL2AfterDepositInvalidation({
        canonicalView: view,
        invalidatedDepositIds: invalidated,
        outputDirectory: input.outputDirectory,
      })
      return {
        status: 'no-recovery-needed',
        gate: await readDepositRecoveryGate(input.processor.directory),
        report,
      }
    }

    const rederiveFromBlock = earliestCreditedBlock(dropped).toString(10)
    const gate: DepositRecoveryGateState = {
      format: DEPOSIT_RECOVERY_GATE_FORMAT,
      version: DEPOSIT_RECOVERY_GATE_VERSION,
      status: 'frozen',
      reason: 'credited L1 deposit is no longer canonical; canonical re-derivation required',
      involvedDepositIds: dropped.map((credit) => credit.depositId).sort(),
      rederiveFromBlock,
      engagedAtHeight: view.report.tip.number.toString(10),
    }
    await writeDepositRecoveryGate(input.processor.directory, gate)

    const report = await rederiveCanonicalL2AfterDepositInvalidation({
      canonicalView: view,
      invalidatedDepositIds: invalidated,
      outputDirectory: input.outputDirectory,
    })
    return { status: 're-derived', gate, report }
    },
  )

  if (result.status === 'no-recovery-needed') return result

  await input.processor.adoptReDerivedStore(result.report.outputDirectory)
  return { ...result, gate: undefined }
}

/** Clear a persisted freeze once the recovered store is canonical. */
export async function clearDepositRecoveryFreeze(chainDirectory: string): Promise<void> {
  await clearDepositRecoveryGate(chainDirectory)
}
