import { Address, unprefixedHexToBytes } from '@ethereumjs/util'
import {
  ProtocolError,
  type CanonicalReadView,
  type CanonicalSpendActivity,
} from './blockProcessor.js'
import type { BtcsL1DepositRecord } from './btcsL1DepositStore.js'

export const DEPOSIT_ACCOUNTING_FORMAT = 'btcs-l2-deposit-accounting'
export const DEPOSIT_ACCOUNTING_VERSION = 1
export const DEPOSIT_REORG_PLAN_FORMAT = 'btcs-l2-deposit-reorg-plan'
export const DEPOSIT_REORG_PLAN_VERSION = 1

const SATOSHI_TO_WEI = 10n ** 10n
const UINT_RE = /^(0|[1-9][0-9]*)$/
const HASH_RE = /^[0-9a-f]{64}$/
const ADDRESS_RE = /^0x[0-9a-f]{40}$/
const DEPOSIT_ID_RE = /^[0-9a-f]{64}:(0|[1-9][0-9]*)$/

/**
 * One L2 deposit credit as committed by a canonical L2 block, adapted from
 * {@link EvmDepositOperation} plus the canonical block height that committed it.
 */
export type DepositCredit = Readonly<{
  depositId: string
  recipientAddress: string
  amountWei: string
  sourceBlockHash: string
  /** Decimal canonical L2 block height that committed this credit. */
  creditedAtBlock: string
}>

export type DepositAccountingViolationKind =
  | 'unbacked-credit'
  | 'amount-mismatch'
  | 'duplicate-credit'
  | 'over-credit'

export type DepositAccountingViolation = Readonly<{
  kind: DepositAccountingViolationKind
  depositId?: string
  detail: string
}>

/**
 * Bridge accounting invariant report: the sum credited on L2 must never exceed
 * the sum secured by confirmed L1 deposits.
 */
export type DepositAccountingReport = Readonly<{
  format: typeof DEPOSIT_ACCOUNTING_FORMAT
  version: typeof DEPOSIT_ACCOUNTING_VERSION
  securedSats: string
  securedWei: string
  creditedWei: string
  /** Sum of L2 credits whose confirming L1 record is no longer canonical. */
  unbackedCreditedWei: string
  backedCreditCount: number
  invariant: 'creditedWei <= securedWei'
  invariantHolds: boolean
  /** When true, callers must halt new security-sensitive bridge progression. */
  progressBlocked: boolean
  status: 'ok' | 'violated'
  violations: readonly DepositAccountingViolation[]
}>

export type DepositReorgTiming =
  | 'reorg-before-credit'
  | 'after-credit-before-spend'
  | 'after-spend'
  | 're-inclusion'
  | 'none'

export type DepositReorgAction =
  | 'no-op'
  | 'invalidate-l1-only'
  | 'revert-l2-credit'
  | 'credit-l2-once'
  | 'freeze-bridge'

export type DepositReorgPlan = Readonly<{
  format: typeof DEPOSIT_REORG_PLAN_FORMAT
  version: typeof DEPOSIT_REORG_PLAN_VERSION
  depositId: string
  timing: DepositReorgTiming
  action: DepositReorgAction
  progressBlocked: boolean
  /** Present only for `revert-l2-credit`: re-derive canonical L2 from this height. */
  rederiveFromBlock?: string
  reason: string
}>

export type CreditSpendAssessment = Readonly<{
  status: 'outflow-observed' | 'no-outflow-observed' | 'unknown'
  basis: 'canonical-execution-trace' | 'balance-floor' | 'incomplete-trace'
  /** Address-level evidence; fungibility means this is deliberately conservative. */
  activity?: CanonicalSpendActivity
}>

export type CanonicalDepositReorgClassification = Readonly<{
  plan: DepositReorgPlan
  spendAssessment?: CreditSpendAssessment
}>

function requireUint(value: unknown, label: string): string {
  if (typeof value !== 'string' || !UINT_RE.test(value)) {
    throw new ProtocolError(`${label} must be a non-negative integer string`)
  }
  return value
}

function validateCredit(value: unknown): DepositCredit {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError('deposit credit must be an object')
  }
  const credit = value as Record<string, unknown>
  if (
    typeof credit.depositId !== 'string' ||
    !DEPOSIT_ID_RE.test(credit.depositId)
  ) {
    throw new ProtocolError('deposit credit has an invalid deposit ID')
  }
  if (
    typeof credit.sourceBlockHash !== 'string' ||
    !HASH_RE.test(credit.sourceBlockHash)
  ) {
    throw new ProtocolError('deposit credit has an invalid source block hash')
  }
  if (
    typeof credit.recipientAddress !== 'string' ||
    !ADDRESS_RE.test(credit.recipientAddress)
  ) {
    throw new ProtocolError('deposit credit has an invalid recipient address')
  }
  const amountWei = requireUint(credit.amountWei, 'deposit credit amountWei')
  if (amountWei === '0') {
    throw new ProtocolError('deposit credit amountWei must be positive')
  }
  const creditedAtBlock = requireUint(credit.creditedAtBlock, 'deposit credit creditedAtBlock')
  return {
    depositId: credit.depositId,
    recipientAddress: credit.recipientAddress,
    amountWei,
    sourceBlockHash: credit.sourceBlockHash,
    creditedAtBlock,
  }
}

/**
 * Adapt every deposit credit from a fully replayed canonical L2 view, tagging
 * each with the block height that committed it. Read-only; retains no cache.
 */
export function collectCanonicalDepositCredits(
  view: CanonicalReadView,
): readonly DepositCredit[] {
  const credits: DepositCredit[] = []
  const tip = view.report.tip.number
  for (let height = 0n; height <= tip; height += 1n) {
    for (const operation of view.getCanonicalDepositOperations(height)) {
      credits.push({
        depositId: operation.depositId,
        recipientAddress: operation.recipientAddress,
        amountWei: operation.amountWei,
        sourceBlockHash: operation.sourceBlockHash,
        creditedAtBlock: height.toString(10),
      })
    }
  }
  return credits
}

function commit(credits: readonly DepositCredit[]): readonly DepositCredit[] {
  return credits.map(validateCredit)
}

/**
 * Evaluate the bridge invariant over confirmed L1 deposit records and canonical
 * L2 deposit credits. Malformed input throws; every invariant violation is
 * reported in the result rather than thrown, because violations are expected
 * protocol states that the caller must handle.
 */
export function calculateDepositAccounting(input: Readonly<{
  secured: readonly BtcsL1DepositRecord[]
  credits: readonly DepositCredit[]
}>): DepositAccountingReport {
  const credits = commit(input.credits)
  const violations: DepositAccountingViolation[] = []

  const confirmed = new Map<string, BtcsL1DepositRecord>()
  let securedSats = 0n
  for (const record of input.secured) {
    if (record.state !== 'confirmed') continue
    confirmed.set(record.depositId, record)
    securedSats += BigInt(record.amountSats)
  }
  const securedWei = securedSats * SATOSHI_TO_WEI

  const seen = new Set<string>()
  let creditedWei = 0n
  let unbackedCreditedWei = 0n
  let backedCreditCount = 0

  for (const credit of credits) {
    creditedWei += BigInt(credit.amountWei)
    if (seen.has(credit.depositId)) {
      violations.push({
        kind: 'duplicate-credit',
        depositId: credit.depositId,
        detail: 'the same deposit credit appears more than once in canonical history',
      })
      continue
    }
    seen.add(credit.depositId)

    const record = confirmed.get(credit.depositId)
    if (record === undefined || record.blockHash !== credit.sourceBlockHash) {
      unbackedCreditedWei += BigInt(credit.amountWei)
      violations.push({
        kind: 'unbacked-credit',
        depositId: credit.depositId,
        detail:
          record === undefined
            ? 'L2 credit has no confirmed L1 deposit with the same inclusion'
            : 'L1 inclusion hash changed after the L2 credit was committed',
      })
      continue
    }

    const backingWei = BigInt(record.amountSats) * SATOSHI_TO_WEI
    if (backingWei !== BigInt(credit.amountWei)) {
      unbackedCreditedWei += BigInt(credit.amountWei)
      violations.push({
        kind: 'amount-mismatch',
        depositId: credit.depositId,
        detail: 'L2 credit amount does not equal its confirmed L1 deposit amount',
      })
      continue
    }

    backedCreditCount += 1
  }

  if (creditedWei > securedWei) {
    violations.push({
      kind: 'over-credit',
      detail: 'total L2 deposit credit exceeds total confirmed L1 backing',
    })
  }

  const invariantHolds = violations.length === 0
  return {
    format: DEPOSIT_ACCOUNTING_FORMAT,
    version: DEPOSIT_ACCOUNTING_VERSION,
    securedSats: securedSats.toString(10),
    securedWei: securedWei.toString(10),
    creditedWei: creditedWei.toString(10),
    unbackedCreditedWei: unbackedCreditedWei.toString(10),
    backedCreditCount,
    invariant: 'creditedWei <= securedWei',
    invariantHolds,
    progressBlocked: !invariantHolds,
    status: invariantHolds ? 'ok' : 'violated',
    violations,
  }
}

/**
 * Classify the reorg timing of one deposit and return the deterministic
 * remediation. `creditSpent` is a conservative risk flag supplied by the caller;
 * use `classifyCanonicalDepositReorg` to derive it from replay evidence, with
 * unknown spend status treated as potentially spent.
 */
export function classifyDepositReorg(input: Readonly<{
  depositId: string
  l1: BtcsL1DepositRecord | undefined
  credit: DepositCredit | undefined
  creditSpent: boolean
}>): DepositReorgPlan {
  const { depositId, l1, credit } = input
  if (typeof depositId !== 'string' || !DEPOSIT_ID_RE.test(depositId)) {
    throw new ProtocolError('deposit ID must be a transaction ID and output index')
  }
  const validatedCredit = credit === undefined ? undefined : commit([credit])[0]!
  const base = {
    format: DEPOSIT_REORG_PLAN_FORMAT,
    version: DEPOSIT_REORG_PLAN_VERSION,
    depositId,
  } as const

  if (validatedCredit === undefined) {
    if (l1?.state === 'confirmed') {
      const previouslyInvalidated = l1.lastInvalidatedBlockHash !== undefined
      return {
        ...base,
        timing: previouslyInvalidated ? 're-inclusion' : 'none',
        action: 'credit-l2-once',
        progressBlocked: false,
        reason: 'confirmed L1 deposit is secured but has no L2 credit',
      }
    }
    return {
      ...base,
      timing: 'reorg-before-credit',
      action: 'invalidate-l1-only',
      progressBlocked: false,
      reason: 'L1 inclusion left the active chain before any L2 credit was committed',
    }
  }

  if (l1?.state === 'confirmed' && l1.blockHash === validatedCredit.sourceBlockHash) {
    return {
      ...base,
      timing: 're-inclusion',
      action: 'no-op',
      progressBlocked: false,
      reason: 'L1 deposit is confirmed again on the same inclusion as the L2 credit',
    }
  }

  // The credit is not backed by the current confirmed L1 inclusion.
  if (input.creditSpent) {
    return {
      ...base,
      timing: l1?.state === 'confirmed' ? 're-inclusion' : 'after-spend',
      action: 'freeze-bridge',
      progressBlocked: true,
      reason:
        'L1 deposit was reorganized out after observed or unexcluded post-credit outflow; unwinding requires unproven L2 re-derivation',
    }
  }

  return {
    ...base,
    timing: l1?.state === 'confirmed' ? 're-inclusion' : 'after-credit-before-spend',
    action: 'revert-l2-credit',
    progressBlocked: true,
    rederiveFromBlock: validatedCredit.creditedAtBlock,
    reason:
      l1?.state === 'confirmed'
        ? 'confirmed inclusion changed; revert the stale credit before re-crediting'
        : 'L1 deposit was reorganized out before its L2 credit was spent',
  }
}

/**
 * Classify a deposit against a replay-verified canonical L2 view. Any observed
 * outflow or incomplete spend trace is treated as potentially spent, so an
 * unbacked credit freezes progression unless the complete trace proves that no
 * outflow followed the credit.
 */
export async function classifyCanonicalDepositReorg(input: Readonly<{
  depositId: string
  view: CanonicalReadView
  l1: BtcsL1DepositRecord | undefined
  credit: DepositCredit | undefined
}>): Promise<CanonicalDepositReorgClassification> {
  if (input.credit === undefined) {
    return {
      plan: classifyDepositReorg({
        depositId: input.depositId,
        l1: input.l1,
        credit: undefined,
        creditSpent: false,
      }),
    }
  }
  if (input.credit.depositId !== input.depositId) {
    throw new ProtocolError('deposit ID does not match the canonical credit')
  }
  const spendAssessment = await assessCreditSpend(input.view, input.credit)
  return {
    plan: classifyDepositReorg({
      depositId: input.credit.depositId,
      l1: input.l1,
      credit: input.credit,
      creditSpent: spendAssessment.status !== 'no-outflow-observed',
    }),
    spendAssessment,
  }
}

/**
 * Assess address-level native-asset outflow since a canonical credit. A complete
 * replay trace observes top-level and nested value transfers, transaction fees,
 * and selfdestructs. Because native balances are fungible, any such activity is
 * conservatively treated as a possible spend of every earlier credit to that
 * address; this can freeze recovery even when pre-existing funds covered it.
 */
export async function assessCreditSpend(
  view: CanonicalReadView,
  credit: DepositCredit,
): Promise<CreditSpendAssessment> {
  const validated = commit([credit])[0]!
  const address = new Address(unprefixedHexToBytes(validated.recipientAddress.slice(2)))
  const activity = view.getSpendActivitySince(
    validated.recipientAddress,
    BigInt(validated.creditedAtBlock),
  )
  if (activity !== undefined) {
    return {
      status: 'outflow-observed',
      basis: 'canonical-execution-trace',
      activity,
    }
  }
  if (view.spendTraceComplete) {
    return { status: 'no-outflow-observed', basis: 'canonical-execution-trace' }
  }
  const tipBalance = await view.getAccountBalance(address)
  if (tipBalance < BigInt(validated.amountWei)) {
    return { status: 'outflow-observed', basis: 'balance-floor' }
  }
  return { status: 'unknown', basis: 'incomplete-trace' }
}
