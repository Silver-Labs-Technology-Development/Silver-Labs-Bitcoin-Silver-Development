export class AssetEngineError extends Error {
  readonly code: number | undefined

  constructor(message: string, code?: number) {
    super(message)
    this.name = 'AssetEngineError'
    this.code = code
  }
}

/** There is no bridge. Calling this is a deliberate refusal, not a transfer. */
export function refuseCrossChainLink(): never {
  throw new AssetEngineError(
    'Cross-chain linking and bridging are not implemented. A token deployed on one network is not deployed on another, and supply is not shared.',
  )
}

export const CROSS_CHAIN_BRIDGE = 'not-implemented' as const
