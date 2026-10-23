/**
 * BSNA-FTS1 conformance tests.
 *
 * Compiles the reference contract from `contracts/token/BSNAFTS1.sol` and runs
 * it on the real local BTCS L2 development chain. The test covers the
 * behaviours required by docs/BSNA-FTS1-PROPOSAL.md section 10.
 *
 * This is a local chain test. It is not a BNB Smart Chain, Solana, or public
 * testnet result, and it does not make the token a gas asset or a bridge.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'

import { createAddressFromPrivateKey, createAddressFromString, hexToBytes } from '@ethereumjs/util'
import { keccak_256 } from '@noble/hashes/sha3.js'
import solc from 'solc'

import {
  SENDER_ADDRESS,
  SENDER_PRIVATE_KEY,
} from '../../../../execution/evm/src/config.js'
import { PersistentBlockProcessor } from '../../../../execution/evm/src/blockProcessor.js'
import { startLocalRpcServer, type LocalRpcServer } from '../../../../execution/evm/src/rpc.js'
import { signFeeMarketTransaction } from '../../../../execution/evm/src/transactions.js'

import { encodeArguments, encodeCall, type AbiArgument } from '../helpers/abi.js'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..', '..')
const CONTRACT_PATH = resolve(REPOSITORY_ROOT, 'contracts', 'token', 'BSNAFTS1.sol')
const DEPLOY_GAS_LIMIT = 9_000_000n
const CALL_GAS_LIMIT = 1_000_000n
const ZERO = '0x0000000000000000000000000000000000000000'
const ADMIN = SENDER_ADDRESS.toString()
const ZERO_HASH = 0n

type TestSigner = { key: Uint8Array; address: string }

const SENDER_SIGNER: TestSigner = { key: SENDER_PRIVATE_KEY, address: ADMIN }
const OTHER_SIGNER: TestSigner = {
  key: hexToBytes(`0x${'22'.repeat(32)}`),
  address: createAddressFromPrivateKey(hexToBytes(`0x${'22'.repeat(32)}`)).toString(),
}
const OTHER = OTHER_SIGNER.address
const TRANSFER_TOPIC = `0x${Buffer.from(keccak_256(Buffer.from('Transfer(address,address,uint256)'))).toString('hex')}`

type Compiled = {
  creationBytecode: Uint8Array
  methodIdentifiers: Record<string, string>
}

type ConstructorOverrides = {
  name?: string
  symbol?: string
  decimals?: number
  initialSupply?: bigint
  maxSupply?: bigint
  supplyPolicy?: number
  burnPolicy?: number
  pausePolicy?: number
  metadataMutable?: boolean
  metadataURI?: string
  metadataHash?: bigint
  admin?: string
}

function compileFts1(): Compiled {
  const source = readFileSync(CONTRACT_PATH, 'utf8')
  const input = {
    language: 'Solidity',
    sources: { 'BSNAFTS1.sol': { content: source } },
    settings: {
      optimizer: { enabled: false, runs: 200 },
      // The 12-argument constructor with three dynamic strings exceeds the
      // legacy pipeline's stack limit. viaIR is deterministic and targets the
      // same London EVM; it does not change the ABI.
      viaIR: true,
      evmVersion: 'london',
      metadata: { bytecodeHash: 'none', appendCBOR: false },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object', 'evm.methodIdentifiers'] },
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
  const contract = output.contracts?.['BSNAFTS1.sol']?.BSNAFTS1
  if (contract === undefined || contract.evm.bytecode.object.length === 0) {
    throw new Error('Solidity did not produce BSNAFTS1 bytecode')
  }
  return {
    creationBytecode: Uint8Array.from(Buffer.from(contract.evm.bytecode.object, 'hex')),
    methodIdentifiers: contract.evm.methodIdentifiers,
  }
}

function revertsWith(signature: string): string {
  return Buffer.from(keccak_256(Buffer.from(signature, 'utf8'))).toString('hex').slice(0, 8)
}

function decodeUint(data: string): bigint {
  return BigInt(data)
}

function decodeString(data: string): string {
  const raw = Buffer.from(data.replace(/^0x/, ''), 'hex')
  const offset = Number(BigInt(`0x${raw.subarray(0, 32).toString('hex')}`))
  const length = Number(BigInt(`0x${raw.subarray(offset, offset + 32).toString('hex')}`))
  return raw.subarray(offset + 32, offset + 32 + length).toString('utf8')
}

describe('BSNA-FTS1 conformance', () => {
  let dataDirectory: string
  let rpcServer: LocalRpcServer
  let rpcUrl: string
  let compiled: Compiled

  before(async () => {
    dataDirectory = await mkdtemp(join(tmpdir(), 'btcs-fts1-'))
    const chain = await PersistentBlockProcessor.open(dataDirectory)
    rpcServer = await startLocalRpcServer(chain, { port: 0, enableDevelopmentSequencer: true })
    rpcUrl = `http://${rpcServer.host}:${rpcServer.port}`
    compiled = compileFts1()
    // The second signer needs native gas to prove that a distinct minter can
    // actually submit mint transactions. The transfer is sent by the funded
    // genesis account and has no connection to the token.
    await transaction(new Uint8Array(), OTHER_SIGNER.address, { value: 10n ** 18n })
  })

  after(async () => {
    await rpcServer?.close()
    await rm(dataDirectory, { recursive: true, force: true })
  })

  async function raw(method: string, params: unknown[] = []): Promise<{
    result?: unknown
    error?: { code: number; message: string; data?: string }
  }> {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    })
    return await response.json() as { result?: unknown; error?: { code: number; message: string; data?: string } }
  }

  async function send(method: string, params: unknown[] = []): Promise<unknown> {
    const body = await raw(method, params)
    if (body.error !== undefined) throw new Error(`${method}: ${body.error.message}`)
    return body.result
  }

  async function transaction(
    data: Uint8Array,
    to?: string,
    options: { signer?: TestSigner; value?: bigint } = {},
  ): Promise<{
    contractAddress?: string
    hash: string
    logs: Array<{ address: string; topics: string[]; data: string }>
  }> {
    const signer = options.signer ?? SENDER_SIGNER
    const nonceHex = await send('eth_getTransactionCount', [signer.address, 'latest']) as string
    const tx = signFeeMarketTransaction({
      nonce: BigInt(nonceHex),
      to: to === undefined ? undefined : createAddressFromString(to),
      data,
      value: options.value ?? 0n,
      gasLimit: to === undefined ? DEPLOY_GAS_LIMIT : CALL_GAS_LIMIT,
      maxFeePerGas: 5_000_000_000n,
      maxPriorityFeePerGas: 1_000_000_000n,
      privateKey: signer.key,
    })
    const hash = `0x${Buffer.from(tx.hash()).toString('hex')}`
    await send('eth_sendRawTransaction', [`0x${Buffer.from(tx.serialize()).toString('hex')}`])
    await send('btcs_dev_mine', [])
    const receipt = await send('eth_getTransactionReceipt', [hash]) as {
      status: string
      contractAddress?: string | null
      logs?: Array<{ address: string; topics: string[]; data: string }>
    }
    assert.equal(receipt.status, '0x1', `transaction ${hash} reverted`)
    return {
      hash,
      contractAddress: receipt.contractAddress ?? undefined,
      logs: receipt.logs ?? [],
    }
  }

  function args(values: ConstructorOverrides): AbiArgument[] {
    return [
      { type: 'string', value: values.name ?? 'Silver Forge Token' },
      { type: 'string', value: values.symbol ?? 'SFT' },
      { type: 'uint256', value: BigInt(values.decimals ?? 6) },
      { type: 'uint256', value: values.initialSupply ?? 1_500_000n },
      { type: 'uint256', value: values.maxSupply ?? values.initialSupply ?? 1_500_000n },
      { type: 'uint256', value: BigInt(values.supplyPolicy ?? 0) },
      { type: 'uint256', value: BigInt(values.burnPolicy ?? 0) },
      { type: 'uint256', value: BigInt(values.pausePolicy ?? 0) },
      { type: 'bool', value: values.metadataMutable ?? false },
      { type: 'string', value: values.metadataURI ?? '' },
      { type: 'uint256', value: values.metadataHash ?? ZERO_HASH },
      { type: 'address', value: values.admin ?? ADMIN },
    ]
  }

  async function deploy(values: ConstructorOverrides = {}): Promise<string> {
    const data = Buffer.concat([Buffer.from(compiled.creationBytecode), encodeArguments(args(values))])
    const receipt = await transaction(new Uint8Array(data))
    assert.ok(receipt.contractAddress, 'deployment did not return a contract address')
    return receipt.contractAddress.toLowerCase()
  }

  async function call(
    address: string,
    signature: string,
    callArgs: AbiArgument[] = [],
    from: string = ADMIN,
  ): Promise<string> {
    const data = `0x${encodeCall(signature, callArgs).toString('hex')}`
    const result = await send('eth_call', [{ from, to: address, data }, 'latest'])
    assert.equal(typeof result, 'string')
    return result as string
  }

  async function callRevert(
    address: string,
    signature: string,
    callArgs: AbiArgument[] = [],
    from: string = ADMIN,
  ): Promise<string> {
    const data = `0x${encodeCall(signature, callArgs).toString('hex')}`
    const body = await raw('eth_call', [{ from, to: address, data }, 'latest'])
    assert.ok(body.error, `${signature} unexpectedly succeeded`)
    assert.equal(body.error.code, 3, `expected a revert, got ${body.error.message}`)
    return (body.error.data ?? '').replace(/^0x/, '')
  }

  async function sendCall(
    address: string,
    signature: string,
    callArgs: AbiArgument[] = [],
    signer: TestSigner = SENDER_SIGNER,
  ) {
    return await transaction(new Uint8Array(encodeCall(signature, callArgs)), address, { signer })
  }

  it('exposes the ERC-20 surface, identity, and unscaled atomic supply', async () => {
    for (const signature of [
      'name()', 'symbol()', 'decimals()', 'totalSupply()', 'balanceOf(address)',
      'allowance(address,address)', 'transfer(address,uint256)', 'approve(address,uint256)',
      'transferFrom(address,address,uint256)', 'bsnaStandard()', 'bsnaVersion()',
    ]) {
      assert.ok(compiled.methodIdentifiers[signature], `missing selector for ${signature}`)
    }
    assert.equal(compiled.methodIdentifiers['transfer(address,uint256)'], 'a9059cbb')
    assert.equal(compiled.methodIdentifiers['transferFrom(address,address,uint256)'], '23b872dd')

    const token = await deploy({ decimals: 6, initialSupply: 1_500_000n })
    assert.equal(await decodeString(await call(token, 'bsnaStandard()')), 'BSNA-FTS1')
    assert.equal(await decodeString(await call(token, 'bsnaVersion()')), '1')
    assert.equal(await decodeString(await call(token, 'name()')), 'Silver Forge Token')
    assert.equal(await decodeString(await call(token, 'symbol()')), 'SFT')
    assert.equal(decodeUint(await call(token, 'decimals()')), 6n)
    assert.equal(decodeUint(await call(token, 'totalSupply()')), 1_500_000n)
    assert.equal(
      decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])),
      1_500_000n,
    )
  })

  it('rejects invalid constructor input with the specified custom errors', async () => {
    const cases: Array<[ConstructorOverrides, string]> = [
      [{ name: '' }, 'EmptyNameOrSymbol()'],
      [{ symbol: '' }, 'EmptyNameOrSymbol()'],
      [{ name: 'x'.repeat(65) }, 'NameOrSymbolTooLong()'],
      [{ decimals: 19 }, 'DecimalsOutOfRange()'],
      [{ supplyPolicy: 2 }, 'InvalidSupplyPolicy()'],
      [{ burnPolicy: 2 }, 'InvalidPolicy()'],
      [{ pausePolicy: 2 }, 'InvalidPolicy()'],
      [{ supplyPolicy: 0, initialSupply: 10n, maxSupply: 11n }, 'FixedSupplyCapMismatch()'],
      [{ supplyPolicy: 1, initialSupply: 10n, maxSupply: 9n }, 'InitialSupplyExceedsCap()'],
      [{ metadataURI: 'ipfs://x', metadataHash: 0n }, 'MetadataHashRequired()'],
      [{ admin: ZERO }, 'ZeroAddress()'],
    ]
    for (const [overrides, signature] of cases) {
      const data = Buffer.concat([Buffer.from(compiled.creationBytecode), encodeArguments(args(overrides))])
      const nonceHex = await send('eth_getTransactionCount', [ADMIN, 'latest']) as string
      const tx = signFeeMarketTransaction({
        nonce: BigInt(nonceHex),
        data: new Uint8Array(data),
        gasLimit: DEPLOY_GAS_LIMIT,
        maxFeePerGas: 5_000_000_000n,
        maxPriorityFeePerGas: 1_000_000_000n,
      })
      const hash = `0x${Buffer.from(tx.hash()).toString('hex')}`
      await send('eth_sendRawTransaction', [`0x${Buffer.from(tx.serialize()).toString('hex')}`])
      await send('btcs_dev_mine', [])
      const receipt = await send('eth_getTransactionReceipt', [hash]) as { status: string }
      assert.equal(receipt.status, '0x0', `${signature} case was not rejected`)
    }
  })

  it('rejects mint on a fixed-supply token and has no admin mint right', async () => {
    const token = await deploy({ supplyPolicy: 0 })
    for (const from of [ADMIN, OTHER]) {
      const data = await callRevert(token, 'mint(address,uint256)', [
        { type: 'address', value: ADMIN }, { type: 'uint256', value: 1n },
      ], from)
      assert.ok(data.startsWith(revertsWith('MintDisabled()')), `mint from ${from} was not rejected`)
    }
  })

  it('requires an explicit minter, accepts that minter, and enforces the cap exactly', async () => {
    const token = await deploy({ supplyPolicy: 1, initialSupply: 100n, maxSupply: 200n })
    for (const from of [ADMIN, OTHER]) {
      assert.ok((await callRevert(token, 'mint(address,uint256)', [
        { type: 'address', value: ADMIN }, { type: 'uint256', value: 1n },
      ], from)).startsWith(revertsWith('NotMinter(address)')), `mint from ${from} was accepted before a minter was set`)
    }

    await sendCall(token, 'setMinter(address)', [{ type: 'address', value: OTHER }])
    assert.ok((await callRevert(token, 'mint(address,uint256)', [
      { type: 'address', value: ADMIN }, { type: 'uint256', value: 1n },
    ])).startsWith(revertsWith('NotMinter(address)')))

    // The distinct minter must be able to submit a real transaction, not just
    // pass an eth_call simulation.
    await sendCall(token, 'mint(address,uint256)', [
      { type: 'address', value: OTHER }, { type: 'uint256', value: 100n },
    ], OTHER_SIGNER)
    assert.equal(decodeUint(await call(token, 'totalSupply()')), 200n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 100n)

    assert.ok((await callRevert(token, 'mint(address,uint256)', [
      { type: 'address', value: OTHER }, { type: 'uint256', value: 1n },
    ], OTHER)).startsWith(revertsWith('SupplyCapExceeded(uint256,uint256,uint256)')))
    assert.equal(decodeUint(await call(token, 'totalSupply()')), 200n)
  })

  it('burns only the caller balance and only when the holder policy is enabled', async () => {
    const disabled = await deploy({ supplyPolicy: 0, burnPolicy: 0 })
    for (const from of [ADMIN, OTHER]) {
      assert.ok((await callRevert(disabled, 'burn(uint256)', [
        { type: 'uint256', value: 1n },
      ], from)).startsWith(revertsWith('BurnDisabled()')))
    }

    const token = await deploy({ supplyPolicy: 0, burnPolicy: 1, initialSupply: 10n })
    await sendCall(token, 'transfer(address,uint256)', [
      { type: 'address', value: OTHER }, { type: 'uint256', value: 4n },
    ])
    await sendCall(token, 'burn(uint256)', [{ type: 'uint256', value: 1n }], OTHER_SIGNER)
    assert.equal(decodeUint(await call(token, 'totalSupply()')), 9n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 3n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 6n)

    // There is no burn(address,uint256) entry point, so a holder cannot name
    // another holder's balance. An over-balance burn fails closed and leaves
    // the other holder's balance and total supply unchanged.
    assert.equal(compiled.methodIdentifiers['burn(address,uint256)'], undefined)
    assert.ok((await callRevert(token, 'burn(uint256)', [
      { type: 'uint256', value: 4n },
    ], OTHER)).startsWith(revertsWith('InsufficientBalance(address,uint256,uint256)')))
    assert.equal(decodeUint(await call(token, 'totalSupply()')), 9n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 3n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 6n)
  })

  it('pauses transfer, transferFrom, mint, and burn, rejects a non-admin pause, and restores them after unpause', async () => {
    const token = await deploy({
      supplyPolicy: 1,
      burnPolicy: 1,
      pausePolicy: 1,
      initialSupply: 10n,
      maxSupply: 20n,
    })
    await sendCall(token, 'setMinter(address)', [{ type: 'address', value: ADMIN }])
    await sendCall(token, 'approve(address,uint256)', [
      { type: 'address', value: ADMIN }, { type: 'uint256', value: 3n },
    ])

    assert.ok((await callRevert(token, 'pause()', [], OTHER)).startsWith(revertsWith('NotAdmin(address)')))

    await sendCall(token, 'pause()')
    for (const [signature, callArgs] of [
      ['transfer(address,uint256)', [{ type: 'address', value: OTHER }, { type: 'uint256', value: 1n }]],
      ['transferFrom(address,address,uint256)', [
        { type: 'address', value: ADMIN },
        { type: 'address', value: OTHER },
        { type: 'uint256', value: 1n },
      ]],
      ['mint(address,uint256)', [{ type: 'address', value: ADMIN }, { type: 'uint256', value: 1n }]],
      ['burn(uint256)', [{ type: 'uint256', value: 1n }]],
    ] as Array<[string, AbiArgument[]]>) {
      assert.ok((await callRevert(token, signature, callArgs)).startsWith(revertsWith('Paused()')), `${signature} was not paused`)
    }

    await sendCall(token, 'unpause()')
    await sendCall(token, 'transfer(address,uint256)', [
      { type: 'address', value: OTHER }, { type: 'uint256', value: 1n },
    ])
    await sendCall(token, 'transferFrom(address,address,uint256)', [
      { type: 'address', value: ADMIN },
      { type: 'address', value: OTHER },
      { type: 'uint256', value: 2n },
    ])
    await sendCall(token, 'mint(address,uint256)', [
      { type: 'address', value: ADMIN }, { type: 'uint256', value: 1n },
    ])
    await sendCall(token, 'burn(uint256)', [{ type: 'uint256', value: 1n }])

    assert.equal(decodeUint(await call(token, 'totalSupply()')), 10n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 3n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 7n)
    assert.equal(decodeUint(await call(token, 'allowance(address,address)', [
      { type: 'address', value: ADMIN }, { type: 'address', value: ADMIN },
    ])), 1n)
  })

  it('rejects pause on a disabled-pause token and from a non-admin', async () => {
    const disabled = await deploy({ pausePolicy: 0 })
    assert.ok((await callRevert(disabled, 'pause()')).startsWith(revertsWith('InvalidPolicy()')))

    const foreignAdmin = await deploy({ pausePolicy: 1, admin: OTHER })
    assert.ok((await callRevert(foreignAdmin, 'pause()')).startsWith(revertsWith('NotAdmin(address)')))
  })

  it('decrements allowance and fails closed on insufficient allowance or balance', async () => {
    const token = await deploy({ initialSupply: 3n })
    assert.ok((await callRevert(token, 'transferFrom(address,address,uint256)', [
      { type: 'address', value: ADMIN },
      { type: 'address', value: OTHER },
      { type: 'uint256', value: 1n },
    ])).startsWith(revertsWith('InsufficientAllowance(address,uint256,uint256)')))
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 3n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 0n)

    await sendCall(token, 'approve(address,uint256)', [
      { type: 'address', value: OTHER }, { type: 'uint256', value: 10n },
    ])
    // The spender has enough allowance but the owner has only 3 atomic units.
    assert.ok((await callRevert(token, 'transferFrom(address,address,uint256)', [
      { type: 'address', value: ADMIN },
      { type: 'address', value: OTHER },
      { type: 'uint256', value: 5n },
    ], OTHER)).startsWith(revertsWith('InsufficientBalance(address,uint256,uint256)')))
    assert.equal(decodeUint(await call(token, 'totalSupply()')), 3n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 3n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 0n)
    assert.equal(decodeUint(await call(token, 'allowance(address,address)', [
      { type: 'address', value: ADMIN }, { type: 'address', value: OTHER },
    ])), 10n)

    await sendCall(token, 'transferFrom(address,address,uint256)', [
      { type: 'address', value: ADMIN },
      { type: 'address', value: OTHER },
      { type: 'uint256', value: 2n },
    ], OTHER_SIGNER)
    assert.equal(decodeUint(await call(token, 'allowance(address,address)', [
      { type: 'address', value: ADMIN }, { type: 'address', value: OTHER },
    ])), 8n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 1n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 2n)

    assert.ok((await callRevert(token, 'transferFrom(address,address,uint256)', [
      { type: 'address', value: ADMIN },
      { type: 'address', value: OTHER },
      { type: 'uint256', value: 9n },
    ], OTHER)).startsWith(revertsWith('InsufficientAllowance(address,uint256,uint256)')))
    assert.equal(decodeUint(await call(token, 'allowance(address,address)', [
      { type: 'address', value: ADMIN }, { type: 'address', value: OTHER },
    ])), 8n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 1n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 2n)
  })

  it('rejects a direct transfer to the zero address and allows a zero-value transfer', async () => {
    const token = await deploy({ initialSupply: 2n })
    assert.ok((await callRevert(token, 'transfer(address,uint256)', [
      { type: 'address', value: ZERO }, { type: 'uint256', value: 1n },
    ])).startsWith(revertsWith('ZeroAddress()')))
    await sendCall(token, 'transfer(address,uint256)', [
      { type: 'address', value: OTHER }, { type: 'uint256', value: 0n },
    ])
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: OTHER }])), 0n)
  })

  it('burns the caller balance to the zero address and emits Transfer', async () => {
    const token = await deploy({ burnPolicy: 1, initialSupply: 1n })
    const receipt = await sendCall(token, 'burn(uint256)', [{ type: 'uint256', value: 1n }])
    assert.equal(decodeUint(await call(token, 'totalSupply()')), 0n)
    assert.equal(decodeUint(await call(token, 'balanceOf(address)', [{ type: 'address', value: ADMIN }])), 0n)

    const topicAddress = (address: string) => `0x${address.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`
    const burnLog = receipt.logs.find((log) =>
      log.address.toLowerCase() === token &&
      log.topics[0]?.toLowerCase() === TRANSFER_TOPIC &&
      log.topics[1]?.toLowerCase() === topicAddress(ADMIN) &&
      log.topics[2]?.toLowerCase() === topicAddress(ZERO),
    )
    assert.ok(burnLog, 'burn did not emit Transfer(caller, zero, amount)')
    assert.equal(BigInt(burnLog.data), 1n)
  })

  it('freezes metadata when configured immutably and updates it when mutable', async () => {
    const frozen = await deploy({ metadataMutable: false })
    assert.ok((await callRevert(frozen, 'setMetadata(string,bytes32)', [
      { type: 'string', value: 'ipfs://x' }, { type: 'uint256', value: 1n },
    ])).startsWith(revertsWith('MetadataFrozen()')))

    const mutable = await deploy({
      metadataMutable: true,
      metadataURI: 'ipfs://initial',
      metadataHash: 1n,
    })
    assert.equal(decodeString(await call(mutable, 'metadataURI()')), 'ipfs://initial')
    assert.equal(decodeUint(await call(mutable, 'metadataHash()')), 1n)
    await sendCall(mutable, 'setMetadata(string,bytes32)', [
      { type: 'string', value: 'ipfs://updated' }, { type: 'uint256', value: 2n },
    ])
    assert.equal(decodeString(await call(mutable, 'metadataURI()')), 'ipfs://updated')
    assert.equal(decodeUint(await call(mutable, 'metadataHash()')), 2n)
    assert.ok((await callRevert(mutable, 'setMetadata(string,bytes32)', [
      { type: 'string', value: 'ipfs://x' }, { type: 'uint256', value: 0n },
    ])).startsWith(revertsWith('MetadataHashRequired()')))
  })

  it('makes privileged actions fail after the admin renounces', async () => {
    const token = await deploy({
      metadataMutable: true,
      supplyPolicy: 1,
      burnPolicy: 1,
      pausePolicy: 1,
    })
    await sendCall(token, 'renounceAdmin()')
    for (const [signature, callArgs] of [
      ['setMinter(address)', [{ type: 'address', value: ADMIN }]],
      ['pause()', []],
      ['setMetadata(string,bytes32)', [{ type: 'string', value: 'x' }, { type: 'uint256', value: 1n }]],
      ['transferAdmin(address)', [{ type: 'address', value: ADMIN }]],
    ] as Array<[string, AbiArgument[]]>) {
      assert.ok((await callRevert(token, signature, callArgs)).startsWith(revertsWith('NotAdmin(address)')), signature)
    }
  })

  it('transfers the admin role in one transaction', async () => {
    const token = await deploy({ pausePolicy: 1 })
    await sendCall(token, 'transferAdmin(address)', [{ type: 'address', value: OTHER }])
    assert.equal(
      (await call(token, 'admin()')).slice(-40).toLowerCase(),
      OTHER.slice(2).toLowerCase(),
    )
    assert.ok((await callRevert(token, 'pause()')).startsWith(revertsWith('NotAdmin(address)')))
  })
})
