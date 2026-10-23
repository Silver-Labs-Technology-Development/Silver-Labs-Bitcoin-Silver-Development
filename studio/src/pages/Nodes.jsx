import React, { useState, useEffect, useCallback } from 'react'
import { rpcCall } from '../lib/api'


function Nodes() {
  const [l1Status, setL1Status] = useState({ connected: false, blockHeight: 0, chain: 'unknown' })
  const [l2Status, setL2Status] = useState({ connected: false, blockNumber: 0, chainId: 0, clientVersion: '' })
  const [l1Loading, setL1Loading] = useState(false)
  const [l2Loading, setL2Loading] = useState(false)

  const checkL1 = useCallback(async () => {
    setL1Loading(true)
    try {
      const response = await fetch('http://127.0.0.1:18443', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getblockchaininfo', params: [] }),
      })
      if (response.ok) {
        const data = await response.json()
        if (data.result) {
          setL1Status({
            connected: true,
            blockHeight: data.result.blocks,
            chain: data.result.chain
          })
        } else {
          setL1Status({ connected: false, blockHeight: 0, chain: 'unknown' })
        }
      } else {
        setL1Status({ connected: false, blockHeight: 0, chain: 'unknown' })
      }
    } catch {
      setL1Status({ connected: false, blockHeight: 0, chain: 'unknown' })
    } finally {
      setL1Loading(false)
    }
  }, [])

  const checkL2 = useCallback(async () => {
    setL2Loading(true)
    try {
      const [blockNumber, chainId, clientVersion] = await Promise.all([
        rpcCall('eth_blockNumber'),
        rpcCall('eth_chainId'),
        rpcCall('web3_clientVersion'),
      ])
      setL2Status({
        connected: true,
        blockNumber: parseInt(blockNumber, 16),
        chainId: parseInt(chainId, 16),
        clientVersion: clientVersion || 'Unknown',
      })
    } catch {
      setL2Status({ connected: false, blockNumber: 0, chainId: 0, clientVersion: '' })
    } finally {
      setL2Loading(false)
    }
  }, [])

  const startL1 = async () => {
    alert('L1 node must be started manually or via the launcher script:\n\nnode launcher/start.js\n\nOr run bitcoinsilverd directly with regtest configuration.')
  }

  const startL2 = async () => {
    alert('L2 node must be started manually:\n\ncd execution/evm && npm run rpc\n\nThis starts the EVM RPC server on http://127.0.0.1:8545 with --dev-sequencer flag.')
  }

  useEffect(() => {
    checkL1()
    checkL2()
    const interval = setInterval(() => {
      checkL1()
      checkL2()
    }, 10000)
    return () => clearInterval(interval)
  }, [checkL1, checkL2])

  return (
    <div className="container">
      <h1 style={{ color: 'var(--btcs-gold)', marginBottom: '2rem' }}>Node Management</h1>

      <div className="grid">
        <div className="card">
          <div className="card-header">BTCS L1 Node (bitcoinsilverd)</div>
          <div className="grid">
            <div className="stat">
              <div className="stat-label">Status</div>
              <div className="stat-value" style={{ color: l1Status.connected ? 'var(--success)' : 'var(--text-secondary)' }}>
                {l1Loading ? 'Checking...' : (l1Status.connected ? 'Running' : 'Stopped')}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Network</div>
              <div className="stat-value">{l1Status.chain}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Block Height</div>
              <div className="stat-value">{l1Status.connected ? l1Status.blockHeight : 'N/A'}</div>
            </div>
            <div className="stat">
              <div className="stat-label">RPC Port</div>
              <div className="stat-value">18443 (regtest default)</div>
            </div>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn" onClick={startL1} disabled={l1Loading}>
              {l1Loading ? 'Checking...' : 'Start L1 Node (Manual)'}
            </button>
            <button className="btn btn-secondary" onClick={checkL1} disabled={l1Loading}>
              Refresh Status
            </button>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '0.875rem' }}>
            Requires bitcoinsilverd with regtest=1, server=1, and RPC credentials configured.
            Default datadir: ~/.bitcoinsilver/regtest
          </p>
        </div>

        <div className="card">
          <div className="card-header">BTCS L2 Node (EVM)</div>
          <div className="grid">
            <div className="stat">
              <div className="stat-label">Status</div>
              <div className="stat-value" style={{ color: l2Status.connected ? 'var(--success)' : 'var(--text-secondary)' }}>
                {l2Loading ? 'Checking...' : (l2Status.connected ? 'Running' : 'Stopped')}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">RPC Endpoint</div>
              <div className="stat-value" style={{ fontSize: '0.875rem' }}>http://127.0.0.1:8545</div>
            </div>
            <div className="stat">
              <div className="stat-label">Chain ID</div>
              <div className="stat-value">{l2Status.chainId || 'N/A'} (0x{l2Status.chainId?.toString(16) || 'N/A'})</div>
            </div>
            <div className="stat">
              <div className="stat-label">Block Number</div>
              <div className="stat-value">{l2Status.connected ? l2Status.blockNumber : 'N/A'}</div>
            </div>
            <div className="stat">
              <div className="stat-label">Client</div>
              <div className="stat-value" style={{ fontSize: '0.75rem', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {l2Status.clientVersion || 'N/A'}
              </div>
            </div>
          </div>
          <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button className="btn" onClick={startL2} disabled={l2Loading}>
              {l2Loading ? 'Checking...' : 'Start L2 Node (Manual)'}
            </button>
            <button className="btn btn-secondary" onClick={checkL2} disabled={l2Loading}>
              Refresh Status
            </button>
          </div>
          <p style={{ color: 'var(--text-secondary)', marginTop: '1rem', fontSize: '0.875rem' }}>
            Run from execution/evm directory: <code style={{ background: 'var(--bg-secondary)', padding: '0.125rem 0.375rem', borderRadius: '3px' }}>npm run rpc</code>
            Starts with --dev-sequencer for local block mining via btcs_dev_mine.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Unified Launcher</div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Use the launcher to start both nodes together with proper dependency ordering.
        </p>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <code style={{ background: 'var(--bg-secondary)', padding: '0.75rem 1rem', borderRadius: '4px', flex: 1, minWidth: '300px' }}>
            node launcher/start.js
          </code>
          <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText('node launcher/start.js')}>
            Copy Command
          </button>
        </div>
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '4px', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
          <strong>Launcher Behavior:</strong>
          <ul style={{ margin: '0.5rem 0 0 1.5rem', lineHeight: 1.8 }}>
            <li>Checks for bitcoinsilverd binary</li>
            <li>Starts L1 regtest node if not running</li>
            <li>Waits for L1 RPC to be ready</li>
            <li>Starts L2 EVM RPC server with --dev-sequencer</li>
            <li>Opens Studio in browser (optional)</li>
          </ul>
        </div>
      </div>

      <div className="card">
        <div className="card-header">MetaMask Configuration</div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Add BTCS L2 Local as a custom network in MetaMask:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
          <div>
            <label className="label">Network Name</label>
            <input className="input" value="BTCS L2 Local" readOnly />
          </div>
          <div>
            <label className="label">RPC URL</label>
            <input className="input" value="http://127.0.0.1:8545" readOnly />
          </div>
          <div>
            <label className="label">Chain ID</label>
            <input className="input" value="31337" readOnly />
          </div>
          <div>
            <label className="label">Currency Symbol</label>
            <input className="input" value="BTCS" readOnly />
          </div>
          <div>
            <label className="label">Block Explorer</label>
            <input className="input" value="(Optional - not available locally)" readOnly />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText('http://127.0.0.1:8545')}>
            Copy RPC URL
          </button>
          <button className="btn btn-secondary" onClick={() => navigator.clipboard.writeText('31337')}>
            Copy Chain ID
          </button>
        </div>
      </div>
    </div>
  )
}

export default Nodes