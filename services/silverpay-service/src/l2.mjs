import {
  BTCS_L2_LOCAL,
  BtcsL2ClientError,
  createBtcsL2Client,
  JsonRpcError,
  NetworkIdentityValidationError,
  NetworkMismatchError,
  RpcProtocolError,
  RpcTransportError,
  UnsupportedNetworkIdentitySchemaError,
  UnsupportedNetworkProfileError,
} from '@silver-labs/btcs-l2-client'
import { UpstreamError } from './rpc.mjs'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function toSafeNumber(value, label) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new UpstreamError('invalid_response', `${label} exceeds the safe integer range`)
  }
  return Number(value)
}

function translateClientError(error) {
  if (error instanceof RpcTransportError) {
    return new UpstreamError('unavailable', error.message, { cause: error })
  }
  if (error instanceof JsonRpcError) {
    return new UpstreamError('rpc_error', `L2 RPC returned JSON-RPC error ${error.code}`, { cause: error })
  }
  if (error instanceof NetworkMismatchError) {
    return new UpstreamError('invalid_response', 'L2 RPC identity does not match the configured BTCS L2 local profile', {
      cause: error,
    })
  }
  if (error instanceof UnsupportedNetworkIdentitySchemaError) {
    return new UpstreamError(
      'invalid_response',
      `L2 RPC identity schema version ${String(error.schemaVersion)} is unsupported`,
      { cause: error },
    )
  }
  if (error instanceof UnsupportedNetworkProfileError) {
    return new UpstreamError('invalid_response', error.message, { cause: error })
  }
  if (error instanceof NetworkIdentityValidationError) {
    return new UpstreamError('invalid_response', error.message, { cause: error })
  }
  if (error instanceof RpcProtocolError) {
    return new UpstreamError('invalid_response', error.message, { cause: error })
  }
  if (error instanceof BtcsL2ClientError) {
    return new UpstreamError('invalid_response', error.message, { cause: error })
  }
  return error
}

async function fromClient(operation) {
  try {
    return await operation()
  } catch (error) {
    throw translateClientError(error)
  }
}

export function normalizeL2Address(value) {
  if (typeof value !== 'string' || !ADDRESS_RE.test(value)) {
    throw new UpstreamError('invalid_request', 'L2 account must be a 20-byte 0x-prefixed EVM address')
  }
  return value.toLowerCase()
}

export function createL2Reader({ endpoint, timeoutMs, fetchImpl, profile = BTCS_L2_LOCAL } = {}) {
  const rpc = createBtcsL2Client({
    endpoint,
    profile,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(fetchImpl === undefined ? {} : { fetchImpl }),
  })

  return {
    async readNetwork() {
      const identity = await fromClient(() => rpc.verifyNetwork())
      const [blockNumberRaw, networkVersion, listening] = await fromClient(() =>
        Promise.all([
          rpc.getBlockNumber(),
          rpc.getNetworkVersion(),
          rpc.isListening(),
        ]))
      const chainId = BigInt(identity.chainId)
      if (networkVersion !== identity.chainId) {
        throw new UpstreamError('invalid_response', 'L2 network version does not match its chain ID')
      }
      return {
        chainId: toSafeNumber(chainId, 'L2 chain ID'),
        chainIdHex: `0x${chainId.toString(16)}`,
        blockNumber: toSafeNumber(blockNumberRaw, 'L2 block number'),
        clientVersion: identity.clientVersion,
        networkIdentitySchemaVersion: identity.schemaVersion,
        profileId: identity.profileId,
        networkVersion,
        listening,
        readOnly: true,
      }
    },

    async readAccount(addressValue) {
      const address = normalizeL2Address(addressValue)
      await fromClient(() => rpc.verifyNetwork())
      const [balance, nonceRaw, code, blockNumberRaw] = await fromClient(() =>
        Promise.all([
          rpc.getBalance(address),
          rpc.getTransactionCount(address),
          rpc.getCode(address),
          rpc.getBlockNumber(),
        ]))
      return {
        address,
        balanceWei: balance.toString(10),
        nonce: toSafeNumber(nonceRaw, 'L2 account nonce'),
        isContract: code.length > 2,
        blockNumber: toSafeNumber(blockNumberRaw, 'L2 block number'),
        readOnly: true,
      }
    },
  }
}
