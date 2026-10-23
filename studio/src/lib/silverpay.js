const DEFAULT_SERVICE_URL =
  import.meta.env?.VITE_SILVERPAY_SERVICE_URL || 'http://127.0.0.1:3002'

const STATUS_FORMAT = 'btcs-l2-silverpay-status'
const WALLET_FORMAT = 'btcs-l2-silverpay-l1-wallet'
const ACCOUNT_FORMAT = 'btcs-l2-silverpay-l2-account'
const ADDRESS_RE = /^0x[0-9a-f]{40}$/

export class SilverPayError extends Error {
  constructor(code, message, options) {
    super(message, options)
    this.name = 'SilverPayError'
    this.code = code
  }
}

function asObject(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SilverPayError('invalid_response', `${label} is malformed`)
  }
  return value
}

function requireString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SilverPayError('invalid_response', `${label} is missing`)
  }
  return value
}

function requireInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new SilverPayError('invalid_response', `${label} is invalid`)
  }
  return value
}

function requireDigits(value, label) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new SilverPayError('invalid_response', `${label} is not an integer amount`)
  }
  return value
}

function parseEnvelope(value, label) {
  const envelope = asObject(value, label)
  if (typeof envelope.ok !== 'boolean') {
    throw new SilverPayError('invalid_response', `${label} has no status`)
  }
  if (envelope.ok) {
    return { ok: true, data: asObject(envelope.data, `${label}.data`) }
  }
  const error = asObject(envelope.error, `${label}.error`)
  return {
    ok: false,
    error: {
      code: requireString(error.code, `${label}.error.code`),
      message: requireString(error.message, `${label}.error.message`),
    },
  }
}

function requireObservedAt(value) {
  requireString(value, 'observedAt')
  if (Number.isNaN(Date.parse(value))) {
    throw new SilverPayError('invalid_response', 'observedAt is not a timestamp')
  }
  return value
}

export function parseStatus(value) {
  const body = asObject(value, 'SilverPay status')
  if (body.format !== STATUS_FORMAT || body.version !== 1) {
    throw new SilverPayError('invalid_response', 'SilverPay status format is unsupported')
  }
  const l1 = asObject(body.l1, 'SilverPay status.l1')
  const l2 = asObject(body.l2, 'SilverPay status.l2')
  return {
    format: STATUS_FORMAT,
    version: 1,
    observedAt: requireObservedAt(body.observedAt),
    readOnly: body.readOnly === true,
    l1: {
      ok: l1.ok === true,
      network: parseEnvelope(l1.network, 'status.l1.network'),
      wallet: parseEnvelope(l1.wallet, 'status.l1.wallet'),
    },
    l2: {
      ok: l2.ok === true,
      network: parseEnvelope(l2.network, 'status.l2.network'),
    },
  }
}

export function parseWallet(value) {
  const body = asObject(value, 'SilverPay L1 wallet')
  if (body.format !== WALLET_FORMAT || body.version !== 1) {
    throw new SilverPayError('invalid_response', 'SilverPay wallet format is unsupported')
  }
  const data = asObject(body.data, 'SilverPay wallet data')
  if (!Array.isArray(data.utxos)) {
    throw new SilverPayError('invalid_response', 'SilverPay wallet UTXOs are malformed')
  }
  return {
    format: WALLET_FORMAT,
    version: 1,
    observedAt: requireObservedAt(body.observedAt),
    readOnly: body.readOnly === true,
    data: {
      walletName: requireString(data.walletName, 'wallet name'),
      balanceSats: requireDigits(data.balanceSats, 'wallet balance'),
      trustedSats: requireDigits(data.trustedSats, 'trusted balance'),
      pendingSats: requireDigits(data.pendingSats, 'pending balance'),
      immatureSats: requireDigits(data.immatureSats, 'immature balance'),
      utxoCount: requireInteger(data.utxoCount, 'UTXO count'),
      utxoTotal: requireInteger(data.utxoTotal, 'UTXO total'),
      truncated: data.truncated === true,
      readOnly: data.readOnly === true,
      utxos: data.utxos.map((raw, index) => {
        const utxo = asObject(raw, `UTXO ${index}`)
        return {
          txid: requireString(utxo.txid, `UTXO ${index} txid`),
          vout: requireInteger(utxo.vout, `UTXO ${index} vout`),
          address: typeof utxo.address === 'string' ? utxo.address : null,
          label: typeof utxo.label === 'string' ? utxo.label : '',
          amountSats: requireDigits(utxo.amountSats, `UTXO ${index} amount`),
          confirmations: requireInteger(utxo.confirmations, `UTXO ${index} confirmations`),
          spendable: utxo.spendable === true,
          solvable: utxo.solvable === true,
          safe: utxo.safe === true,
        }
      }),
    },
  }
}

export function parseAccount(value, expectedAddress) {
  const body = asObject(value, 'SilverPay L2 account')
  if (body.format !== ACCOUNT_FORMAT || body.version !== 1) {
    throw new SilverPayError('invalid_response', 'SilverPay account format is unsupported')
  }
  const data = asObject(body.data, 'SilverPay account data')
  const address = requireString(data.address, 'account address').toLowerCase()
  if (!ADDRESS_RE.test(address)) {
    throw new SilverPayError('invalid_response', 'account address is malformed')
  }
  if (expectedAddress !== undefined && address !== expectedAddress.toLowerCase()) {
    throw new SilverPayError('invalid_response', 'account response address does not match the request')
  }
  return {
    format: ACCOUNT_FORMAT,
    version: 1,
    observedAt: requireObservedAt(body.observedAt),
    readOnly: body.readOnly === true,
    data: {
      address,
      balanceWei: requireDigits(data.balanceWei, 'account balance'),
      nonce: requireInteger(data.nonce, 'account nonce'),
      isContract: data.isContract === true,
      blockNumber: requireInteger(data.blockNumber, 'account block number'),
      readOnly: data.readOnly === true,
    },
  }
}

export function formatDecimal(value, decimals, maxFractionDigits = decimals) {
  const digits = requireDigits(value, 'amount')
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new Error('decimals must be a safe non-negative integer')
  }
  const padded = digits.padStart(decimals + 1, '0')
  const whole = padded.slice(0, padded.length - decimals)
  let fraction = decimals === 0 ? '' : padded.slice(padded.length - decimals)
  if (maxFractionDigits < fraction.length) {
    fraction = fraction.slice(0, maxFractionDigits)
  }
  fraction = fraction.replace(/0+$/, '')
  return fraction.length > 0 ? `${whole}.${fraction}` : whole
}

export function formatSats(value) {
  return formatDecimal(value, 8)
}

export function formatWei(value) {
  return formatDecimal(value, 18)
}

export function isStale(observedAt, now = Date.now(), staleAfterMs = 30_000) {
  const time = Date.parse(observedAt)
  if (Number.isNaN(time)) return true
  return now - time > staleAfterMs
}

export function shorten(value, head = 8, tail = 6) {
  if (typeof value !== 'string' || value.length <= head + tail + 3) return value || ''
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function createSilverPayClient(options = {}) {
  const baseUrl = String(options.baseUrl ?? DEFAULT_SERVICE_URL).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))

  async function requestJson(path) {
    let response
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })
    } catch (error) {
      throw new SilverPayError(
        'network_error',
        'SilverPay read-only service is unavailable',
        { cause: error },
      )
    }
    let body
    try {
      body = await response.json()
    } catch (error) {
      throw new SilverPayError(
        'invalid_response',
        'SilverPay service returned invalid JSON',
        { cause: error },
      )
    }
    if (!response.ok) {
      const upstream = body?.error
      throw new SilverPayError(
        typeof upstream?.code === 'string' ? upstream.code : `http_${response.status}`,
        typeof upstream?.message === 'string'
          ? upstream.message
          : `SilverPay service returned HTTP ${response.status}`,
      )
    }
    return body
  }

  return {
    baseUrl,
    async status() {
      return parseStatus(await requestJson('/api/silverpay/status'))
    },
    async wallet() {
      return parseWallet(await requestJson('/api/silverpay/l1/wallet'))
    },
    async account(address) {
      if (typeof address !== 'string' || !ADDRESS_RE.test(address.toLowerCase())) {
        throw new SilverPayError('invalid_request', 'enter a 20-byte 0x-prefixed L2 address')
      }
      const normalized = address.toLowerCase()
      return parseAccount(
        await requestJson(`/api/silverpay/l2/account/${normalized}`),
        normalized,
      )
    },
  }
}
