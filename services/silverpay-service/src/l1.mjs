import { UpstreamError } from './rpc.mjs'

const HASH_RE = /^[0-9a-f]{64}$/
const MAX_UTXOS = 500

function asRecord(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new UpstreamError('invalid_response', `${label} is malformed`)
  }
  return value
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new UpstreamError('invalid_response', `${label} is not a non-negative integer`)
  }
  return value
}

export function coinsToSats(value) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new UpstreamError('invalid_response', 'coin amount is not numeric')
  }
  const text = typeof value === 'number' ? String(value) : value.trim()
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(text)) {
    throw new UpstreamError('invalid_response', 'coin amount is not a valid BTCS decimal')
  }
  const [whole, fraction = ''] = text.split('.')
  return (BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0'))).toString(10)
}

function sumSats(values) {
  return values.reduce((total, value) => total + BigInt(value), 0n).toString(10)
}

function validateNetworkInfo(value) {
  const info = asRecord(value, 'L1 network info')
  const chain = typeof info.chain === 'string' ? info.chain : undefined
  if (!chain) throw new UpstreamError('invalid_response', 'L1 network info has no chain name')
  return {
    chain,
    blocks: nonNegativeInteger(info.blocks, 'L1 block height'),
    headers: nonNegativeInteger(info.headers, 'L1 header height'),
    bestBlockHash: typeof info.bestblockhash === 'string' ? info.bestblockhash : null,
    difficulty:
      typeof info.difficulty === 'number' && Number.isFinite(info.difficulty)
        ? info.difficulty
        : null,
    verificationProgress:
      typeof info.verificationprogress === 'number' && Number.isFinite(info.verificationprogress)
        ? info.verificationprogress
        : null,
    initialBlockDownload: info.initialblockdownload === true,
    pruned: info.pruned === true,
    warnings: typeof info.warnings === 'string' ? info.warnings : '',
  }
}

function validatePeerInfo(value) {
  const info = asRecord(value, 'L1 peer info')
  return {
    subversion: typeof info.subversion === 'string' ? info.subversion : null,
    protocolVersion: Number.isSafeInteger(info.protocolversion) ? info.protocolversion : null,
    connections: Number.isSafeInteger(info.connections) ? info.connections : 0,
    networkActive: info.networkactive !== false,
  }
}

function validateUtxos(value) {
  if (!Array.isArray(value)) {
    throw new UpstreamError('invalid_response', 'L1 unspent output response is not an array')
  }
  const utxos = value.slice(0, MAX_UTXOS).map((raw, index) => {
    const utxo = asRecord(raw, `L1 unspent output ${index}`)
    if (typeof utxo.txid !== 'string' || !HASH_RE.test(utxo.txid)) {
      throw new UpstreamError('invalid_response', 'L1 unspent output has an invalid txid')
    }
    const vout = nonNegativeInteger(utxo.vout, 'L1 unspent output index')
    const amountSats = coinsToSats(utxo.amount)
    return {
      txid: utxo.txid,
      vout,
      address: typeof utxo.address === 'string' ? utxo.address : null,
      label: typeof utxo.label === 'string' ? utxo.label : '',
      amountSats,
      confirmations: nonNegativeInteger(utxo.confirmations, 'L1 UTXO confirmations'),
      spendable: utxo.spendable === true,
      solvable: utxo.solvable === true,
      safe: utxo.safe === true,
    }
  })
  return { utxos, truncated: value.length > MAX_UTXOS, total: value.length }
}

export function createL1Reader(rpc) {
  return {
    async readNetwork() {
      const [chainInfo, peerInfo] = await Promise.all([
        rpc.call('getblockchaininfo'),
        rpc.call('getnetworkinfo'),
      ])
      return {
        ...validateNetworkInfo(chainInfo),
        peer: validatePeerInfo(peerInfo),
      }
    },

    async readWallet() {
      const [wallet, balances, unspent] = await Promise.all([
        rpc.call('getwalletinfo'),
        rpc.call('getbalances'),
        rpc.call('listunspent', [0, 9_999_999]),
      ])
      const walletInfo = asRecord(wallet, 'L1 wallet info')
      const balanceInfo = asRecord(balances, 'L1 wallet balances')
      const mine = asRecord(balanceInfo.mine, 'L1 wallet balances.mine')
      const trustedSats = coinsToSats(mine.trusted ?? 0)
      const pendingSats = coinsToSats(mine.pending ?? 0)
      const immatureSats = coinsToSats(mine.immature ?? 0)
      const utxoInfo = validateUtxos(unspent)
      return {
        walletName:
          typeof walletInfo.walletname === 'string' ? walletInfo.walletname : 'default',
        balanceSats: sumSats([trustedSats, pendingSats, immatureSats]),
        trustedSats,
        pendingSats,
        immatureSats,
        utxoCount: utxoInfo.utxos.length,
        utxoTotal: utxoInfo.total,
        truncated: utxoInfo.truncated,
        utxos: utxoInfo.utxos,
        // Core wallet state is not spend readiness. Signing and broadcasting are
        // deliberately absent from this read-only service.
        readOnly: true,
      }
    },
  }
}
