import React, { useCallback, useEffect, useState } from 'react'
import {
  createSilverPayClient,
  formatSats,
  formatWei,
  isStale,
  shorten,
} from '../lib/silverpay'

const client = createSilverPayClient()
const STALE_AFTER_MS = 30_000
const DEFAULT_L2_ADDRESS = import.meta.env?.VITE_SILVERPAY_L2_ADDRESS || ''

function initialSource() {
  return { loading: false, data: null, error: null, observedAt: null }
}

function sourceState(state) {
  if (state.loading && state.data === null) return 'loading'
  if (state.error !== null) return state.data === null ? 'unavailable' : 'stale'
  if (state.data !== null) return 'ready'
  return 'idle'
}

function SourceBadge({ state, now }) {
  const kind = sourceState(state)
  if (kind === 'loading') return <span className="status-chip status-loading">Loading</span>
  if (kind === 'unavailable') return <span className="status-chip status-error">Unavailable</span>
  if (kind === 'stale') return <span className="status-chip status-warning">Stale</span>
  if (kind === 'ready') {
    return isStale(state.observedAt, now, STALE_AFTER_MS) ? (
      <span className="status-chip status-warning">Stale</span>
    ) : (
      <span className="status-chip status-ok">Live</span>
    )
  }
  return <span className="status-chip">Not requested</span>
}

function SourceMessage({ state }) {
  if (state.error === null) return null
  return (
    <div className="inline-error">
      {state.data !== null ? 'Showing the last successful read. ' : ''}
      {state.error}
    </div>
  )
}

function formatTime(value) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return 'never'
  return new Date(value).toLocaleTimeString()
}

function L1Panel({ status, now }) {
  const network = status.data?.l1.network
  const wallet = status.data?.l1.wallet
  const networkData = network?.ok ? network.data : null
  const walletData = wallet?.ok ? wallet.data : null

  return (
    <section className="card silverpay-panel">
      <div className="silverpay-panel-heading">
        <div>
          <div className="eyebrow">BTCS L1 · UTXO account</div>
          <h2 className="card-header silverpay-heading">L1 network and Core wallet</h2>
        </div>
        <SourceBadge state={status} now={now} />
      </div>
      <SourceMessage state={status} />

      {network && !network.ok && (
        <div className="inline-error">L1 network unavailable: {network.error.message}</div>
      )}
      {wallet && !wallet.ok && (
        <div className="inline-error">L1 wallet unavailable: {wallet.error.message}</div>
      )}

      {networkData ? (
        <div className="grid silverpay-stats">
          <div className="stat">
            <div className="stat-label">Chain</div>
            <div className="stat-value">{networkData.chain}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Block height</div>
            <div className="stat-value">{networkData.blocks}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Peer connections</div>
            <div className="stat-value">{networkData.peer?.connections ?? 0}</div>
          </div>
        </div>
      ) : (
        <p className="muted">No L1 network data has been returned.</p>
      )}

      {walletData ? (
        <>
          <div className="grid silverpay-stats">
            <div className="stat">
              <div className="stat-label">Core wallet</div>
              <div className="stat-value">{walletData.walletName}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Wallet balance</div>
              <div className="stat-value">{formatSats(walletData.balanceSats)} BTCS</div>
            </div>
            <div className="stat">
              <div className="stat-label">Unspent outputs</div>
              <div className="stat-value">
                {walletData.utxoCount}
                {walletData.truncated ? ` of ${walletData.utxoTotal}` : ''}
              </div>
            </div>
          </div>
          <div className="silverpay-subtle">
            Trusted {formatSats(walletData.trustedSats)} · pending{' '}
            {formatSats(walletData.pendingSats)} · immature{' '}
            {formatSats(walletData.immatureSats)} BTCS
          </div>
          {walletData.utxos.length === 0 ? (
            <p className="muted">Core returned no unspent outputs for this wallet.</p>
          ) : (
            <div className="table-scroll">
              <table className="table">
                <thead>
                  <tr>
                    <th>Outpoint</th>
                    <th>Address</th>
                    <th>Amount</th>
                    <th>Confirmations</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {walletData.utxos.map((utxo) => (
                    <tr key={`${utxo.txid}:${utxo.vout}`}>
                      <td className="mono" title={`${utxo.txid}:${utxo.vout}`}>
                        {shorten(utxo.txid, 10, 6)}:{utxo.vout}
                      </td>
                      <td className="mono" title={utxo.address || ''}>
                        {utxo.address ? shorten(utxo.address, 10, 6) : 'no address'}
                      </td>
                      <td className="mono">{formatSats(utxo.amountSats)} BTCS</td>
                      <td>{utxo.confirmations}</td>
                      <td>{utxo.spendable ? 'spendable' : 'not spendable'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <p className="muted">No L1 wallet data has been returned.</p>
      )}
    </section>
  )
}

function L2Panel({ status, account, address, onAddressChange, onLoadAccount, now }) {
  const network = status.data?.l2.network
  const networkData = network?.ok ? network.data : null
  const accountData = account.data?.data ?? null

  return (
    <section className="card silverpay-panel">
      <div className="silverpay-panel-heading">
        <div>
          <div className="eyebrow">BTCS L2 · EVM account</div>
          <h2 className="card-header silverpay-heading">L2 network and account</h2>
        </div>
        <SourceBadge state={account} now={now} />
      </div>

      {network && !network.ok && (
        <div className="inline-error">L2 network unavailable: {network.error.message}</div>
      )}
      {networkData ? (
        <div className="grid silverpay-stats">
          <div className="stat">
            <div className="stat-label">Chain ID</div>
            <div className="stat-value">{networkData.chainId}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Block number</div>
            <div className="stat-value">{networkData.blockNumber}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Client</div>
            <div className="stat-value silverpay-small-value">
              {networkData.clientVersion}
            </div>
          </div>
        </div>
      ) : (
        <p className="muted">No L2 network data has been returned.</p>
      )}

      <label className="label" htmlFor="silverpay-l2-address">
        L2 EVM address (read-only lookup)
      </label>
      <div className="silverpay-address-row">
        <input
          id="silverpay-l2-address"
          className="input"
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          placeholder="0x..."
          autoComplete="off"
          spellCheck="false"
        />
        <button className="btn btn-secondary" onClick={onLoadAccount} disabled={account.loading}>
          {account.loading ? 'Reading…' : 'Read account'}
        </button>
      </div>
      <p className="silverpay-subtle">
        This lookup needs no private key. It does not connect a signer or enable sending.
      </p>

      <SourceMessage state={account} />
      {accountData ? (
        <div className="grid silverpay-stats">
          <div className="stat">
            <div className="stat-label">Address</div>
            <div className="stat-value mono silverpay-small-value" title={accountData.address}>
              {shorten(accountData.address, 10, 8)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Balance</div>
            <div className="stat-value">{formatWei(accountData.balanceWei)} BTCS</div>
          </div>
          <div className="stat">
            <div className="stat-label">Nonce</div>
            <div className="stat-value">{accountData.nonce}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Account type</div>
            <div className="stat-value silverpay-small-value">
              {accountData.isContract ? 'Contract' : 'Externally owned'}
            </div>
          </div>
        </div>
      ) : (
        <p className="muted">
          Enter an L2 address to read its current balance from the configured L2 RPC.
        </p>
      )}
    </section>
  )
}

function SilverPayWallet() {
  const [status, setStatus] = useState(initialSource)
  const [account, setAccount] = useState(initialSource)
  const [address, setAddress] = useState(DEFAULT_L2_ADDRESS)
  const [now, setNow] = useState(Date.now())

  const loadStatus = useCallback(async () => {
    setStatus((previous) => ({ ...previous, loading: true, error: null }))
    try {
      const data = await client.status()
      setStatus({ loading: false, data, error: null, observedAt: data.observedAt })
    } catch (error) {
      setStatus((previous) => ({
        ...previous,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    }
  }, [])

  const loadAccount = useCallback(
    async (target = address) => {
      const candidate = target.trim()
      if (candidate.length === 0) {
        setAccount({
          loading: false,
          data: null,
          error: 'enter an L2 address before reading an account',
          observedAt: null,
        })
        return
      }
      setAccount((previous) => ({ ...previous, loading: true, error: null }))
      try {
        const data = await client.account(candidate)
        setAccount({ loading: false, data, error: null, observedAt: data.observedAt })
      } catch (error) {
        setAccount((previous) => ({
          ...previous,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }))
      }
    },
    [address],
  )

  useEffect(() => {
    loadStatus()
    const statusInterval = setInterval(loadStatus, 20_000)
    const clockInterval = setInterval(() => setNow(Date.now()), 5_000)
    return () => {
      clearInterval(statusInterval)
      clearInterval(clockInterval)
    }
  }, [loadStatus])

  useEffect(() => {
    if (DEFAULT_L2_ADDRESS) loadAccount(DEFAULT_L2_ADDRESS)
    // The default address is a build-time convenience, not a signing identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refresh = () => {
    setNow(Date.now())
    void loadStatus()
    if (address.trim().length > 0) void loadAccount()
  }

  const lastRead = status.observedAt || account.observedAt
  const stale = lastRead !== null && isStale(lastRead, now, STALE_AFTER_MS)

  return (
    <div className="container">
      <div className="silverpay-title-row">
        <div>
          <div className="eyebrow">SilverPay · Wallet foundation</div>
          <h1 className="silverpay-title">SilverPay</h1>
          <p className="muted silverpay-intro">
            SilverPay is the unified wallet, account, and digital-asset
            experience. This read-only preview keeps the configured BTCS L1
            Core wallet and BTCS L2 EVM account separate.
          </p>
        </div>
        <button className="btn btn-secondary" onClick={refresh} disabled={status.loading || account.loading}>
          {status.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="warning">
        <strong>Read-only preview.</strong> Balances are read from the configured
        nodes. Signing, sending, receiving, recovery, transaction history, and future
        SilverPay payment features are not implemented. Do not send funds to
        addresses shown here based on this preview.
      </div>

      <div className="silverpay-meta">
        <span>Last successful read: {formatTime(lastRead)}</span>
        {stale && <span className="status-chip status-warning">Data is stale</span>}
        <span className="muted">Service: {client.baseUrl}</span>
      </div>

      <div className="grid silverpay-panels">
        <L1Panel status={status} now={now} />
        <L2Panel
          status={status}
          account={account}
          address={address}
          onAddressChange={setAddress}
          onLoadAccount={() => void loadAccount()}
          now={now}
        />
      </div>

      <div className="card">
        <div className="card-header">Capability boundary</div>
        <div className="silverpay-boundary">
          <div>
            <strong>Working now</strong>
            <p>Separate L1 and L2 network identity, Core wallet balance/UTXOs, and L2 account balance/nonce reads.</p>
          </div>
          <div>
            <strong>Not implemented</strong>
            <p>
              Signing, send/receive, recovery, transaction history, and L2
              transaction submission are not implemented. Payment and merchant
              features are later SilverPay milestones.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default SilverPayWallet
