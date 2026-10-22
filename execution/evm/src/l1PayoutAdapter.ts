import { ProtocolError } from './blockProcessor.js'

export type PayoutRequest = Readonly<{
  toAddress: string
  amountSats: bigint
  withdrawalId: string
}>

export type PayoutResult = Readonly<{
  txid: string
  rawTx: string
  fee: bigint
}>

export type L1PayoutAdapterConfig = Readonly<{
  enabled: boolean
  chainId: 'regtest'
  rpcUrl?: string
  rpcUser?: string
  rpcPassword?: string
  walletName?: string
  maxAmountSats: bigint
}>

export type L1PayoutRpc = Readonly<{
  getBlockchainInfo(): Promise<{ chain: string; blocks: number }>
  getNetworkInfo?(): Promise<unknown>
  sendToAddress?(address: string, amount: number): Promise<string>
  sendRawTransaction?(rawTx: string): Promise<string>
  createRawTransaction?(inputs: unknown[], outputs: Record<string, number>): Promise<string>
  fundRawTransaction?(rawTx: string): Promise<{ hex: string; fee: number }>
  signRawTransactionWithWallet?(rawTx: string): Promise<{ hex: string; complete: boolean }>
  getTransaction?(txid: string): Promise<{ confirmations?: number; blockhash?: string }>
  getMempoolEntry?(txid: string): Promise<unknown>
}>

export class L1PayoutAdapter {
  private config: L1PayoutAdapterConfig

  constructor(config: L1PayoutAdapterConfig) {
    this.config = config
  }

  static createDisabled(): L1PayoutAdapter {
    return new L1PayoutAdapter({
      enabled: false,
      chainId: 'regtest',
      maxAmountSats: 1000000n,
    })
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  async validateChain(rpc: L1PayoutRpc): Promise<void> {
    if (!this.config.enabled) {
      throw new ProtocolError('L1 payout adapter is disabled')
    }
    const info = await rpc.getBlockchainInfo()
    if (info.chain !== this.config.chainId) {
      throw new ProtocolError(`Wrong chain: expected ${this.config.chainId}, got ${info.chain}. REFUSING to broadcast.`)
    }
  }

  async preparePayout(rpc: L1PayoutRpc, request: PayoutRequest): Promise<PayoutResult> {
    if (!this.config.enabled) {
      throw new ProtocolError('L1 payout adapter is disabled - payouts not enabled')
    }
    await this.validateChain(rpc)
    
    if (request.amountSats <= 0n) {
      throw new ProtocolError('amount must be positive')
    }
    if (request.amountSats > this.config.maxAmountSats) {
      throw new ProtocolError('amount exceeds max payout')
    }
    if (!/^[0-9a-f]{64}$/.test(request.withdrawalId)) {
      throw new ProtocolError('invalid withdrawal id')
    }
    if (request.toAddress.length < 26 || request.toAddress.length > 90) {
      throw new ProtocolError('invalid destination address')
    }

    // For regtest, use sendToAddress if available
    if (rpc.sendToAddress) {
      const amountBtc = Number(request.amountSats) / 100000000
      const txid = await rpc.sendToAddress(request.toAddress, amountBtc)
      if (!/^[0-9a-f]{64}$/.test(txid)) {
        throw new ProtocolError('invalid txid from wallet')
      }
      return { txid, rawTx: '', fee: 0n }
    }

    throw new ProtocolError('no suitable payout method available')
  }

  async checkPayoutStatus(rpc: L1PayoutRpc, txid: string): Promise<{ confirmations: number; inMempool: boolean; confirmed: boolean }> {
    if (!/^[0-9a-f]{64}$/.test(txid)) {
      throw new ProtocolError('invalid txid')
    }
    
    // Check mempool first
    if (rpc.getMempoolEntry) {
      try {
        await rpc.getMempoolEntry(txid)
        return { confirmations: 0, inMempool: true, confirmed: false }
      } catch {
        // Not in mempool, check tx
      }
    }

    if (rpc.getTransaction) {
      try {
        const tx = await rpc.getTransaction(txid)
        const confs = typeof tx.confirmations === 'number' ? tx.confirmations : 0
        return { confirmations: confs, inMempool: false, confirmed: confs > 0 }
      } catch {
        return { confirmations: 0, inMempool: false, confirmed: false }
      }
    }

    return { confirmations: 0, inMempool: false, confirmed: false }
  }
}
