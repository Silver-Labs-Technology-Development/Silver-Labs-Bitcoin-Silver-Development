import { UpstreamError } from './rpc.mjs'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const QUANTITY_RE = /^0x(?:0|[1-9a-f][0-9a-f]*)$/i

function parseQuantity(value, label) {
  if (typeof value !== 'string' || !QUANTITY_RE.test(value)) {
    throw new UpstreamError('invalid_response', `${label} is not a hex quantity`)
  }
  const numeric = BigInt(value)
  if (numeric > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UpstreamError('invalid_response', `${label} exceeds the safe integer range`)
  }
  return Number(numeric)
}

function parseHexString(value, label) {
  if (typeof value !== 'string' || !/^0x[0-9a-f]*$/i.test(value)) {
    throw new UpstreamError('invalid_response', `${label} is not hex data`)
  }
  return value.toLowerCase()
}

export function normalizeL2Address(value) {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw new UpstreamError('invalid_request', 'L2 account must be a 20-byte 0x-prefixed EVM address')
  }
  return value.toLowerCase()
}

export function createL2Reader(rpc) {
  return {
    async readNetwork() {
      const [chainIdRaw, blockNumberRaw, clientVersion, netVersion, listening] =
        await Promise.all([
          rpc.call('eth_chainId'),
          rpc.call('eth_blockNumber'),
          rpc.call('web3_clientVersion'),
          rpc.call('net_version'),
          rpc.call('net_listening'),
        ])
      const chainId = parseQuantity(chainIdRaw, 'L2 chain ID')
      const blockNumber = parseQuantity(blockNumberRaw, 'L2 block number')
      if (typeof clientVersion !== 'string') {
        throw new UpstreamError('invalid_response', 'L2 client version is malformed')
      }
      if (typeof netVersion !== 'string') {
        throw new UpstreamError('invalid_response', 'L2 network version is malformed')
      }
      if (typeof listening !== 'boolean') {
        throw new UpstreamError('invalid_response', 'L2 listening state is malformed')
      }
      return {
        chainId,
        chainIdHex: `0x${chainId.toString(16)}`,
        blockNumber,
        clientVersion,
        networkVersion: netVersion,
        listening,
      }
    },

    async readAccount(addressValue) {
      const address = normalizeL2Address(addressValue)
      const [balanceRaw, nonceRaw, codeRaw, blockNumberRaw] = await Promise.all([
        rpc.call('eth_getBalance', [address, 'latest']),
        rpc.call('eth_getTransactionCount', [address, 'latest']),
        rpc.call('eth_getCode', [address, 'latest']),
        rpc.call('eth_blockNumber'),
      ])
      if (typeof balanceRaw !== 'string' || !QUANTITY_RE.test(balanceRaw)) {
        throw new UpstreamError('invalid_response', 'L2 account balance is not a hex quantity')
      }
      const balanceWei = BigInt(balanceRaw).toString(10)
      const nonce = parseQuantity(nonceRaw, 'L2 account nonce')
      const code = parseHexString(codeRaw, 'L2 account code')
      const blockNumber = parseQuantity(blockNumberRaw, 'L2 block number')
      return {
        address,
        balanceWei,
        nonce,
        isContract: code.length > 2,
        blockNumber,
        readOnly: true,
      }
    },
  }
}
