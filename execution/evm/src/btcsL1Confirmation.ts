import { ProtocolError } from './blockProcessor.js'
import { BTCS_L1_ANCHOR_MAGIC_HEX, decodeBtcsL1AnchorScript, encodeBtcsL1AnchorScript } from './btcsL1Anchor.js'

export type BtcsL1ConfirmationRpc = Readonly<{
  getRawTransaction(txid: string, blockHash: string): Promise<unknown>
  getBlockHeader(blockHash: string): Promise<unknown>
}>

export type BtcsL1ConfirmationRequest = Readonly<{
  txid: string
  blockHash: string
  batchHash: string
  requiredConfirmations: number
}>

export type BtcsL1ConfirmationReport = Readonly<{
  format: 'btcs-l2-btcs-l1-confirmation'
  version: 1
  verificationModel: 'trusted-btcs-core-rpc'
  txid: string
  blockHash: string
  blockHeight: number
  confirmations: number
  activeChain: true
  batchHash: string
  anchorVerified: true
}>

const HASH_RE = /^[0-9a-f]{64}$/

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProtocolError(`${label} RPC response is malformed`)
  }
  return value as Record<string, unknown>
}

export async function verifyBtcsL1AnchorConfirmation(
  rpc: BtcsL1ConfirmationRpc,
  request: BtcsL1ConfirmationRequest,
): Promise<BtcsL1ConfirmationReport> {
  if (
    !HASH_RE.test(request.txid) ||
    !HASH_RE.test(request.blockHash) ||
    !HASH_RE.test(request.batchHash)
  ) {
    throw new ProtocolError('txid, block hash, and batch hash must be 64 lowercase hex characters')
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
    throw new ProtocolError('transaction is not confirmed in the active chain')
  }
  if (!Array.isArray(tx.vout)) {
    throw new ProtocolError('transaction RPC response has no valid vout array')
  }

  const expectedScript = encodeBtcsL1AnchorScript(request.batchHash)
  let matchingAnchors = 0

  for (const output of tx.vout) {
    const outputRecord = asRecord(output, 'transaction output')
    const scriptPubKey = asRecord(outputRecord.scriptPubKey, 'scriptPubKey')
    const scriptHex = scriptPubKey.hex

    if (typeof scriptHex !== 'string' || !/^[0-9a-f]+$/.test(scriptHex)) {
      throw new ProtocolError('transaction output has malformed scriptPubKey hex')
    }

    // Reject malformed or altered scripts that claim this protocol marker.
    if (scriptHex.includes(BTCS_L1_ANCHOR_MAGIC_HEX)) {
      const anchor = decodeBtcsL1AnchorScript(scriptHex)
      if (anchor.batchHash !== request.batchHash) {
        throw new ProtocolError('L1 anchor batch hash does not match the expected batch')
      }
      if (scriptHex !== expectedScript) {
        throw new ProtocolError('L1 anchor script is not canonical')
      }
      matchingAnchors += 1
    }
  }

  if (matchingAnchors !== 1) {
    throw new ProtocolError('transaction must contain exactly one matching BTCS L1 anchor')
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
    throw new ProtocolError('BTCS L1 anchor has insufficient confirmations')
  }

  if (
    !Number.isSafeInteger(tx.confirmations) ||
    (tx.confirmations as number) < 0
  ) {
    throw new ProtocolError('transaction has an invalid confirmation count')
  }
  if (tx.confirmations !== header.confirmations) {
    throw new ProtocolError('transaction and block header confirmation counts disagree')
  }

  return {
    format: 'btcs-l2-btcs-l1-confirmation',
    version: 1,
    verificationModel: 'trusted-btcs-core-rpc',
    txid: request.txid,
    blockHash: request.blockHash,
    blockHeight: header.height as number,
    confirmations: header.confirmations as number,
    activeChain: true,
    batchHash: request.batchHash,
    anchorVerified: true,
  }
}
