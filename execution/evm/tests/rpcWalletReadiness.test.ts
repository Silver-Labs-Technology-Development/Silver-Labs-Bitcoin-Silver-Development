import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, createContractAddress, hexToBytes } from '@ethereumjs/util'
import solc from 'solc'
import { EVM_CHAIN_ID, SENDER_ADDRESS } from '../src/config.js'
import { signFeeMarketTransaction } from '../src/transactions.js'

const PACKAGE_ROOT = fileURLToPath(new URL('..', import.meta.url))
const RECIPIENT = `0x${'aa'.repeat(20)}`
const ZERO_ADDRESS = `0x${'00'.repeat(20)}`
const TOKEN_SOURCE = `
  pragma solidity 0.8.37;
  contract WalletToken {
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from, address indexed to, uint256 value);
    constructor() { balanceOf[msg.sender] = 1000; }
    function transfer(address to, uint256 value) external returns (bool) {
      require(balanceOf[msg.sender] >= value, "insufficient token");
      balanceOf[msg.sender] -= value;
      balanceOf[to] += value;
      emit Transfer(msg.sender, to, value);
      return true;
    }
  }
`

type RpcResult = {
  result?: unknown
  error?: { code: number; message: string; data?: string }
}

type RpcProcess = {
  child: ChildProcess
  url: string
  output: string
}

function rpcResult<T>(response: RpcResult, label: string): T {
  if (response.error !== undefined || response.result === undefined) {
    throw new Error(`${label}: ${JSON.stringify(response.error ?? response)}`)
  }
  return response.result as T
}

async function callRpc(url: string, method: string, params: unknown[] = []): Promise<RpcResult> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return await response.json() as RpcResult
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('could not reserve a loopback port'))
        return
      }
      const { port } = address
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function compileWalletToken(): {
  creationBytecode: Uint8Array
  methodIdentifiers: Record<string, string>
} {
  const input = {
    language: 'Solidity',
    sources: { 'WalletToken.sol': { content: TOKEN_SOURCE } },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      evmVersion: 'osaka',
      metadata: { bytecodeHash: 'none', appendCBOR: false },
      outputSelection: {
        '*': { '*': ['evm.bytecode.object', 'evm.methodIdentifiers'] },
      },
    },
  }
  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    errors?: Array<{ severity: string; formattedMessage: string }>
    contracts?: Record<string, Record<string, {
      evm: { bytecode: { object: string }; methodIdentifiers: Record<string, string> }
    }>>
  }
  const errors = output.errors?.filter((error) => error.severity === 'error') ?? []
  if (errors.length > 0) throw new Error(errors.map((error) => error.formattedMessage).join('\n'))
  const contract = output.contracts?.['WalletToken.sol']?.WalletToken
  const bytecode = contract?.evm.bytecode.object
  if (contract === undefined || bytecode === undefined || bytecode.length === 0) {
    throw new Error('Solidity compiler did not produce WalletToken bytecode')
  }
  return {
    creationBytecode: hexToBytes(`0x${bytecode}`),
    methodIdentifiers: contract.evm.methodIdentifiers,
  }
}

function selector(compiled: { methodIdentifiers: Record<string, string> }, signature: string): Uint8Array {
  const identifier = compiled.methodIdentifiers[signature]
  assert.ok(identifier, signature)
  return hexToBytes(`0x${identifier}`)
}

function encodeAddress(address: string): Uint8Array {
  const padded = new Uint8Array(32)
  padded.set(hexToBytes(address as `0x${string}`), 12)
  return padded
}

function encodeUint(value: bigint): Uint8Array {
  return hexToBytes(`0x${value.toString(16).padStart(64, '0')}`)
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function startRpc(directory: string): Promise<RpcProcess> {
  const port = await freePort()
  const child = spawn(process.execPath, [
    '--import', 'tsx',
    'src/rpcServer.ts',
    '--datadir', directory,
    '--port', String(port),
    '--dev-sequencer',
  ], {
    cwd: PACKAGE_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout?.setEncoding('utf8')
  child.stderr?.setEncoding('utf8')
  child.stdout?.on('data', (chunk: string) => { output += chunk })
  child.stderr?.on('data', (chunk: string) => { output += chunk })
  const url = `http://127.0.0.1:${port}`
  const started = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), 20_000)
    const onData = () => {
      if (output.includes('BTCS L2 local RPC listening')) {
        clearTimeout(timer)
        resolve(true)
      }
    }
    child.stdout?.on('data', onData)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
  if (!started) {
    child.kill('SIGKILL')
    throw new Error(`RPC process did not listen: ${output}`)
  }
  return { child, url, output }
}

async function stopRpc(child: ChildProcess): Promise<'SIGTERM' | 'SIGKILL'> {
  if (child.exitCode !== null || child.signalCode !== null) return 'SIGTERM'
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2_000)),
  ])
  if (stopped) return 'SIGTERM'
  child.kill('SIGKILL')
  await exited
  return 'SIGKILL'
}

test('wallet readiness through the local RPC process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'btcs-l2-wallet-rpc-'))
  const compiled = compileWalletToken()
  const sender = SENDER_ADDRESS.toString().toLowerCase()
  const token = createContractAddress(SENDER_ADDRESS, 0n).toString().toLowerCase()
  const balanceOfSender = bytesToHex(concatBytes([
    selector(compiled, 'balanceOf(address)'),
    encodeAddress(sender),
  ]))
  const balanceOfRecipient = bytesToHex(concatBytes([
    selector(compiled, 'balanceOf(address)'),
    encodeAddress(RECIPIENT),
  ]))
  const transferData = concatBytes([
    selector(compiled, 'transfer(address,uint256)'),
    encodeAddress(RECIPIENT),
    encodeUint(1n),
  ])
  const transferTopic = bytesToHex(keccak_256(new TextEncoder().encode('Transfer(address,address,uint256)'))).toLowerCase()
  let rpc: RpcProcess | undefined
  let minedHash = ''
  try {
    rpc = await startRpc(directory)
    const version = rpcResult<string>(await callRpc(rpc.url, 'web3_clientVersion'), 'web3_clientVersion')
    assert.match(version, /^BTCSL2\//)
    assert.equal(rpcResult(await callRpc(rpc.url, 'eth_chainId'), 'eth_chainId'), '0x7a69')
    assert.equal(rpcResult(await callRpc(rpc.url, 'net_version'), 'net_version'), EVM_CHAIN_ID.toString(10))
    assert.equal(rpcResult(await callRpc(rpc.url, 'net_listening'), 'net_listening'), false)
    assert.equal(rpcResult(await callRpc(rpc.url, 'net_peerCount'), 'net_peerCount'), '0x0')

    const deployEstimate = BigInt(rpcResult<string>(await callRpc(rpc.url, 'eth_estimateGas', [{
      from: sender,
      data: bytesToHex(compiled.creationBytecode),
    }]), 'estimate deploy'))
    const deployTx = signFeeMarketTransaction({
      nonce: 0n,
      data: compiled.creationBytecode,
      gasLimit: deployEstimate,
    })
    const deployHash = bytesToHex(deployTx.hash()).toLowerCase()
    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_sendRawTransaction', [bytesToHex(deployTx.serialize())]), 'send deploy'),
      deployHash,
    )
    const deployMined = rpcResult<{ transactions: string[] }>(await callRpc(rpc.url, 'btcs_dev_mine'), 'mine deploy')
    assert.equal(deployMined.transactions[0], deployHash)
    const deployReceipt = rpcResult<{ status: string; contractAddress: string }>(
      await callRpc(rpc.url, 'eth_getTransactionReceipt', [deployHash]),
      'deploy receipt',
    )
    assert.equal(deployReceipt.status, '0x1')
    assert.equal(deployReceipt.contractAddress, token)
    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_call', [{ to: token, data: balanceOfSender }, 'latest']), 'balanceOf sender'),
      `0x${(1000n).toString(16).padStart(64, '0')}`,
    )

    const transferEstimate = BigInt(rpcResult<string>(await callRpc(rpc.url, 'eth_estimateGas', [{
      from: sender,
      to: token,
      data: bytesToHex(transferData),
    }]), 'estimate transfer'))
    const senderBefore = BigInt(rpcResult<string>(
      await callRpc(rpc.url, 'eth_getBalance', [sender, 'latest']),
      'sender before',
    ))
    const coinbaseBefore = BigInt(rpcResult<string>(
      await callRpc(rpc.url, 'eth_getBalance', [ZERO_ADDRESS, 'latest']),
      'coinbase before',
    ))
    const transferTx = signFeeMarketTransaction({
      nonce: 1n,
      to: createContractAddress(SENDER_ADDRESS, 0n),
      data: transferData,
      gasLimit: transferEstimate,
    })
    minedHash = bytesToHex(transferTx.hash()).toLowerCase()
    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_sendRawTransaction', [bytesToHex(transferTx.serialize())]), 'send transfer'),
      minedHash,
    )
    const transferMined = rpcResult<{ transactions: string[] }>(
      await callRpc(rpc.url, 'btcs_dev_mine'),
      'mine transfer',
    )
    assert.equal(transferMined.transactions[0], minedHash)

    const transaction = rpcResult<{ hash: string; from: string; to: string; input: string }>(
      await callRpc(rpc.url, 'eth_getTransactionByHash', [minedHash]),
      'transfer transaction',
    )
    assert.equal(transaction.hash, minedHash)
    assert.equal(transaction.from, sender)
    assert.equal(transaction.to, token)
    assert.equal(transaction.input, bytesToHex(transferData))
    const receipt = rpcResult<{
      status: string
      gasUsed: string
      effectiveGasPrice: string
      blockNumber: string
      transactionHash: string
      logs: Array<{ address: string; topics: string[]; data: string }>
    }>(await callRpc(rpc.url, 'eth_getTransactionReceipt', [minedHash]), 'transfer receipt')
    assert.equal(receipt.status, '0x1')
    assert.equal(receipt.transactionHash, minedHash)
    const block = rpcResult<{ baseFeePerGas: string }>(
      await callRpc(rpc.url, 'eth_getBlockByNumber', [receipt.blockNumber, false]),
      'transfer block',
    )
    const gasUsed = BigInt(receipt.gasUsed)
    const effectiveGasPrice = BigInt(receipt.effectiveGasPrice)
    const baseFee = BigInt(block.baseFeePerGas)
    const senderAfter = BigInt(rpcResult<string>(
      await callRpc(rpc.url, 'eth_getBalance', [sender, 'latest']),
      'sender after',
    ))
    const coinbaseAfter = BigInt(rpcResult<string>(
      await callRpc(rpc.url, 'eth_getBalance', [ZERO_ADDRESS, 'latest']),
      'coinbase after',
    ))
    assert.equal(senderBefore - senderAfter, gasUsed * effectiveGasPrice)
    assert.equal(coinbaseAfter - coinbaseBefore, gasUsed * (effectiveGasPrice - baseFee))
    assert.ok(effectiveGasPrice > baseFee)

    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_call', [{ to: token, data: balanceOfSender }]), 'sender token'),
      `0x${(999n).toString(16).padStart(64, '0')}`,
    )
    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_call', [{ to: token, data: balanceOfRecipient }]), 'recipient token'),
      `0x${(1n).toString(16).padStart(64, '0')}`,
    )
    assert.equal(receipt.logs.length, 1)
    const log = receipt.logs[0]
    assert.ok(log)
    assert.equal(log.address.toLowerCase(), token)
    assert.equal(log.topics[0]?.toLowerCase(), transferTopic)
    assert.equal(log.topics[1]?.toLowerCase(), bytesToHex(encodeAddress(sender)))
    assert.equal(log.topics[2]?.toLowerCase(), bytesToHex(encodeAddress(RECIPIENT)))
    assert.equal(log.data, `0x${(1n).toString(16).padStart(64, '0')}`)
    const code = rpcResult<string>(await callRpc(rpc.url, 'eth_getCode', [token, 'latest']), 'code')
    assert.notEqual(code, '0x')

    const pendingTx = signFeeMarketTransaction({
      nonce: 2n,
      to: SENDER_ADDRESS,
      value: 1n,
      gasLimit: 21_000n,
    })
    const pendingHash = bytesToHex(pendingTx.hash()).toLowerCase()
    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_sendRawTransaction', [bytesToHex(pendingTx.serialize())]), 'send pending'),
      pendingHash,
    )
    const pending = rpcResult<{ blockHash: null; hash: string }>(
      await callRpc(rpc.url, 'eth_getTransactionByHash', [pendingHash]),
      'pending lookup',
    )
    assert.equal(pending.blockHash, null)
    assert.equal(pending.hash, pendingHash)
    const tipBeforeRestart = rpcResult<string>(await callRpc(rpc.url, 'eth_blockNumber'), 'tip before restart')

    const stop = await stopRpc(rpc.child)
    rpc = undefined
    assert.ok(stop === 'SIGTERM' || stop === 'SIGKILL')

    rpc = await startRpc(directory)
    assert.equal(rpcResult(await callRpc(rpc.url, 'eth_chainId'), 'chain id after restart'), '0x7a69')
    assert.equal(rpcResult(await callRpc(rpc.url, 'eth_blockNumber'), 'tip after restart'), tipBeforeRestart)
    assert.equal(
      rpcResult<{ status: string }>(await callRpc(rpc.url, 'eth_getTransactionReceipt', [minedHash]), 'receipt after restart').status,
      '0x1',
    )
    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_call', [{ to: token, data: balanceOfSender }]), 'token after restart'),
      `0x${(999n).toString(16).padStart(64, '0')}`,
    )
    assert.equal(
      rpcResult(await callRpc(rpc.url, 'eth_getCode', [token, 'latest']), 'code after restart'),
      code,
    )
    assert.equal(
      (await callRpc(rpc.url, 'eth_getTransactionByHash', [pendingHash])).result,
      null,
      'the in-memory pool does not survive a process restart',
    )
  } finally {
    if (rpc !== undefined) await stopRpc(rpc.child)
    await rm(directory, { recursive: true, force: true })
  }
})
