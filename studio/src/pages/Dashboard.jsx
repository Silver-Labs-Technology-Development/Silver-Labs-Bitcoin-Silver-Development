import React, { useState, useEffect } from 'react'

function Dashboard() {
  const [l2Status, setL2Status] = useState({ blockNumber: '0', chainId: '0x7a69' })

  return (
    <div className="container">
      <h1 style={{ color: 'var(--btcs-gold)', marginBottom: '2rem' }}>Bitcoin Silver L2 Developer Studio</h1>

      <div className="warning">
        <strong>EXPERIMENTAL PROTOTYPE</strong> - Trusted single-operator model. Not for production or real funds.
        L1 anchors are not fraud proofs. Payouts disabled by default.
      </div>

      <div className="grid">
        <div className="card">
          <div className="card-header">L1 Node (BTCS Core)</div>
          <div className="stat">
            <div className="stat-label">Status</div>
            <div className="stat-value" style={{ color: 'var(--text-secondary)' }}>Not Connected</div>
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
        </div>

        <div className="card">
          <div className="card-header">Developer Tools</div>
          <button className="btn" style={{ marginBottom: '0.5rem', width: '100%' }}>Mine Block (Dev)</button>
          <button className="btn" style={{ width: '100%' }}>Refresh Status</button>
        </div>
      </div>

      <div className="card">
        <div className="card-header">Quick Start</div>
        <ol style={{ color: 'var(--text-secondary)', paddingLeft: '1.5rem' }}>
          <li>Start L1 node (BTCS Core) and L2 node via Nodes tab or launcher</li>
          <li>Connect a browser wallet (MetaMask) to http://127.0.0.1:8545, Chain ID 31337</li>
          <li>Use Token Studio to deploy ERC-20 or NFT collections</li>
          <li>All operations on local development network only</li>
        </ol>
      </div>
    </div>
  )
}

export default Dashboard
