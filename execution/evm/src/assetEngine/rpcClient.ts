import { AssetEngineError } from './errors.js'

type RpcBody = {
  result?: unknown
  error?: { code?: number; message?: string }
}

export async function rpcCall(url: string, method: string, params: readonly unknown[]): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
  } catch {
    throw new AssetEngineError(`RPC connection failed for ${method}`)
  }
  if (!response.ok) throw new AssetEngineError(`RPC HTTP ${response.status} for ${method}`)
  const body = await response.json() as RpcBody
  if (body.error !== undefined) {
    const message = body.error.message ?? `${method} failed`
    throw new AssetEngineError(message, body.error.code)
  }
  if (!Object.prototype.hasOwnProperty.call(body, 'result')) {
    throw new AssetEngineError(`${method} returned no result`)
  }
  return body.result
}

export async function optionalRpc(url: string, method: string, params: readonly unknown[]): Promise<unknown | undefined> {
  try {
    return await rpcCall(url, method, params)
  } catch (error) {
    if (error instanceof AssetEngineError && error.code === -32601) return undefined
    throw error
  }
}
