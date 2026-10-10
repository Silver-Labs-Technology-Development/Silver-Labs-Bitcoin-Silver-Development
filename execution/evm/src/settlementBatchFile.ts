import { readFile, stat, writeFile } from 'node:fs/promises'
import { ProtocolError } from './blockProcessor.js'
import {
  verifyEvmSettlementBatch,
  type EvmSettlementBatch,
} from './settlementBatch.js'

export const MAX_SETTLEMENT_BATCH_FILE_BYTES = 64 * 1024 * 1024

export type SettlementBatchAnchors = Readonly<{
  previousCommitment: string
  parentHash: string
  startHeight: string
}>

export async function exportEvmSettlementBatchFile(
  path: string,
  batch: unknown,
  anchors: SettlementBatchAnchors,
): Promise<EvmSettlementBatch> {
  const verified = verifyEvmSettlementBatch(
    batch,
    anchors.previousCommitment,
    anchors.parentHash,
    anchors.startHeight,
  )

  const contents = `${JSON.stringify(verified, null, 2)}\n`
  if (Buffer.byteLength(contents, 'utf8') > MAX_SETTLEMENT_BATCH_FILE_BYTES) {
    throw new ProtocolError('settlement batch file exceeds the size limit')
  }

  await writeFile(path, contents, { encoding: 'utf8' })
  return verified
}

export async function importEvmSettlementBatchFile(
  path: string,
  anchors: SettlementBatchAnchors,
): Promise<EvmSettlementBatch> {
  let fileSize: number

  try {
    fileSize = (await stat(path)).size
  } catch {
    throw new ProtocolError('settlement batch file cannot be accessed')
  }

  if (fileSize > MAX_SETTLEMENT_BATCH_FILE_BYTES) {
    throw new ProtocolError('settlement batch file exceeds the size limit')
  }

  let contents: string
  try {
    contents = await readFile(path, 'utf8')
  } catch {
    throw new ProtocolError('settlement batch file cannot be read')
  }

  if (Buffer.byteLength(contents, 'utf8') > MAX_SETTLEMENT_BATCH_FILE_BYTES) {
    throw new ProtocolError('settlement batch file exceeds the size limit')
  }

  let value: unknown
  try {
    value = JSON.parse(contents)
  } catch {
    throw new ProtocolError('settlement batch file contains invalid JSON')
  }

  return verifyEvmSettlementBatch(
    value,
    anchors.previousCommitment,
    anchors.parentHash,
    anchors.startHeight,
  )
}
