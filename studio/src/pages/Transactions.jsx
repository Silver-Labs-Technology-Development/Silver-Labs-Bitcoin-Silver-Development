import React from 'react'

function Transactions() {
  return (
    <div className="container">
      <h1 style={{ color: 'var(--btcs-gold)', marginBottom: '2rem' }}>Transactions & Blocks</h1>

      <div className="card">
        <div className="card-header">Recent L2 Blocks</div>
        <table className="table">
          <thead>
            <tr>
              <th>Block</th>
              <th>Hash</th>
              <th>Txns</th>
              <th>Gas Used</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>0</td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>0x...</td>
              <td>0</td>
              <td>0</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header">Recent Transactions</div>
        <p style={{ color: 'var(--text-secondary)' }}>No transactions yet</p>
      </div>
    </div>
  )
}

export default Transactions
