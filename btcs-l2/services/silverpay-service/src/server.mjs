import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { loadConfig, publicConfig } from './config.mjs'
import { createL1Reader } from './l1.mjs'
import { createL2Reader, normalizeL2Address } from './l2.mjs'
import { createRpcClient, UpstreamError } from './rpc.mjs'

const SERVICE_NAME = 'btcs-l2-silverpay-service'
const SERVICE_VERSION = '0.1.0'
const STATUS_FORMAT = 'btcs-l2-silverpay-status'
const WALLET_FORMAT = 'btcs-l2-silverpay-l1-wallet'
const ACCOUNT_FORMAT = 'btcs-l2-silverpay-l2-account'
const NETWORK_FORMAT = 'btcs-l2-silverpay-network'
const ACCOUNT_PREFIX = '/api/silverpay/l2/account/'

function resultEnvelope(value) {
  return { ok: true, data: value }
}

function errorEnvelope(error) {
  if (error instanceof UpstreamError) {
    return { ok: false, error: { code: error.code, message: error.message } }
  }
  return { ok: false, error: { code: 'internal_error', message: 'unexpected service error' } }
}

async function safeResult(promise) {
  try {
    return resultEnvelope(await promise)
  } catch (error) {
    return errorEnvelope(error)
  }
}

function setSecurityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('X-Frame-Options', 'DENY')
}

function applyCors(request, response, allowedOrigins) {
  const origin = request.headers.origin
  if (origin === undefined) return true
  if (!allowedOrigins.includes(origin)) return false
  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type')
  response.setHeader('Access-Control-Max-Age', '600')
  return true
}

function sendJson(response, statusCode, payload) {
  const body = JSON.stringify(payload)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function nowIso() {
  return new Date().toISOString()
}

function createCache(ttlMs) {
  const entries = new Map()
  return {
    async get(key, load) {
      if (ttlMs <= 0) return load()
      const current = entries.get(key)
      if (current !== undefined && Date.now() - current.loadedAt < ttlMs) {
        return current.value
      }
      const value = await load()
      entries.set(key, { loadedAt: Date.now(), value })
      return value
    },
  }
}

export function createSilverPayServer({ config, l1, l2, logger = console }) {
  const cache = createCache(config.cacheTtlMs)

  const statusPayload = () =>
    cache.get('status', async () => {
      const [l1Network, l1Wallet, l2Network] = await Promise.all([
        safeResult(l1.readNetwork()),
        safeResult(l1.readWallet()),
        safeResult(l2.readNetwork()),
      ])
      return {
        format: STATUS_FORMAT,
        version: 1,
        observedAt: nowIso(),
        readOnly: true,
        l1: {
          ok: l1Network.ok && l1Wallet.ok,
          network: l1Network,
          wallet: l1Wallet,
        },
        l2: {
          ok: l2Network.ok,
          network: l2Network,
        },
      }
    })

  const walletPayload = () =>
    cache.get('l1-wallet', async () => {
      const observedAt = nowIso()
      try {
        return {
          format: WALLET_FORMAT,
          version: 1,
          ok: true,
          observedAt,
          readOnly: true,
          data: await l1.readWallet(),
        }
      } catch (error) {
        return {
          format: WALLET_FORMAT,
          version: 1,
          ok: false,
          observedAt,
          readOnly: true,
          error: errorEnvelope(error).error,
        }
      }
    })

  const l1NetworkPayload = () =>
    cache.get('l1-network', async () => {
      const observedAt = nowIso()
      const network = await safeResult(l1.readNetwork())
      return {
        format: NETWORK_FORMAT,
        version: 1,
        ok: network.ok,
        observedAt,
        readOnly: true,
        ...(network.ok ? { data: network.data } : { error: network.error }),
      }
    })

  const l2NetworkPayload = () =>
    cache.get('l2-network', async () => {
      const observedAt = nowIso()
      const network = await safeResult(l2.readNetwork())
      return {
        format: NETWORK_FORMAT,
        version: 1,
        ok: network.ok,
        observedAt,
        readOnly: true,
        ...(network.ok ? { data: network.data } : { error: network.error }),
      }
    })

  const accountPayload = (address) =>
    cache.get(`l2-account:${address}`, async () => {
      const observedAt = nowIso()
      try {
        return {
          format: ACCOUNT_FORMAT,
          version: 1,
          ok: true,
          observedAt,
          readOnly: true,
          data: await l2.readAccount(address),
        }
      } catch (error) {
        return {
          format: ACCOUNT_FORMAT,
          version: 1,
          ok: false,
          observedAt,
          readOnly: true,
          error: errorEnvelope(error).error,
        }
      }
    })

  const server = createServer(async (request, response) => {
    setSecurityHeaders(response)

    if (!applyCors(request, response, config.allowedOrigins)) {
      sendJson(response, 403, {
        ok: false,
        error: { code: 'origin_not_allowed', message: 'request origin is not allowed' },
      })
      return
    }

    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET, OPTIONS')
      sendJson(response, 405, {
        ok: false,
        error: { code: 'method_not_allowed', message: 'only read-only GET requests are supported' },
      })
      return
    }

    let pathname
    try {
      pathname = new URL(request.url || '/', 'http://silverpay.local').pathname
    } catch {
      sendJson(response, 400, {
        ok: false,
        error: { code: 'invalid_request', message: 'request URL is malformed' },
      })
      return
    }

    try {
      if (pathname === '/healthz') {
        sendJson(response, 200, {
          ok: true,
          service: SERVICE_NAME,
          version: SERVICE_VERSION,
          observedAt: nowIso(),
          readOnly: true,
          config: publicConfig(config),
        })
        return
      }

      if (pathname === '/api/silverpay/status') {
        sendJson(response, 200, await statusPayload())
        return
      }

      if (pathname === '/api/silverpay/l1/wallet') {
        const payload = await walletPayload()
        sendJson(response, payload.ok ? 200 : 503, payload)
        return
      }

      if (pathname === '/api/silverpay/l1/network') {
        const payload = await l1NetworkPayload()
        sendJson(response, payload.ok ? 200 : 503, payload)
        return
      }

      if (pathname === '/api/silverpay/l2/network') {
        const payload = await l2NetworkPayload()
        sendJson(response, payload.ok ? 200 : 503, payload)
        return
      }

      if (pathname.startsWith(ACCOUNT_PREFIX)) {
        let address
        try {
          address = normalizeL2Address(
            decodeURIComponent(pathname.slice(ACCOUNT_PREFIX.length)),
          )
        } catch {
          sendJson(response, 400, {
            ok: false,
            error: {
              code: 'invalid_request',
              message: 'L2 account must be a 20-byte 0x-prefixed EVM address',
            },
          })
          return
        }
        const payload = await accountPayload(address)
        const invalid = payload.error?.code === 'invalid_request'
        sendJson(response, payload.ok ? 200 : invalid ? 400 : 503, payload)
        return
      }

      sendJson(response, 404, {
        ok: false,
        error: { code: 'not_found', message: 'route not found' },
      })
    } catch (error) {
      logger.error?.('silverpay request failed', error)
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal_error', message: 'unexpected service error' },
      })
    }
  })

  return {
    server,
    statusPayload,
    walletPayload,
    accountPayload,
    async listen() {
      await new Promise((resolve, reject) => {
        server.once('error', reject)
        server.listen({ host: config.bindHost, port: config.port }, () => {
          server.off('error', reject)
          resolve()
        })
      })
      return server.address()
    },
    async close() {
      if (!server.listening) return
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

export function createReaders(config) {
  const l1Rpc = createRpcClient({
    url: config.l1.url,
    username: config.l1.auth?.username,
    password: config.l1.auth?.password,
    timeoutMs: config.l1.timeoutMs,
    label: 'L1',
    allowedMethods: [
      'getblockchaininfo',
      'getnetworkinfo',
      'getwalletinfo',
      'getbalances',
      'listunspent',
    ],
  })
  return {
    l1: createL1Reader(l1Rpc),
    l2: createL2Reader({
      endpoint: config.l2.url,
      timeoutMs: config.l2.timeoutMs,
    }),
  }
}

export async function startFromEnv(env = process.env) {
  const config = loadConfig(env)
  const readers = createReaders(config)
  const app = createSilverPayServer({ config, ...readers })
  const address = await app.listen()
  return { app, config, address }
}

if (
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  startFromEnv().then(
    ({ config, address }) => {
      const host = typeof address === 'object' && address !== null ? address.address : config.bindHost
      const port = typeof address === 'object' && address !== null ? address.port : config.port
      process.stdout.write(`BTCS SilverPay read-only service listening at http://${host}:${port}\n`)
      process.stdout.write('  accounts: GET /api/silverpay/status\n')
      process.stdout.write('  L1 wallet: GET /api/silverpay/l1/wallet\n')
      process.stdout.write('  L2 account: GET /api/silverpay/l2/account/<0x-address>\n')
    },
    (error) => {
      process.stderr.write(`SilverPay service failed to start: ${error.message}\n`)
      process.exitCode = 1
    },
  )
}
