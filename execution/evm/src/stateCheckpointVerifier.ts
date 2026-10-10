import type { CanonicalReadView } from './blockProcessor.js'
import type { StateCheckpointManifest } from './stateCheckpoint.js'

export type StateCheckpointVerification = Readonly<{
  verified: true
  profileId: string
  blockHeight: string
  blockHash: string
  stateRoot: string
}>

/**
 * Compare checkpoint metadata with a replay-verified canonical read view.
 *
 * This verifies local canonical execution history only. It does not prove
 * BTCS L1 settlement, finality, or the authenticity of a trusted anchor.
 */
export function verifyStateCheckpointAgainstCanonical(
  manifest: StateCheckpointManifest,
  canonicalView: CanonicalReadView,
  expectedProfileId: string,
): StateCheckpointVerification {
  if (
    typeof expectedProfileId !== 'string' ||
    expectedProfileId.length === 0 ||
    manifest.profileId !== expectedProfileId
  ) {
    throw new Error(
      `Checkpoint profile mismatch: expected ${expectedProfileId}, got ${manifest.profileId}`,
    )
  }

  if (!/^(0|[1-9][0-9]*)$/.test(manifest.blockHeight)) {
    throw new Error('Checkpoint has an invalid block height')
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(manifest.blockHash)) {
    throw new Error('Checkpoint has an invalid block hash')
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(manifest.stateRoot)) {
    throw new Error('Checkpoint has an invalid state root')
  }

  const block = canonicalView.getCanonicalBlockByHash(manifest.blockHash)

  if (block === undefined) {
    throw new Error(
      `Checkpoint block is not in canonical history: ${manifest.blockHash}`,
    )
  }

  if (block.summary.number !== manifest.blockHeight) {
    throw new Error(
      `Checkpoint height mismatch: expected canonical height ${block.summary.number}, got ${manifest.blockHeight}`,
    )
  }

  if (block.summary.hash.toLowerCase() !== manifest.blockHash.toLowerCase()) {
    throw new Error('Checkpoint block hash does not match canonical history')
  }

  if (block.summary.stateRoot.toLowerCase() !== manifest.stateRoot.toLowerCase()) {
    throw new Error(
      `Checkpoint state-root mismatch: canonical ${block.summary.stateRoot}, checkpoint ${manifest.stateRoot}`,
    )
  }

  return {
    verified: true,
    profileId: manifest.profileId,
    blockHeight: block.summary.number,
    blockHash: block.summary.hash,
    stateRoot: block.summary.stateRoot,
  }
}
