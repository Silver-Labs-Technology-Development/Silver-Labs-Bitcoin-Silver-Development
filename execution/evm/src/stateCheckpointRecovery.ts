import type { CanonicalReadView } from './blockProcessor.js'
import {
  openStateCheckpoint,
  type StateCheckpointManifest,
} from './stateCheckpoint.js'
import {
  verifyStateCheckpointAgainstCanonical,
  type StateCheckpointVerification,
} from './stateCheckpointVerifier.js'

export type RecoveredStateCheckpoint = Readonly<{
  manifest: StateCheckpointManifest
  stateManager: Awaited<ReturnType<typeof openStateCheckpoint>>['stateManager']
  verification: StateCheckpointVerification
  close: () => Promise<void>
}>

/**
 * Open a persisted checkpoint only after its state root and block metadata
 * match the replay-verified local canonical history.
 *
 * This does not prove BTCS L1 settlement, finality, or trusted-anchor
 * authenticity. The caller remains responsible for choosing the correct
 * canonical view and expected execution profile.
 */
export async function recoverStateCheckpoint(
  checkpointDirectory: string,
  canonicalView: CanonicalReadView,
  expectedProfileId: string,
): Promise<RecoveredStateCheckpoint> {
  const checkpoint = await openStateCheckpoint(checkpointDirectory)

  try {
    const verification = verifyStateCheckpointAgainstCanonical(
      checkpoint.manifest,
      canonicalView,
      expectedProfileId,
    )

    return {
      manifest: checkpoint.manifest,
      stateManager: checkpoint.stateManager,
      verification,
      close: checkpoint.close,
    }
  } catch (error) {
    await checkpoint.close()
    throw error
  }
}
