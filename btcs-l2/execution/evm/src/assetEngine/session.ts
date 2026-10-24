import { bytesToHex } from '@ethereumjs/util'
import { feeFieldsForProfile, nativeFeeCeiling, type FeeFields } from './fees.js'
import {
  compileFungibleAsset,
  creationCalldata,
  decodeAddress,
  decodeString,
  decodeUint,
  encodeAddressWord,
  encodeCall,
  encodeUintWord,
} from './fungible.js'
import { FTS1_POLICY_CODE, compileBsnaFts1, fts1CreationCalldata, type Fts1Spec } from './fts1.js'
import { AssetEngineError } from './errors.js'
import {
  type NetworkProfile,
  type WalletRpcRequest,
  normalizeAddress,
  parseQuantity,
  quantity,
  resolveRpcUrl,
  walletAddParams,
  walletSwitchParams,
  assetIdFor,
} from './networks.js'
import { optionalRpc, rpcCall } from './rpcClient.js'
import {
  DeploymentRegistry,
  requireSameNetwork,
  type DeploymentRecord,
  type StoredLogo,
} from './registry.js'
import { PrivateKeySigner, type SignedCall } from './signer.js'

export type ConnectionReport = {
  networkId: string
  chainId: number
  nativeSymbol: string
  blockNumber: bigint
  clientVersion: string | null
  rpcValidated: true
  /** Connect proves the RPC reported this chain id. It does not prove a public network operator. */
  liveNetworkProven: false
}

export type FeeQuote = FeeFields & {
  gasLimit: bigint
  estimatedNativeFee: bigint
}

export type TransactionReceipt = {
  transactionHash: string
  status: string
  contractAddress: string | null
  gasUsed: bigint
  effectiveGasPrice: bigint
  blockNumber: string
  from: string
  to: string | null
  logs: Array<{ address: string; topics: string[]; data: string }>
}

export type MinedCall = {
  transactionHash: string
  receipt: TransactionReceipt
  quote: FeeQuote
}

export type FungibleSpec = {
  name: string
  symbol: string
  decimals: number
  atomicSupply: bigint
  description?: string
  externalUrl?: string
  logoBytes?: Uint8Array
}

export type OnChainFungible = {
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  owner: string
}

export type OnChainFts1 = {
  standard: string
  version: string
  name: string
  symbol: string
  decimals: number
  totalSupply: bigint
  admin: string
  minter: string
  supplyPolicy: number
  burnPolicy: number
  pausePolicy: number
  maxSupply: bigint
  metadataMutable: boolean
  metadataUri: string
  metadataHash: bigint
  paused: boolean
}

type BlockView = {
  baseFeePerGas?: string | null
  number?: string
}

type MineResult = {
  transactions?: unknown
  discardedTransactions?: unknown
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export class AssetDevelopmentSession {
  private constructor(
    private profile: NetworkProfile,
    private rpcUrl: string,
    private readonly signer: PrivateKeySigner,
    private readonly registry: DeploymentRegistry,
    private devSequencer: boolean,
    private report: ConnectionReport,
  ) {}

  get network(): NetworkProfile {
    return this.profile
  }

  get signerAddress(): string {
    return this.signer.address
  }

  connection(): ConnectionReport {
    return this.report
  }

  static async connect(options: {
    profile: NetworkProfile
    rpcUrl?: string
    signer: PrivateKeySigner
    registry: DeploymentRegistry
    devSequencer?: boolean
  }): Promise<AssetDevelopmentSession> {
    const rpcUrl = resolveRpcUrl(options.profile, options.rpcUrl)
    const devSequencer = options.devSequencer ?? false
    assertDevSequencer(options.profile, devSequencer)
    const report = await validateConnection(options.profile, rpcUrl)
    return new AssetDevelopmentSession(options.profile, rpcUrl, options.signer, options.registry, devSequencer, report)
  }

  async switchNetwork(options: {
    profile: NetworkProfile
    rpcUrl?: string
    devSequencer?: boolean
  }): Promise<ConnectionReport> {
    const rpcUrl = resolveRpcUrl(options.profile, options.rpcUrl)
    const devSequencer = options.devSequencer ?? false
    assertDevSequencer(options.profile, devSequencer)
    const report = await validateConnection(options.profile, rpcUrl)
    this.profile = options.profile
    this.rpcUrl = rpcUrl
    this.devSequencer = devSequencer
    this.report = report
    return report
  }

  walletSwitch(): WalletRpcRequest {
    return walletSwitchParams(this.profile)
  }

  walletAdd(): WalletRpcRequest {
    return walletAddParams(this.profile, this.rpcUrl)
  }

  explorerTransactionUrl(hash: string): string | null {
    if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new AssetEngineError('transaction hash must be 32 bytes')
    return this.profile.explorer?.transactionUrl(hash.toLowerCase()) ?? null
  }

  explorerAddressUrl(address: string): string | null {
    return this.profile.explorer?.addressUrl(normalizeAddress(address)) ?? null
  }

  verificationPlan(record: DeploymentRecord): {
    state: 'unsupported' | 'not-submitted'
    reason: string
    chainId: number
    address: string
  } {
    requireSameNetwork(this.profile.id, record)
    if (this.profile.explorer === null) {
      return {
        state: 'unsupported',
        reason: `${this.profile.name} has no public explorer verification endpoint`,
        chainId: this.profile.chainId,
        address: record.contractAddress,
      }
    }
    return {
      state: 'not-submitted',
      reason: `${this.profile.explorer.apiHost} requires an explorer API key supplied by the caller. This engine has not submitted source and has not marked the contract verified.`,
      chainId: this.profile.chainId,
      address: record.contractAddress,
    }
  }

  async nativeBalance(account = this.signer.address): Promise<bigint> {
    const result = await rpcCall(this.rpcUrl, 'eth_getBalance', [normalizeAddress(account), 'latest'])
    return parseQuantity(result, 'balance')
  }

  async baseFee(blockNumber: string): Promise<bigint> {
    const block = await rpcCall(this.rpcUrl, 'eth_getBlockByNumber', [blockNumber, false]) as { baseFeePerGas?: string | null }
    if (block?.baseFeePerGas == null) throw new AssetEngineError('block did not report a base fee')
    return parseQuantity(block.baseFeePerGas, 'base fee')
  }

  async estimateFees(call: { to?: string; data: Uint8Array }): Promise<FeeQuote> {
    const fields = await this.observeFees()
    const gasLimit = await this.estimateGas(call, fields)
    return { ...fields, gasLimit, estimatedNativeFee: nativeFeeCeiling(fields, gasLimit) }
  }

  async deployFungible(spec: FungibleSpec, options?: { allowMainnet?: boolean }): Promise<DeploymentRecord> {
    this.assertCanSend(options?.allowMainnet ?? false)
    const compiled = compileFungibleAsset()
    const owner = this.signer.address
    const data = creationCalldata(compiled, {
      name: spec.name,
      symbol: spec.symbol,
      decimals: spec.decimals,
      atomicSupply: spec.atomicSupply,
      owner,
    })
    const mined = await this.signAndSubmit({ data }, options?.allowMainnet ?? false)
    if (mined.receipt.contractAddress === null) {
      throw new AssetEngineError('deployment receipt did not return a contract address')
    }
    const contractAddress = normalizeAddress(mined.receipt.contractAddress)
    let onChain: OnChainFungible
    try {
      onChain = await this.readContract(contractAddress)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'read failed'
      throw new AssetEngineError(
        `deployment transaction ${mined.transactionHash} was included, but the token read-back failed (${message}). No deployment was recorded.`,
      )
    }
    if (
      onChain.name !== spec.name ||
      onChain.symbol !== spec.symbol ||
      onChain.decimals !== spec.decimals ||
      onChain.totalSupply !== spec.atomicSupply ||
      onChain.owner !== owner
    ) {
      throw new AssetEngineError('on-chain token fields do not match the deployment request. No deployment was recorded.')
    }
    const logo = spec.logoBytes === undefined ? null : await this.registry.storeLogo(spec.logoBytes)
    const record = this.recordFor(spec, contractAddress, mined.transactionHash, compiled.creationBytecodeSha256, logo)
    await this.registry.put(record)
    return record
  }

  /**
   * Deploy a BSNA-FTS1 token. The contract is read back before the deployment
   * is recorded, so a node that includes the transaction but does not serve the
   * expected identity cannot produce a success record.
   */
  async deployFts1(spec: Fts1Spec, options?: { allowMainnet?: boolean }): Promise<DeploymentRecord> {
    this.assertCanSend(options?.allowMainnet ?? false)
    const compiled = compileBsnaFts1()
    const owner = this.signer.address
    const data = fts1CreationCalldata(compiled, { ...spec, admin: owner })
    const mined = await this.signAndSubmit({ data }, options?.allowMainnet ?? false)
    if (mined.receipt.contractAddress === null) {
      throw new AssetEngineError('deployment receipt did not return a contract address')
    }
    const contractAddress = normalizeAddress(mined.receipt.contractAddress)
    let onChain: OnChainFts1
    try {
      onChain = await this.readFts1Contract(contractAddress)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'read failed'
      throw new AssetEngineError(
        `deployment transaction ${mined.transactionHash} was included, but the BSNA-FTS1 read-back failed (${message}). No deployment was recorded.`,
      )
    }
    if (
      onChain.standard !== 'BSNA-FTS1' ||
      onChain.version !== '1' ||
      onChain.name !== spec.name ||
      onChain.symbol !== spec.symbol ||
      onChain.decimals !== spec.decimals ||
      onChain.totalSupply !== spec.atomicSupply ||
      onChain.admin !== owner ||
      onChain.supplyPolicy !== FTS1_POLICY_CODE.supply[spec.supplyPolicy] ||
      onChain.burnPolicy !== FTS1_POLICY_CODE.burn[spec.burnPolicy] ||
      onChain.pausePolicy !== FTS1_POLICY_CODE.pause[spec.pausePolicy] ||
      onChain.maxSupply !== spec.maxSupply ||
      onChain.metadataMutable !== spec.metadataMutable ||
      onChain.metadataUri !== spec.metadataUri ||
      onChain.metadataHash !== spec.metadataHash ||
      onChain.paused
    ) {
      throw new AssetEngineError('on-chain BSNA-FTS1 fields do not match the deployment request. No deployment was recorded.')
    }
    const logo = spec.logoBytes === undefined ? null : await this.registry.storeLogo(spec.logoBytes)
    const record = this.recordForFts1(spec, contractAddress, mined.transactionHash, compiled.creationBytecodeSha256, logo)
    await this.registry.put(record)
    return record
  }

  async transfer(assetId: string, to: string, atomicAmount: bigint, options?: { allowMainnet?: boolean }): Promise<MinedCall> {
    const record = await this.recordOnThisNetwork(assetId)
    const compiled = compileFungibleAsset()
    const data = encodeCall(compiled, 'transfer(address,uint256)', [
      encodeAddressWord(to),
      encodeUintWord(atomicAmount),
    ])
    return this.signAndSubmit({ to: record.contractAddress, data }, options?.allowMainnet ?? false)
  }

  /**
   * Mint on a BSNA-FTS1 token whose recorded supply policy is authorized-mint.
   * The contract still enforces minter, pause, and cap; this method refuses
   * before signing when the registry record shows the policy is fixed.
   */
  async mintFts1(
    assetId: string,
    to: string,
    atomicAmount: bigint,
    options?: { allowMainnet?: boolean },
  ): Promise<{ mined: MinedCall; setupTransactionHash: string | null }> {
    const record = await this.recordOnThisNetwork(assetId)
    if (record.standard !== 'BSNA-FTS1') {
      throw new AssetEngineError('this deployment is not BSNA-FTS1; it has no mint entry point')
    }
    if (record.permissions.supplyPolicy !== 'authorized-mint') {
      throw new AssetEngineError('this BSNA-FTS1 token has a fixed supply and cannot be minted')
    }
    const compiled = compileBsnaFts1()
    const onChain = await this.readFts1Contract(record.contractAddress)
    let setupTransactionHash: string | null = null
    if (onChain.minter.toLowerCase() !== this.signer.address.toLowerCase()) {
      if (onChain.admin.toLowerCase() !== this.signer.address.toLowerCase()) {
        throw new AssetEngineError(
          `the contract minter is ${onChain.minter} and this key is not the admin, so the engine cannot authorize a mint`,
        )
      }
      const setup = await this.signAndSubmit(
        { to: record.contractAddress, data: encodeCall(compiled, 'setMinter(address)', [encodeAddressWord(this.signer.address)]) },
        options?.allowMainnet ?? false,
      )
      setupTransactionHash = setup.transactionHash
    }
    const mined = await this.signAndSubmit(
      {
        to: record.contractAddress,
        data: encodeCall(compiled, 'mint(address,uint256)', [
          encodeAddressWord(to),
          encodeUintWord(atomicAmount),
        ]),
      },
      options?.allowMainnet ?? false,
    )
    return { mined, setupTransactionHash }
  }

  async approve(assetId: string, spender: string, atomicAmount: bigint, options?: { allowMainnet?: boolean }): Promise<MinedCall> {
    const record = await this.recordOnThisNetwork(assetId)
    const compiled = compileFungibleAsset()
    const data = encodeCall(compiled, 'approve(address,uint256)', [
      encodeAddressWord(spender),
      encodeUintWord(atomicAmount),
    ])
    return this.signAndSubmit({ to: record.contractAddress, data }, options?.allowMainnet ?? false)
  }

  async transferFrom(
    assetId: string,
    from: string,
    to: string,
    atomicAmount: bigint,
    options?: { allowMainnet?: boolean },
  ): Promise<MinedCall> {
    const record = await this.recordOnThisNetwork(assetId)
    const compiled = compileFungibleAsset()
    const data = encodeCall(compiled, 'transferFrom(address,address,uint256)', [
      encodeAddressWord(from),
      encodeAddressWord(to),
      encodeUintWord(atomicAmount),
    ])
    return this.signAndSubmit({ to: record.contractAddress, data }, options?.allowMainnet ?? false)
  }

  async balanceOf(assetId: string, account: string): Promise<bigint> {
    const record = await this.recordOnThisNetwork(assetId)
    const data = encodeCall(compileFungibleAsset(), 'balanceOf(address)', [encodeAddressWord(account)])
    const result = await this.ethCall(record.contractAddress, data)
    return decodeUint(result)
  }

  async allowance(assetId: string, owner: string, spender: string): Promise<bigint> {
    const record = await this.recordOnThisNetwork(assetId)
    const data = encodeCall(compileFungibleAsset(), 'allowance(address,address)', [
      encodeAddressWord(owner),
      encodeAddressWord(spender),
    ])
    const result = await this.ethCall(record.contractAddress, data)
    return decodeUint(result)
  }

  async readFungible(assetId: string): Promise<OnChainFungible> {
    const record = await this.recordOnThisNetwork(assetId)
    return this.readContract(record.contractAddress)
  }

  async readFts1(assetId: string): Promise<OnChainFts1> {
    const record = await this.recordOnThisNetwork(assetId)
    return this.readFts1Contract(record.contractAddress)
  }

  async getReceipt(hash: string): Promise<TransactionReceipt | null> {
    return readReceipt(this.rpcUrl, hash)
  }

  async getLogs(assetId: string): Promise<TransactionReceipt['logs']> {
    const record = await this.recordOnThisNetwork(assetId)
    const result = await rpcCall(this.rpcUrl, 'eth_getLogs', [{
      fromBlock: 'earliest',
      toBlock: 'latest',
      address: record.contractAddress,
      topics: [TRANSFER_TOPIC],
    }])
    if (!Array.isArray(result)) throw new AssetEngineError('eth_getLogs did not return a list')
    return result.map((entry) => {
      const log = entry as { address?: unknown; topics?: unknown; data?: unknown }
      if (typeof log.address !== 'string' || typeof log.data !== 'string' || !Array.isArray(log.topics)) {
        throw new AssetEngineError('eth_getLogs entry is malformed')
      }
      return {
        address: log.address,
        data: log.data,
        topics: log.topics.map((topic) => {
          if (typeof topic !== 'string') throw new AssetEngineError('log topic is not a string')
          return topic
        }),
      }
    })
  }

  async attachLogo(assetId: string, bytes: Uint8Array): Promise<DeploymentRecord> {
    const record = await this.recordOnThisNetwork(assetId)
    const logo = await this.registry.storeLogo(bytes)
    const next: DeploymentRecord = {
      ...record,
      metadata: { ...record.metadata, logo },
    }
    await this.registry.replace(next)
    return next
  }

  /**
   * Sign one call and submit it. A mock or remote node that cannot serve the
   * following token reads is not recorded as a deployment by {@link deployFungible}.
   */
  async signAndSubmit(call: { to?: string; data: Uint8Array }, allowMainnet = false): Promise<MinedCall> {
    this.assertCanSend(allowMainnet)
    const quote = await this.estimateFees(call)
    const balance = await this.nativeBalance()
    if (balance < quote.estimatedNativeFee) {
      throw new AssetEngineError(
        `insufficient ${quote.nativeSymbol} for the fee ceiling. No transaction was submitted.`,
      )
    }
    const nonceResult = await rpcCall(this.rpcUrl, 'eth_getTransactionCount', [this.signer.address, 'latest'])
    const signed = this.signer.sign(this.profile, {
      nonce: parseQuantity(nonceResult, 'nonce'),
      gasLimit: quote.gasLimit,
      data: call.data,
      fees: quote,
      ...(call.to === undefined ? {} : { to: normalizeAddress(call.to) }),
    })
    if (signed.chainId !== BigInt(this.profile.chainId) || signed.type !== (quote.model === 'legacy' ? 0 : 2)) {
      throw new AssetEngineError('signed transaction does not match the connected network fee model')
    }
    const submitted = await rpcCall(this.rpcUrl, 'eth_sendRawTransaction', [bytesToHex(signed.raw)])
    if (typeof submitted !== 'string' || submitted.toLowerCase() !== signed.hash) {
      throw new AssetEngineError('the node returned a different transaction hash. The local hash was not replaced with it.')
    }
    if (this.devSequencer) await this.mine(signed.hash)
    const receipt = await readReceipt(this.rpcUrl, signed.hash)
    if (receipt === null) throw new AssetEngineError(`transaction ${signed.hash} was not included`)
    if (receipt.status !== '0x1') {
      throw new AssetEngineError(`transaction ${signed.hash} reverted`)
    }
    return { transactionHash: signed.hash, receipt, quote }
  }

  private async recordOnThisNetwork(assetId: string): Promise<DeploymentRecord> {
    const records = await this.registry.list()
    const record = records.find((candidate) => candidate.assetId === assetId)
    if (record === undefined) throw new AssetEngineError(`no recorded deployment ${assetId}`)
    requireSameNetwork(this.profile.id, record)
    if (record.chainId !== this.profile.chainId) refuseChainMismatch(record.chainId, this.profile.chainId)
    return record
  }

  private assertCanSend(allowMainnet: boolean): void {
    if (this.profile.deploymentPolicy === 'mainnet-disabled' && !allowMainnet) {
      throw new AssetEngineError(
        `${this.profile.name} (chain ${this.profile.chainId}) is configured, and deployment is disabled until allowMainnet is set. Use the testnet profile first.`,
      )
    }
  }

  private async observeFees(): Promise<FeeFields> {
    const block = await rpcCall(this.rpcUrl, 'eth_getBlockByNumber', ['latest', false]) as BlockView
    const baseFeePerGas = block?.baseFeePerGas == null ? undefined : parseQuantity(block.baseFeePerGas, 'base fee')
    if (this.profile.feeMarket === 'eip-1559-only') {
      return feeFieldsForProfile(this.profile, { baseFeePerGas, gasPrice: undefined, priorityFee: undefined })
    }
    if (baseFeePerGas !== undefined) {
      const priority = await optionalRpc(this.rpcUrl, 'eth_maxPriorityFeePerGas', [])
      return feeFieldsForProfile(this.profile, {
        baseFeePerGas,
        gasPrice: undefined,
        priorityFee: priority === undefined ? undefined : parseQuantity(priority, 'priority fee'),
      })
    }
    const gasPrice = await rpcCall(this.rpcUrl, 'eth_gasPrice', [])
    return feeFieldsForProfile(this.profile, {
      baseFeePerGas: undefined,
      gasPrice: parseQuantity(gasPrice, 'gas price'),
      priorityFee: undefined,
    })
  }

  private async estimateGas(call: { to?: string; data: Uint8Array }, fields: FeeFields): Promise<bigint> {
    const result = await rpcCall(this.rpcUrl, 'eth_estimateGas', [{
      from: this.signer.address,
      data: bytesToHex(call.data),
      value: '0x0',
      ...(call.to === undefined ? {} : { to: normalizeAddress(call.to) }),
      ...(fields.model === 'legacy' && fields.gasPrice !== undefined ? { gasPrice: quantity(fields.gasPrice) } : {}),
    }])
    const gasLimit = parseQuantity(result, 'gas estimate')
    if (gasLimit <= 0n) throw new AssetEngineError('gas estimate was zero')
    return gasLimit
  }

  private async mine(hash: string): Promise<void> {
    const result = await rpcCall(this.rpcUrl, 'btcs_dev_mine', []) as MineResult
    const included = Array.isArray(result.transactions)
      ? result.transactions.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase())
      : []
    if (!included.includes(hash)) {
      const discarded = JSON.stringify(result.discardedTransactions ?? []).slice(0, 300)
      throw new AssetEngineError(`BTCS dev sequencer did not include ${hash} (${discarded})`)
    }
  }

  private async ethCall(to: string, data: Uint8Array): Promise<string> {
    const result = await rpcCall(this.rpcUrl, 'eth_call', [{
      from: this.signer.address,
      to,
      data: bytesToHex(data),
    }, 'latest'])
    if (typeof result !== 'string') throw new AssetEngineError('eth_call did not return hex')
    return result
  }

  private async readContract(contractAddress: string): Promise<OnChainFungible> {
    const compiled = compileFungibleAsset()
    const name = decodeString(await this.ethCall(contractAddress, encodeCall(compiled, 'name()', [])))
    const symbol = decodeString(await this.ethCall(contractAddress, encodeCall(compiled, 'symbol()', [])))
    const decimals = Number(decodeUint(await this.ethCall(contractAddress, encodeCall(compiled, 'decimals()', []))))
    const totalSupply = decodeUint(await this.ethCall(contractAddress, encodeCall(compiled, 'totalSupply()', [])))
    const owner = decodeAddress(await this.ethCall(contractAddress, encodeCall(compiled, 'owner()', [])))
    return { name, symbol, decimals, totalSupply, owner }
  }

  private async readFts1Contract(contractAddress: string): Promise<OnChainFts1> {
    const compiled = compileBsnaFts1()
    const read = async (signature: string): Promise<string> =>
      this.ethCall(contractAddress, encodeCall(compiled, signature, []))
    return {
      standard: decodeString(await read('bsnaStandard()')),
      version: decodeString(await read('bsnaVersion()')),
      name: decodeString(await read('name()')),
      symbol: decodeString(await read('symbol()')),
      decimals: Number(decodeUint(await read('decimals()'))),
      totalSupply: decodeUint(await read('totalSupply()')),
      admin: decodeAddress(await read('admin()')),
      minter: decodeAddress(await read('minter()')),
      supplyPolicy: Number(decodeUint(await read('supplyPolicy()'))),
      burnPolicy: Number(decodeUint(await read('burnPolicy()'))),
      pausePolicy: Number(decodeUint(await read('pausePolicy()'))),
      maxSupply: decodeUint(await read('maxSupply()')),
      metadataMutable: decodeUint(await read('metadataMutable()')) === 1n,
      metadataUri: decodeString(await read('metadataURI()')),
      metadataHash: decodeUint(await read('metadataHash()')),
      paused: decodeUint(await read('paused()')) === 1n,
    }
  }

  private recordFor(
    spec: FungibleSpec,
    contractAddress: string,
    creationTransactionHash: string,
    creationBytecodeSha256: string,
    logo: StoredLogo | null,
  ): DeploymentRecord {
    return {
      version: 1,
      assetId: assetIdFor(this.profile.id, contractAddress),
      networkId: this.profile.id,
      networkName: this.profile.name,
      chainId: this.profile.chainId,
      interfaceConvention: this.profile.interfaceConvention,
      standard: 'ERC-20',
      contractAddress,
      deployer: this.signer.address,
      creationTransactionHash,
      creationBytecodeSha256,
      compilerEvmVersion: 'london',
      name: spec.name,
      symbol: spec.symbol,
      decimals: spec.decimals,
      supplyAtomic: spec.atomicSupply.toString(10),
      supplyUnit: 'atomic',
      permissions: {
        owner: this.signer.address,
        supplyPolicy: 'fixed',
        mint: 'none',
        burn: 'none',
        transfer: 'holder',
      },
      metadata: {
        description: spec.description ?? '',
        externalUrl: spec.externalUrl ?? null,
        logo,
      },
      nativeGas: { ...this.profile.nativeGas },
      explorerTransactionUrl: this.explorerTransactionUrl(creationTransactionHash),
      verification: 'not-submitted',
      sameAssetOnOtherNetworks: [],
    }
  }

  private recordForFts1(
    spec: Fts1Spec,
    contractAddress: string,
    creationTransactionHash: string,
    creationBytecodeSha256: string,
    logo: StoredLogo | null,
  ): DeploymentRecord {
    return {
      version: 1,
      assetId: assetIdFor(this.profile.id, contractAddress),
      networkId: this.profile.id,
      networkName: this.profile.name,
      chainId: this.profile.chainId,
      interfaceConvention: this.profile.interfaceConvention,
      standard: 'BSNA-FTS1',
      contractAddress,
      deployer: this.signer.address,
      creationTransactionHash,
      creationBytecodeSha256,
      compilerEvmVersion: 'london',
      name: spec.name,
      symbol: spec.symbol,
      decimals: spec.decimals,
      supplyAtomic: spec.atomicSupply.toString(10),
      supplyUnit: 'atomic',
      permissions: {
        owner: this.signer.address,
        supplyPolicy: spec.supplyPolicy,
        mint: spec.supplyPolicy === 'authorized-mint' ? 'minter' : 'none',
        burn: spec.burnPolicy === 'holder-burn' ? 'holder' : 'none',
        transfer: 'holder',
        pause: spec.pausePolicy === 'admin-pause' ? 'admin' : 'none',
        metadataMutable: spec.metadataMutable,
      },
      metadata: {
        description: spec.description ?? '',
        externalUrl: spec.externalUrl ?? null,
        logo,
        uri: spec.metadataUri,
        hash: `0x${spec.metadataHash.toString(16).padStart(64, '0')}`,
      },
      nativeGas: { ...this.profile.nativeGas },
      explorerTransactionUrl: this.explorerTransactionUrl(creationTransactionHash),
      verification: this.profile.explorer === null ? 'unsupported' : 'not-submitted',
      sameAssetOnOtherNetworks: [],
    }
  }
}

export async function validateConnection(profile: NetworkProfile, rpcUrl: string): Promise<ConnectionReport> {
  const chainResult = await rpcCall(rpcUrl, 'eth_chainId', [])
  const chainId = parseQuantity(chainResult, 'eth_chainId')
  if (chainId !== BigInt(profile.chainId)) {
    throw new AssetEngineError(
      `${profile.id} expected chain ${profile.chainId} and the RPC reported ${chainId}. No transaction was sent.`,
    )
  }
  const version = await optionalRpc(rpcUrl, 'net_version', [])
  if (version !== undefined && version !== String(profile.chainId)) {
    throw new AssetEngineError(`${profile.id} net_version does not match chain ${profile.chainId}`)
  }
  let clientVersion: string | null = null
  try {
    const client = await rpcCall(rpcUrl, 'web3_clientVersion', [])
    clientVersion = typeof client === 'string' ? client : null
  } catch {
    // Client version is informational. BTCS local still rejects a missing BTCSL2 banner below.
    clientVersion = null
  }
  if (profile.kind === 'btcs-l2-local' && (clientVersion === null || !clientVersion.startsWith('BTCSL2/'))) {
    throw new AssetEngineError(
      'BTCS L2 local RPC must identify itself as BTCSL2/. Chain id 31337 alone is shared with other development chains. No transaction was sent.',
    )
  }
  const blockNumber = parseQuantity(await rpcCall(rpcUrl, 'eth_blockNumber', []), 'block number')
  return {
    networkId: profile.id,
    chainId: profile.chainId,
    nativeSymbol: profile.nativeGas.symbol,
    blockNumber,
    clientVersion,
    rpcValidated: true,
    liveNetworkProven: false,
  }
}

async function readReceipt(url: string, hash: string): Promise<TransactionReceipt | null> {
  const result = await rpcCall(url, 'eth_getTransactionReceipt', [hash])
  if (result === null) return null
  const receipt = result as {
    transactionHash?: unknown
    status?: unknown
    contractAddress?: unknown
    gasUsed?: unknown
    effectiveGasPrice?: unknown
    blockNumber?: unknown
    from?: unknown
    to?: unknown
    logs?: unknown
  }
  if (typeof receipt.transactionHash !== 'string' || typeof receipt.status !== 'string' || typeof receipt.blockNumber !== 'string') {
    throw new AssetEngineError('transaction receipt is missing hash, status, or block')
  }
  if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) {
    throw new AssetEngineError('transaction receipt hash does not match the signed transaction')
  }
  const logs = Array.isArray(receipt.logs) ? receipt.logs.map((entry) => {
    const log = entry as { address?: unknown; topics?: unknown; data?: unknown }
    if (typeof log.address !== 'string' || typeof log.data !== 'string' || !Array.isArray(log.topics)) {
      throw new AssetEngineError('receipt log is malformed')
    }
    return {
      address: log.address,
      data: log.data,
      topics: log.topics.map((topic) => {
        if (typeof topic !== 'string') throw new AssetEngineError('receipt log topic is not a string')
        return topic
      }),
    }
  }) : []
  return {
    transactionHash: receipt.transactionHash.toLowerCase(),
    status: receipt.status,
    contractAddress: typeof receipt.contractAddress === 'string' ? receipt.contractAddress.toLowerCase() : null,
    gasUsed: parseQuantity(receipt.gasUsed, 'gas used'),
    effectiveGasPrice: parseQuantity(receipt.effectiveGasPrice, 'effective gas price'),
    blockNumber: receipt.blockNumber,
    from: typeof receipt.from === 'string' ? receipt.from.toLowerCase() : '',
    to: typeof receipt.to === 'string' ? receipt.to.toLowerCase() : null,
    logs,
  }
}

function assertDevSequencer(profile: NetworkProfile, devSequencer: boolean): void {
  if (devSequencer && profile.kind !== 'btcs-l2-local') {
    throw new AssetEngineError('btcs_dev_mine is only valid on the BTCS L2 local development network')
  }
}

function refuseChainMismatch(recordChainId: number, connectedChainId: number): never {
  throw new AssetEngineError(
    `recorded chain ${recordChainId} is not the connected chain ${connectedChainId}. Supply stays on the network where it was deployed.`,
  )
}

export function liveBnbTestnetConfigured(): boolean {
  return envPresent('BNB_TESTNET_RPC_URL') && envPresent('BNB_TESTNET_PRIVATE_KEY')
}

function envPresent(name: string): boolean {
  const value = process.env[name]
  return value !== undefined && value.trim() !== ''
}

export function parsePrivateKeyHex(value: string): Uint8Array {
  const match = /^0x[0-9a-fA-F]{64}$/.exec(value.trim())
  if (match === null) throw new AssetEngineError('private key must be 0x plus 32 bytes of hex')
  const bytes = new Uint8Array(32)
  for (let index = 0; index < 32; index += 1) {
    const byte = value.trim().slice(2 + index * 2, 4 + index * 2)
    bytes[index] = Number.parseInt(byte, 16)
  }
  return bytes
}

export type { SignedCall }
