import React, { useState, useEffect, useCallback } from 'react'
import { rpcCall } from '../lib/api'
import { getRecentTransactions, lookupExplorerQuery } from '../lib/explorer.js'

function Transactions() {
  const [blocks, setBlocks] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [latestBlock, setLatestBlock] = useState(null)
  const [lookupQuery, setLookupQuery] = useState('')
  const [lookupResult, setLookupResult] = useState(null)
  const [lookupSubmitted, setLookupSubmitted] = useState(false)
  const [lookupLoading, setLookupLoading] = useState(false)
  const [lookupError, setLookupError] = useState(null)

  const fetchBlocks = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const blockNumberHex = await rpcCall('eth_blockNumber')
      const latestBlockNum = parseInt(blockNumberHex, 16)
      setLatestBlock(latestBlockNum)

      // Fetch last 10 blocks
      const blockPromises = []
      for (let i = 0; i < 10; i++) {
        const blockNum = latestBlockNum - i
        if (blockNum < 0) break
        blockPromises.push(
          rpcCall('eth_getBlockByNumber', ['0x' + blockNum.toString(16), true])
            .then(block => {
              if (!block) return null
              if (!Array.isArray(block.transactions)) {
                throw new Error(`Block ${block.number} omitted its full transaction list`)
              }
              return {
                number: parseInt(block.number, 16),
                hash: block.hash,
                timestamp: parseInt(block.timestamp, 16),
                txCount: block.transactions.length,
                gasUsed: parseInt(block.gasUsed, 16),
                gasLimit: parseInt(block.gasLimit, 16),
                miner: block.miner,
                transactions: block.transactions,
              }
            })
        )
      }
      const fetchedBlocks = (await Promise.all(blockPromises)).filter(Boolean)
      setBlocks(fetchedBlocks)

      // Collect all transactions from these blocks
      setTransactions(await getRecentTransactions(fetchedBlocks, rpcCall))
    } catch (err) {
      console.error('Failed to fetch blocks:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchBlocks()
    const interval = setInterval(fetchBlocks, 15000)
    return () => clearInterval(interval)
  }, [fetchBlocks])

  const handleLookup = async (event) => {
    event.preventDefault()
    setLookupLoading(true)
    setLookupError(null)
    setLookupResult(null)
    setLookupSubmitted(true)

    try {
      setLookupResult(await lookupExplorerQuery(lookupQuery, rpcCall))
    } catch (err) {
      console.error('Failed to look up L2 block or transaction:', err)
      setLookupError(err.message)
    } finally {
      setLookupLoading(false)
    }
  }

  const formatAddress = (addr) => {
    if (!addr) return 'N/A'
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  const formatHash = (hash) => {
    if (!hash) return 'N/A'
    return `${hash.slice(0, 10)}...${hash.slice(-6)}`
  }

  const formatTime = (timestamp) => {
    if (!timestamp) return 'N/A'
    return new Date(timestamp * 1000).toLocaleString()
  }

  return (
    <div className="container">
      <h1 style={{ color: 'var(--btcs-gold)', marginBottom: '2rem' }}>Transactions & Blocks</h1>
      <p style={{ color: 'var(--text-secondary)', marginTop: '-1.5rem', marginBottom: '1.5rem' }}>
        Local BTCS L2 only · recent 10 blocks · no L1 explorer or address history
      </p>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <span style={{ color: 'var(--text-secondary)' }}>Latest Block: </span>
          <strong>{latestBlock !== null ? latestBlock : 'N/A'}</strong>
        </div>
        <button className="btn btn-secondary" onClick={fetchBlocks} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="warning" style={{ background: 'rgba(248, 113, 113, 0.1)', borderColor: 'var(--error)', color: 'var(--error)' }}>
          Failed to fetch data: {error}. Make sure the L2 node is running on http://127.0.0.1:8545
        </div>
      )}

      <section className="card" aria-labelledby="explorer-lookup-title">
        <h2 id="explorer-lookup-title" className="card-header">Look up an L2 block or transaction</h2>
        <form onSubmit={handleLookup}>
          <label className="label" htmlFor="explorer-lookup">
            Block number, block hash, or transaction hash
          </label>
          <div className="explorer-lookup-controls">
            <input
              id="explorer-lookup"
              className="input explorer-lookup-input"
              value={lookupQuery}
              onChange={(event) => setLookupQuery(event.target.value)}
              placeholder="e.g. 42 or 0x..."
              autoComplete="off"
              spellCheck="false"
            />
            <button className="btn" type="submit" disabled={lookupLoading || !lookupQuery.trim()}>
              {lookupLoading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>
        {lookupError && (
          <p className="warning explorer-lookup-message" role="alert">{lookupError}</p>
        )}
        {lookupSubmitted && !lookupLoading && !lookupError && !lookupResult && (
          <p className="explorer-lookup-message" role="status">No matching L2 block or transaction was found.</p>
        )}
        {lookupResult?.type === 'block' && (
          <div className="explorer-lookup-result" role="status">
            <h3>Block {lookupResult.block.number}</h3>
            <dl className="explorer-result-grid">
              <div><dt>Hash</dt><dd title={lookupResult.block.hash}>{lookupResult.block.hash}</dd></div>
              <div><dt>Timestamp</dt><dd>{formatTime(lookupResult.block.timestamp)}</dd></div>
              <div><dt>Transactions</dt><dd>{lookupResult.block.txCount}</dd></div>
              <div><dt>Gas used / limit</dt><dd>{lookupResult.block.gasUsed.toLocaleString()} / {lookupResult.block.gasLimit.toLocaleString()}</dd></div>
            </dl>
            <h4>Transactions in this block</h4>
            {lookupResult.transactions.length === 0
              ? <p>This block contains no transactions.</p>
              : (
                <ul className="explorer-lookup-transactions">
                  {lookupResult.transactions.map((transaction) => (
                    <li key={transaction.hash}>
                      <span title={transaction.hash}>{formatHash(transaction.hash)}</span>
                      <span>
                        {transaction.receiptStatus === '0x1'
                          ? 'Success'
                          : transaction.receiptStatus === '0x0'
                            ? 'Reverted'
                            : 'Receipt unavailable'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            {lookupResult.block.txCount > lookupResult.transactions.length && (
              <p className="explorer-lookup-note">
                Showing {lookupResult.transactions.length} of {lookupResult.block.txCount} transactions.
              </p>
            )}
          </div>
        )}
        {lookupResult?.type === 'transaction' && (
          <div className="explorer-lookup-result" role="status">
            <h3>Transaction</h3>
            <dl className="explorer-result-grid">
              <div><dt>Hash</dt><dd title={lookupResult.transaction.hash}>{lookupResult.transaction.hash}</dd></div>
              <div><dt>Block</dt><dd>{lookupResult.transaction.blockNumber === null
                ? 'Pending / not included'
                : Number.parseInt(lookupResult.transaction.blockNumber, 16)}</dd></div>
              <div><dt>From</dt><dd>{lookupResult.transaction.from}</dd></div>
              <div><dt>To</dt><dd>{lookupResult.transaction.to || 'Contract creation'}</dd></div>
              <div><dt>Receipt gas used</dt><dd>{lookupResult.transaction.receiptGasUsed === null
                ? 'Unavailable'
                : Number.parseInt(lookupResult.transaction.receiptGasUsed, 16).toLocaleString()}</dd></div>
              <div><dt>Status</dt><dd>{lookupResult.transaction.receiptStatus === '0x1'
                ? 'Success'
                : lookupResult.transaction.receiptStatus === '0x0'
                  ? 'Reverted'
                  : 'Receipt unavailable'}</dd></div>
            </dl>
          </div>
        )}
      </section>

      <div className="card">
        <div className="card-header">Recent L2 Blocks</div>
        {blocks.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
            No blocks found. Start the L2 node and mine some blocks.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Block #</th>
                  <th>Hash</th>
                  <th>Timestamp</th>
                  <th>Txns</th>
                  <th>Gas Used / Limit</th>
                  <th>Miner</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map(block => (
                  <tr key={block.number}>
                    <td><strong>{block.number}</strong></td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      <span title={block.hash}>{formatHash(block.hash)}</span>
                    </td>
                    <td>{formatTime(block.timestamp)}</td>
                    <td>{block.txCount}</td>
                    <td>
                      {block.gasUsed.toLocaleString()} / {block.gasLimit.toLocaleString()}
                      <br />
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {((block.gasUsed / block.gasLimit) * 100).toFixed(1)}%
                      </span>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.75rem' }}>{formatAddress(block.miner)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header">Recent Transactions</div>
        {transactions.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
            No transactions yet. Deploy a token or send a transaction to see it here.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Hash</th>
                  <th>Block</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Value</th>
                  <th>Gas Used</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, idx) => (
                  <tr key={`${tx.hash}-${idx}`}>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      <span title={tx.hash}>{formatHash(tx.hash)}</span>
                    </td>
                    <td>{tx.blockNumber}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{formatAddress(tx.from)}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {tx.to ? formatAddress(tx.to) : '<Contract Creation>'}
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                      {tx.value && tx.value !== '0x0'
                        ? `${(BigInt(tx.value) / 1000000000000000000n).toString()} BTCS`
                        : '0'}
                    </td>
                    <td>
                      {tx.receiptGasUsed !== null
                        ? parseInt(tx.receiptGasUsed, 16).toLocaleString()
                        : 'N/A'}
                    </td>
                    <td>
                      <span style={{
                        color: tx.receiptStatus === '0x1'
                          ? 'var(--success)'
                          : tx.receiptStatus === '0x0'
                            ? 'var(--error)'
                            : 'var(--text-secondary)',
                        fontWeight: 600,
                      }}>
                        {tx.receiptStatus === '0x1'
                          ? 'Success'
                          : tx.receiptStatus === '0x0'
                            ? 'Reverted'
                            : 'Receipt unavailable'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Transactions