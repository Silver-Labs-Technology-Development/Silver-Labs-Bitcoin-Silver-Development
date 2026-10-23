import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])
const DEFAULT_ALLOWED_ORIGINS = [
  'http://127.0.0.1:3000',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://localhost:5173',
]

function parseUrl(value, name, { loopbackOnly }) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be a valid URL`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`)
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error(`${name} must not contain embedded credentials`)
  }
  if (url.search !== '' || url.hash !== '') {
    throw new Error(`${name} must not contain a query string or fragment`)
  }
  if (loopbackOnly && !LOOPBACK_HOSTS.has(url.hostname)) {
    throw new Error(`${name} must point at a loopback host`)
  }
  return url.toString().replace(/\/$/, '')
}

function positiveInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error(`${name} must be a positive integer`)
  }
  return Number(value)
}

function nonNegativeInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return Number(value)
}

function readCookie(cookieFile) {
  const cookie = readFileSync(cookieFile, 'utf8').trim()
  const separator = cookie.indexOf(':')
  if (separator < 1 || separator === cookie.length - 1) {
    throw new Error('L1 RPC cookie file has an invalid format')
  }
  return {
    username: cookie.slice(0, separator),
    password: cookie.slice(separator + 1),
  }
}

function resolveL1Auth(env) {
  const username = env.SILVERPAY_L1_RPC_USER
  const password = env.SILVERPAY_L1_RPC_PASS
  if ((username === undefined) !== (password === undefined)) {
    throw new Error('SILVERPAY_L1_RPC_USER and SILVERPAY_L1_RPC_PASS must be provided together')
  }
  if (username !== undefined && password !== undefined) {
    if (username.length === 0 || password.length === 0) {
      throw new Error('L1 RPC credentials must not be empty')
    }
    return { username, password }
  }

  const explicitCookie = env.SILVERPAY_L1_COOKIE_FILE
  const datadir = env.SILVERPAY_L1_DATADIR
  const cookieFile = explicitCookie || (datadir ? join(datadir, 'regtest', '.cookie') : undefined)
  if (!cookieFile) return undefined
  return readCookie(cookieFile)
}

export function loadConfig(env = process.env) {
  const auth = resolveL1Auth(env)
  const origins = (env.SILVERPAY_ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
  for (const origin of origins) {
    try {
      const parsed = new URL(origin)
      if (parsed.origin !== origin) throw new Error()
    } catch {
      throw new Error(`SILVERPAY_ALLOWED_ORIGINS contains an invalid origin: ${origin}`)
    }
  }

  const bindHost = env.SILVERPAY_BIND_HOST || '127.0.0.1'
  if (!LOOPBACK_HOSTS.has(bindHost)) {
    throw new Error('SILVERPAY_BIND_HOST must be a loopback host')
  }
  const port = positiveInteger(env.SILVERPAY_PORT, 3002, 'SILVERPAY_PORT')
  if (port > 65535) throw new Error('SILVERPAY_PORT is out of range')

  return {
    l1: {
      url: parseUrl(env.SILVERPAY_L1_RPC_URL || 'http://127.0.0.1:18443', 'SILVERPAY_L1_RPC_URL', {
        loopbackOnly: true,
      }),
      auth,
      timeoutMs: positiveInteger(env.SILVERPAY_L1_TIMEOUT_MS, 5000, 'SILVERPAY_L1_TIMEOUT_MS'),
    },
    l2: {
      url: parseUrl(env.SILVERPAY_L2_RPC_URL || 'http://127.0.0.1:8545', 'SILVERPAY_L2_RPC_URL', {
        loopbackOnly: true,
      }),
      timeoutMs: positiveInteger(env.SILVERPAY_L2_TIMEOUT_MS, 5000, 'SILVERPAY_L2_TIMEOUT_MS'),
    },
    bindHost,
    port,
    allowedOrigins: origins,
    cacheTtlMs: nonNegativeInteger(env.SILVERPAY_CACHE_TTL_MS, 4000, 'SILVERPAY_CACHE_TTL_MS'),
  }
}

export function publicConfig(config) {
  return {
    bindHost: config.bindHost,
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    cacheTtlMs: config.cacheTtlMs,
    l1: { url: config.l1.url, auth: config.l1.auth ? 'configured' : 'none' },
    l2: { url: config.l2.url },
  }
}
