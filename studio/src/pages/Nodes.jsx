import React from 'react'

function Nodes() {
  return (
    <div className="container">
      <h1 style={{ color: 'var(--btcs-gold)', marginBottom: '2rem' }}>Node Management</h1>

      <div className="card">
        <div className="card-header">BTCS L1 Node (bitcoinsilverd)</div>
        <div className="grid">
          <div className="stat">
            <div className="stat-label">Status</div>
            <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>Stopped</div>
          </div>
          <div className="stat">
            <div className="stat-label">Network</div>
            <div className="stat-value">regtest</div>
          </div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn">Start L1 Node</button>
          <button className="btn" disabled>Stop</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">BTCS L2 Node (EVM)</div>
        <div className="grid">
          <div className="stat">
            <div className="stat-label">Status</div>
            <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>Stopped</div>
          </div>
          <div className="stat">
            <div className="stat-label">RPC</div>
            <div className="stat-value">127.0.0.1:8545</div>
          </div>
          <div className="stat">
            <div className="stat-label">Chain ID</div>
            <div className="stat-value">31337</div>
          </div>
        </div>
        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn">Start L2 Node</button>
          <button className="btn" disabled>Stop</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Unified Launcher</div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
          Use the launcher to start both nodes together with proper dependency ordering.
        </p>
        <code style={{ background: 'var(--bg-secondary)', padding: '0.5rem', display: 'block', borderRadius: '4px' }}>
          node launcher/start.js
        </code>
      </div>
    </div>
  )
}

export default Nodes
