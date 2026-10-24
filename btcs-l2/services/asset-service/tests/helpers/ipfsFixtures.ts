/**
 * Helpers that emulate the parts of a Kubo IPFS HTTP API that the asset
 * service depends on, so the provider can be tested without a real node.
 */

import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'

function base32Encode(bytes: Uint8Array): string {
  let output = ''
  let buffer = 0
  let bits = 0
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      output += BASE32_ALPHABET[(buffer >>> bits) & 31]
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(buffer << (5 - bits)) & 31]
  return output
}

function encodeVarint(value: number): number[] {
  const bytes: number[] = []
  let remaining = value
  while (remaining >= 0x80) {
    bytes.push((remaining & 0x7f) | 0x80)
    remaining = Math.floor(remaining / 128)
  }
  bytes.push(remaining)
  return bytes
}

/**
 * Build a CIDv1 (base32, raw codec, sha2-256 multihash) for the given bytes.
 */
export function buildCidV1ForContent(data: Uint8Array): string {
  const digest = createHash('sha256').update(data).digest()
  const bytes = Uint8Array.from([
    ...encodeVarint(0x01),
    ...encodeVarint(0x72),
    ...encodeVarint(0x12),
    ...encodeVarint(digest.length),
    ...digest,
  ])
  return `b${base32Encode(bytes)}`
}

export type FakeIpfsOptions = {
  /** Serve the uploaded bytes unchanged. */
  corruptContent?: boolean
  /** Report the content as unpinned. */
  unpinned?: boolean
  /** Return a CID that does not address the uploaded bytes. */
  wrongCid?: boolean
}

export type FakeIpfs = {
  url: string
  server: Server
  close: () => Promise<void>
  /** Authorization headers seen by the node. */
  authorizations: string[]
}

export async function startFakeIpfsNode(options: FakeIpfsOptions = {}): Promise<FakeIpfs> {
  const stored = new Map<string, Uint8Array>()
  const authorizations: string[] = []

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    void handle(request, response).catch(() => {
      response.writeHead(500)
      response.end()
    })
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    authorizations.push(String(request.headers.authorization ?? ''))
    const body = await readAll(request)

    if (url.pathname === '/api/v0/add') {
      const form = await new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': String(request.headers['content-type']) },
        body: new Uint8Array(body),
      }).formData()
      const file = form.get('file')
      if (file === null || typeof file === 'string') {
        response.writeHead(400)
        response.end('missing file')
        return
      }
      const data = new Uint8Array(await file.arrayBuffer())
      const cid = options.wrongCid === true ? buildCidV1ForContent(Buffer.from('other content')) : buildCidV1ForContent(data)
      stored.set(cid, data)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(`${JSON.stringify({ Name: 'file', Hash: cid, Size: String(data.byteLength) })}\n`)
      return
    }

    if (url.pathname === '/api/v0/pin/ls') {
      const cid = url.searchParams.get('arg') ?? ''
      const keys = options.unpinned === true ? {} : { [cid]: { Type: 'recursive' } }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ Keys: keys }))
      return
    }

    if (url.pathname === '/api/v0/cat') {
      const cid = url.searchParams.get('arg') ?? ''
      const data = stored.get(cid)
      if (data === undefined) {
        response.writeHead(500)
        response.end('not found')
        return
      }
      const payload = options.corruptContent === true ? Buffer.from('tampered') : Buffer.from(data)
      response.writeHead(200, { 'content-type': 'application/octet-stream' })
      response.end(payload)
      return
    }

    response.writeHead(404)
    response.end()
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0, exclusive: true }, () => resolve())
  })
  const address = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${address.port}`,
    server,
    authorizations,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

async function readAll(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk as Buffer))
  }
  return Buffer.concat(chunks)
}
