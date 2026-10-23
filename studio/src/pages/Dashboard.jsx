import React, { useState, useEffect, useCallback } from 'react'
import { rpcCall } from '../lib/api'


function Dashboard() {
  const [l2Status, setL2Status] = useState({
    blockNumber: '0',
    chainId: '0x7a69',
    gasPrice: null,
    baseFee: null,
  })
  const [l1Status, setL1Status] = useState({ connected: false, blockHeight: 0 })
  const [loading, setLoading] = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)

  const fetchL2Status = useCallback(async () => {
    try {
      const [blockNumber, chainId, gasPrice, netVersion, netListening, netPeerCount] = await Promise.all([
        rpcCall('eth_blockNumber'),
        rpcCall('eth_chainId'),
        rpcCall('eth_gasPrice'),
        rpcCall('net_version'),
        rpcCall('net_listening'),
        rpcCall('net_peerCount'),
      ])

      setL2Status({
        blockNumber: parseInt(blockNumber, 16).toString(),
        chainId: `0x${parseInt(chainId, 16).toString(16)}`,
        gasPrice: gasPrice ? `${(parseInt(gasPrice, 16) / 1e9).toFixed(2)} gwei` : 'N/A',
        baseFee: 'N/A', // Would need eth_getBlockByNumber for baseFee
        netVersion,
        netListening,
        netPeerCount,
      })
      setLastUpdate(new Date().toLocaleTimeString())
    } catch (error) {
      console.error('Failed to fetch L2 status:', error)
      setL2Status(prev => ({ ...prev, blockNumber: 'Error', chainId: 'Error' }))
    }
  }, [])

  const fetchL1Status = useCallback(async () => {
    // Try to check if BTCS Core is running on default regtest RPC port
    try {
      const response = await fetch('http://127.0.0.1:18443', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getblockchaininfo', params: [] }),
      })
      if (response.ok) {
        const data = await response.json()
        if (data.result && data.result.chain === 'regtest') {
          setL1Status({ connected: true, blockHeight: data.result.blocks })
        } else {
          setL1Status({ connected: false, blockHeight: 0 })
        }
      } else {
        setL1Status({ connected: false, blockHeight: 0 })
      }
    } catch {
      setL1Status({ connected: false, blockHeight: 0 })
    }
  }, [])

  const handleMineBlock = async () => {
    setLoading(true)
    try {
      await rpcCall('btcs_dev_mine', [])
      await fetchL2Status()
    } catch (error) {
      console.error('Mine failed:', error)
      alert(`Mine failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = async () => {
    await Promise.all([fetchL2Status(), fetchL1Status()])
  }

  useEffect(() => {
    handleRefresh()
    const interval = setInterval(handleRefresh, 10000)
    return () => clearInterval(interval)
  }, [fetchL2Status, fetchL1Status, handleRefresh])

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <h1 style={{ color: 'var(--btcs-gold)', margin: 0 }}>Bitcoin Silver L2 Developer Studio</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          Last updated: {lastUpdate || 'Never'}
          <button className="btn btn-secondary" onClick={handleRefresh} disabled={loading} style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="warning">
        <strong>EXPERIMENTAL PROTOTYPE</strong> - Trusted single-operator model. Not for production or real funds.
        L1 anchors are not fraud proofs. Payouts disabled by default.
      </div>

      <div className="grid">
        <div className="card">
          <div className="card-header">L1 Node (BTCS Core)</div>
          <div className="stat">
            <div className="stat-label">Status</div>
            <div className="stat-value" style={{ color: l1Status.connected ? 'var(--success)' : 'var(--text-secondary)' }}>
              {l1Status.connected ? 'Connected' : 'Not Connected'}
            </div>
          </div>
          <div className="stat" style={{ marginTop: '0.5rem' }}>
            <div className="stat-label">Block Height</div>
            <div className="stat-value">{l1Status.connected ? l1Status.blockHeight : 'N/A'}</div>
          </div>
          <div className="stat" style={{ marginTop: '0.5rem' }}>
            <div className="stat-label">Network</div>
            <div className="stat-value">regtest</div>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
            Start via launcher or manually
          </p>
        </div>

        <div className="card">
          <div className="card-header">L2 Node (EVM)</div>
          <div className="stat">
            <div className="stat-label">Chain ID</div>
            <div className="stat-value">{l2Status.chainId} (31337)</div>
          </div>
          <div className="stat" style={{ marginTop: '0.5rem' }}>
            <div className="stat-label">Block Number</div>
            <div className="stat-value">{l2Status.blockNumber}</div>
          </div>
          <div className="stat" style={{ marginTop: '0.5rem' }}>
            <div className="stat-label">Gas Price</div>
            <div className="stat-value">{l2Status.gasPrice}</div>
          </div>
          <div className="stat" style={{ marginTop: '0.5rem' }}>
            <div className="stat-label">net_version</div>
            <div className="stat-value">{l2Status.netVersion || 'N/A'}</div>
          </div>
          <div className="stat" style={{ marginTop: '0.5rem' }}>
            <div className="stat-label">net_listening</div>
            <div className="stat-value">{l2Status.netListening !== undefined ? String(l2Status.netListening) : 'N/A'}</div>
          </div>
          <div className="stat" style={{ marginTop: '0.5rem' }}>
            <div className="stat-label">net_peerCount</div>
            <div className="stat-value">{l2Status.netPeerCount || 'N/A'}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-header">Developer Tools</div>
          <button className="btn" style={{ marginBottom: '0.5rem', width: '100%' }} onClick={handleMineBlock} disabled={loading}>
            {loading ? 'Mining...' : 'Mine Block (Dev)'}
          </button>
          <button className="btn" style={{ width: '100%' }} onClick={handleRefresh} disabled={loading}>
            Refresh Status
          </button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Quick Start</div>
        <ol style={{ color: 'var(--text-secondary)', paddingLeft: '1.5rem', lineHeight: 2 }}>
          <li>Start L1 node (BTCS Core) and L2 node via Nodes tab or launcher</li>
          <li>Connect a browser wallet (MetaMask) to http://127.0.0.1:8545, Chain ID 31337</li>
          <li>Use Token Studio to deploy ERC-20 or NFT collections</li>
          <li>All operations on local development network only</li>
        </ol>
      </div>

      <div className="card">
        <div className="card-header">RPC Endpoint</div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <code style={{ background: 'var(--bg-secondary)', padding: '0.5rem 1rem', borderRadius: '4px', flex: 1, minWidth: '200px' }}>
            http://127.0.0.1:8545
          </code>
          <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText('http://127.0.0.1:8545')}>
            Copy RPC URL
          </button>
          <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText('0x7a69')}>
            Copy Chain ID (0x7a69)
          </button>
        </div>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontSize: '0.875rem' }}>
          Add as custom network in MetaMask: Network Name "BTCS L2 Local", RPC URL above, Chain ID 31337, Currency Symbol BTCS
        </p>
      </div>
    </div>
  )
}

export default Dashboard