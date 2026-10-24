const MAX_ERROR_MESSAGE = 240

export class UpstreamError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'UpstreamError'
    this.code = code
  }
}

function sanitizeMessage(value) {
  if (typeof value !== 'string') return undefined
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (cleaned.length === 0) return undefined
  return cleaned.slice(0, MAX_ERROR_MESSAGE)
}

export function createRpcClient({ url, username, password, timeoutMs, allowedMethods, label }) {
  if (!Array.isArray(allowedMethods) || allowedMethods.length === 0) {
    throw new Error('RPC allowlist must not be empty')
  }
  const allowed = new Set(allowedMethods)
  const authorization =
    username !== undefined && password !== undefined
      ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
      : undefined
  let nextId = 1

  return {
    async call(method, params = []) {
      if (!allowed.has(method)) {
        throw new Error(`RPC method is not allowed: ${method}`)
      }
      const id = nextId++
      let response
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            ...(authorization ? { Authorization: authorization } : {}),
          },
          body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        throw new UpstreamError(
          'unavailable',
          `${label} RPC is unavailable`,
          { cause: error },
        )
      }

      if (!response.ok) {
        throw new UpstreamError(
          'unavailable',
          `${label} RPC returned HTTP ${response.status}`,
        )
      }
      let body
      try {
        body = await response.json()
      } catch (error) {
        throw new UpstreamError('invalid_response', `${label} RPC returned invalid JSON`, {
          cause: error,
        })
      }
      if (body === null || typeof body !== 'object' || Array.isArray(body)) {
        throw new UpstreamError('invalid_response', `${label} RPC returned a malformed response`)
      }
      if (body.id !== id) {
        throw new UpstreamError('invalid_response', `${label} RPC response ID does not match`)
      }
      if (body.error !== undefined) {
        const detail =
          sanitizeMessage(body.error?.message) ||
          (typeof body.error?.code === 'number' ? `error ${body.error.code}` : 'unknown error')
        throw new UpstreamError('rpc_error', `${label} RPC error: ${detail}`)
      }
      if (!Object.prototype.hasOwnProperty.call(body, 'result')) {
        throw new UpstreamError('invalid_response', `${label} RPC response has no result`)
      }
      return body.result
    },
  }
}
