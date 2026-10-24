import { ProtocolError } from './blockProcessor.js'
import type { BtcsL1ConfirmationRpc } from './btcsL1Confirmation.js'

export type BtcsL1CoreRpcOptions = Readonly<{
  url: string
  username?: string
  password?: string
  timeoutMs?: number
}>

type JsonRpcResponse = Readonly<{
  result?: unknown
  error?: { code?: unknown; message?: unknown }
}>

export class BtcsL1CoreRpcClient implements BtcsL1ConfirmationRpc {
  private readonly url: URL
  private readonly authorization?: string
  private readonly timeoutMs: number
  private nextId = 1

  constructor(options: BtcsL1CoreRpcOptions) {
    let url: URL
    try {
      url = new URL(options.url)
    } catch {
      throw new ProtocolError('BTCS Core RPC URL is invalid')
    }

    if (
      url.protocol !== 'http:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      throw new ProtocolError('BTCS Core RPC must use an HTTP loopback URL without embedded credentials')
    }

    if (
      (options.username === undefined) !== (options.password === undefined) ||
      (options.username !== undefined &&
        (options.username.length === 0 || options.username.includes(':')))
    ) {
      throw new ProtocolError('BTCS Core RPC credentials are incomplete or invalid')
    }

    const timeoutMs = options.timeoutMs ?? 5_000
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      throw new ProtocolError('BTCS Core RPC timeout must be between 1 and 60000 milliseconds')
    }

    this.url = url
    this.timeoutMs = timeoutMs
    if (options.username !== undefined && options.password !== undefined) {
      this.authorization = `Basic ${Buffer.from(
        `${options.username}:${options.password}`,
        'utf8',
      ).toString('base64')}`
    }
  }

  async getRawTransaction(txid: string, blockHash: string): Promise<unknown> {
    return this.call('getrawtransaction', [txid, true, blockHash])
  }

  /**
   * Fetch a Bitcoin-style partial Merkle proof. The caller must verify the
   * returned bytes locally with `verifyBtcsL1TxOutProof`; the RPC result is not
   * trusted as proof on its own.
   */
  async getTxOutProof(txid: string, blockHash: string): Promise<unknown> {
    return this.call('gettxoutproof', [[txid], blockHash])
  }

  async getBlockHeader(blockHash: string): Promise<unknown> {
    return this.call('getblockheader', [blockHash, true])
  }

  async getBlockchainInfo(): Promise<unknown> {
    return this.call('getblockchaininfo', [])
  }

  async getBlockHash(height: number): Promise<unknown> {
    if (!Number.isSafeInteger(height) || height < 0) {
      throw new ProtocolError('BTCS block height must be a non-negative safe integer')
    }
    return this.call('getblockhash', [height])
  }

  async getBlock(blockHash: string): Promise<unknown> {
    return this.call('getblock', [blockHash, 2])
  }

  private async call(method: string, params: readonly unknown[]): Promise<unknown> {
    const id = this.nextId++
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    }
    if (this.authorization !== undefined) {
      headers.authorization = this.authorization
    }

    let response: Response
    try {
      response = await fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '1.0', id, method, params }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      })
    } catch {
      throw new ProtocolError('BTCS Core RPC request failed or timed out')
    }

    if (!response.ok) {
      throw new ProtocolError(`BTCS Core RPC returned HTTP ${response.status}`)
    }

    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new ProtocolError('BTCS Core RPC returned invalid JSON')
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw new ProtocolError('BTCS Core RPC response envelope is malformed')
    }

    const envelope = body as JsonRpcResponse & { id?: unknown }
    if (envelope.id !== id) {
      throw new ProtocolError('BTCS Core RPC response ID does not match the request')
    }

    if (envelope.error !== undefined && envelope.error !== null) {
      const message =
        typeof envelope.error.message === 'string'
          ? envelope.error.message.slice(0, 200)
          : 'unknown RPC error'
      throw new ProtocolError(`BTCS Core RPC method ${method} failed: ${message}`)
    }

    if (!Object.prototype.hasOwnProperty.call(envelope, 'result')) {
      throw new ProtocolError('BTCS Core RPC response has no result')
    }

    return envelope.result
  }
}
