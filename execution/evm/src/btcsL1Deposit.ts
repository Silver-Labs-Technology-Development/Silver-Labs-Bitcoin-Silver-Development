import { ProtocolError } from './blockProcessor.js'
import type { BtcsL1ConfirmationRpc } from './btcsL1Confirmation.js'

export const BTCS_L1_DEPOSIT_FORMAT = 'btcs-l2-l1-deposit-intent'
export const BTCS_L1_DEPOSIT_VERSION = 1
export const BTCS_L1_DEPOSIT_MAGIC_HEX = '425443534c3244' // BTCSL2D

const OP_RETURN_PREFIX = '6a1c'
const PAYLOAD_HEX_LENGTH = 56 // 7-byte marker + 1-byte version + 20-byte EVM address
const HASH_RE = /^[0-9a-f]{64}$/
const SCRIPT_HEX_RE = /^(?:[0-9a-f]{2})+$/
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const SATOSHIS_PER_COIN = 100_000_000

export type BtcsL1DepositIntent = Readonly<{
  format: typeof BTCS_L1_DEPOSIT_FORMAT
  version: typeof BTCS_L1_DEPOSIT_VERSION
  recipientAddress: string
}>

export type BtcsL1DepositRequest = Readonly<{
  txid: string
  blockHash: string
  recipientAddress: string
  depositScriptPubKeyHex: string
  requiredConfirmations: number
}>

export type BtcsL1DepositReport = Readonly<{
  format: 'btcs-l2-btcs-l1-deposit-verification'
  version: 1
  verificationModel: 'trusted-btcs-core-rpc'
  depositId: string
  txid: string
  blockHash: string
  blockHeight: number
  confirmations: number
  activeChain: true
  recipientAddress: string
  amountSats: string
  depositOutputIndex: number
  depositVerified: true
}>

export type BtcsL1DepositRpc = Pick<
  BtcsL1ConfirmationRpc,
  'getRawTransaction' | 'getBlockHeader'
>

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${label} RPC response is malformed`)
  }
  return value as Record<string, unknown>
}

function normalizeRecipientAddress(address: string): string {
  if (typeof address !== 'string' || !ADDRESS_RE.test(address)) {
    throw new ProtocolError('deposit recipient must be a 20-byte EVM address')
  }
  return `0x${address.slice(2).toLowerCase()}`
}

function validateScriptHex(scriptHex: string, label: string): void {
  if (typeof scriptHex !== 'string' || !SCRIPT_HEX_RE.test(scriptHex)) {
    throw new ProtocolError(`${label} must be non-empty, even-length lowercase hex`)
  }
}

export function encodeBtcsL1DepositPayload(recipientAddress: string): string {
  const recipient = normalizeRecipientAddress(recipientAddress).slice(2)
  return `${BTCS_L1_DEPOSIT_MAGIC_HEX}01${recipient}`
}

export function decodeBtcsL1DepositPayload(payloadHex: string): BtcsL1DepositIntent {
  if (
    typeof payloadHex !== 'string' ||
    payloadHex.length !== PAYLOAD_HEX_LENGTH ||
    !/^[0-9a-f]+$/.test(payloadHex)
  ) {
    throw new ProtocolError('BTCS L1 deposit payload is malformed')
  }

  if (!payloadHex.startsWith(BTCS_L1_DEPOSIT_MAGIC_HEX)) {
    throw new ProtocolError('BTCS L1 deposit protocol marker does not match')
  }

  const versionOffset = BTCS_L1_DEPOSIT_MAGIC_HEX.length
  if (payloadHex.slice(versionOffset, versionOffset + 2) !== '01') {
    throw new ProtocolError('unsupported BTCS L1 deposit version')
  }

  return {
    format: BTCS_L1_DEPOSIT_FORMAT,
    version: BTCS_L1_DEPOSIT_VERSION,
    recipientAddress: `0x${payloadHex.slice(versionOffset + 2)}`,
  }
}

/**
 * Canonical OP_RETURN deposit intent.
 * This marker announces an L2 recipient; the deposit amount must come from
 * a separate, positive-value transaction output to the configured L1 script.
 */
export function encodeBtcsL1DepositScript(recipientAddress: string): string {
  return `${OP_RETURN_PREFIX}${encodeBtcsL1DepositPayload(recipientAddress)}`
}

export function decodeBtcsL1DepositScript(scriptPubKeyHex: string): BtcsL1DepositIntent {
  if (
    typeof scriptPubKeyHex !== 'string' ||
    !scriptPubKeyHex.startsWith(OP_RETURN_PREFIX) ||
    scriptPubKeyHex.length !== OP_RETURN_PREFIX.length + PAYLOAD_HEX_LENGTH ||
    !/^[0-9a-f]+$/.test(scriptPubKeyHex)
  ) {
    throw new ProtocolError('scriptPubKey is not a canonical BTCS L1 deposit intent')
  }

  return decodeBtcsL1DepositPayload(scriptPubKeyHex.slice(OP_RETURN_PREFIX.length))
}

function valueToSatoshis(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ProtocolError('deposit payment output must have a positive numeric value')
  }

  const scaled = value * SATOSHIS_PER_COIN
  const rounded = Math.round(scaled)
  if (
    !Number.isSafeInteger(rounded) ||
    rounded <= 0 ||
    Math.abs(scaled - rounded) > 0.00001
  ) {
    throw new ProtocolError('deposit payment output does not represent whole satoshis')
  }

  return BigInt(rounded).toString(10)
}

/**
 * Validate a BTCS L1 deposit using the configured deposit script and trusted
 * BTCS Core RPC. This function is read-only: it does not credit L2 balances.
 *
 * The deposit transaction must contain exactly one canonical deposit intent
 * and exactly one positive-value output to the configured deposit script.
 * Production use additionally requires durable replay protection, a secure
 * escrow design, and an explicit confirmation/finality policy.
 */
export async function verifyBtcsL1Deposit(
  rpc: BtcsL1DepositRpc,
  request: BtcsL1DepositRequest,
): Promise<BtcsL1DepositReport> {
  if (
    typeof request.txid !== 'string' ||
    !HASH_RE.test(request.txid) ||
    typeof request.blockHash !== 'string' ||
    !HASH_RE.test(request.blockHash)
  ) {
    throw new ProtocolError('txid and block hash must be 64 lowercase hex characters')
  }

  const expectedRecipient = normalizeRecipientAddress(request.recipientAddress)

  validateScriptHex(request.depositScriptPubKeyHex, 'configured deposit script')
  if (request.depositScriptPubKeyHex.startsWith('6a')) {
    throw new ProtocolError('configured deposit script cannot be an OP_RETURN output')
  }

  if (
    !Number.isSafeInteger(request.requiredConfirmations) ||
    request.requiredConfirmations < 1
  ) {
    throw new ProtocolError('required confirmations must be a positive safe integer')
  }

  const tx = asRecord(
    await rpc.getRawTransaction(request.txid, request.blockHash),
    'transaction',
  )

  if (tx.txid !== request.txid) {
    throw new ProtocolError('transaction RPC returned a different txid')
  }
  if (tx.blockhash !== request.blockHash) {
    throw new ProtocolError('transaction is not in the requested block')
  }
  if (tx.in_active_chain !== true) {
    throw new ProtocolError('deposit transaction is not confirmed in the active chain')
  }
  if (!Array.isArray(tx.vout)) {
    throw new ProtocolError('transaction RPC response has no valid vout array')
  }

  const intents: Array<{ recipientAddress: string; value: unknown }> = []
  const paymentOutputs: Array<{ outputIndex: number; amountSats: string }> = []

  for (const rawOutput of tx.vout) {
    const output = asRecord(rawOutput, 'transaction output')
    const script = asRecord(output.scriptPubKey, 'output scriptPubKey')
    const scriptHex = script.hex

    if (typeof scriptHex !== 'string') {
      throw new ProtocolError('transaction output has no scriptPubKey hex')
    }
    validateScriptHex(scriptHex, 'transaction output scriptPubKey')

    if (scriptHex.includes(BTCS_L1_DEPOSIT_MAGIC_HEX)) {
      const intent = decodeBtcsL1DepositScript(scriptHex)
      if (output.value !== 0) {
        throw new ProtocolError('deposit intent OP_RETURN output must have zero value')
      }
      intents.push({ recipientAddress: intent.recipientAddress, value: output.value })
    }

    if (scriptHex === request.depositScriptPubKeyHex) {
      if (!Number.isSafeInteger(output.n) || (output.n as number) < 0) {
        throw new ProtocolError('deposit payment output has an invalid output index')
      }
      paymentOutputs.push({
        outputIndex: output.n as number,
        amountSats: valueToSatoshis(output.value),
      })
    }
  }

  if (intents.length !== 1) {
    throw new ProtocolError('transaction must contain exactly one canonical BTCS L1 deposit intent')
  }
  if (intents[0].recipientAddress !== expectedRecipient) {
    throw new ProtocolError('deposit intent recipient does not match the expected L2 recipient')
  }
  if (paymentOutputs.length !== 1) {
    throw new ProtocolError('transaction must contain exactly one payment to the configured deposit script')
  }

  const header = asRecord(
    await rpc.getBlockHeader(request.blockHash),
    'block header',
  )

  if (header.hash !== request.blockHash) {
    throw new ProtocolError('block header RPC returned a different block hash')
  }
  if (!Number.isSafeInteger(header.height) || (header.height as number) < 0) {
    throw new ProtocolError('block header has an invalid height')
  }
  if (!Number.isSafeInteger(header.confirmations) || (header.confirmations as number) < 0) {
    throw new ProtocolError('block header has an invalid confirmation count')
  }
  if ((header.confirmations as number) < request.requiredConfirmations) {
    throw new ProtocolError('BTCS L1 deposit has insufficient confirmations')
  }
  if (
    !Number.isSafeInteger(tx.confirmations) ||
    (tx.confirmations as number) < 0 ||
    tx.confirmations !== header.confirmations
  ) {
    throw new ProtocolError('transaction and block header confirmation counts disagree')
  }

  const payment = paymentOutputs[0]
  return {
    format: 'btcs-l2-btcs-l1-deposit-verification',
    version: 1,
    verificationModel: 'trusted-btcs-core-rpc',
    depositId: `${request.txid}:${payment.outputIndex}`,
    txid: request.txid,
    blockHash: request.blockHash,
    blockHeight: header.height as number,
    confirmations: header.confirmations as number,
    activeChain: true,
    recipientAddress: expectedRecipient,
    amountSats: payment.amountSats,
    depositOutputIndex: payment.outputIndex,
    depositVerified: true,
  }
}
