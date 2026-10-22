import React, { useState } from 'react'
import { ethers } from 'ethers'

function TokenStudio() {
  const [tab, setTab] = useState('erc20')
  const [erc20Form, setErc20Form] = useState({
    name: '', symbol: '', decimals: '18', initialSupply: '', maxSupply: '', mintable: false, owner: ''
  })
  const [nftForm, setNftForm] = useState({ name: '', symbol: '', owner: '', uri: '' })
  const [mintForm, setMintForm] = useState({ contract: '', recipient: '', amount: '' })
  const [status, setStatus] = useState('')

  const deployERC20 = async () => {
    setStatus('Deploying ERC-20... (requires connected wallet to L2 node)')
    // Real deployment would use ethers.js
  }

  return (
    <div className="container">
      <h1 style={{ color: 'var(--btcs-gold)', marginBottom: '2rem' }}>Token Studio</h1>

      <div className="warning">
        Experimental token creation on L2 test network only. Tokens are not backed by BTCS.
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem' }}>
          <button className={`btn ${tab === 'erc20' ? '' : 'btn-secondary'}`} onClick={() => setTab('erc20')}>ERC-20</button>
          <button className={`btn ${tab === 'nft' ? '' : 'btn-secondary'}`} onClick={() => setTab('nft')}>NFT (ERC-721)</button>
          <button className={`btn ${tab === 'mint' ? '' : 'btn-secondary'}`} onClick={() => setTab('mint')}>Mint</button>
          <button className={`btn ${tab === 'my' ? '' : 'btn-secondary'}`} onClick={() => setTab('my')}>My Tokens</button>
        </div>

        {tab === 'erc20' && (
          <div>
            <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>Create ERC-20 Token</h3>
            <label className="label">Token Name</label>
            <input className="input" value={erc20Form.name} onChange={e => setErc20Form({...erc20Form, name: e.target.value})} placeholder="e.g., Test Token" />
            <label className="label">Token Symbol</label>
            <input className="input" value={erc20Form.symbol} onChange={e => setErc20Form({...erc20Form, symbol: e.target.value})} placeholder="e.g., TEST" />
            <label className="label">Decimals</label>
            <input className="input" value={erc20Form.decimals} onChange={e => setErc20Form({...erc20Form, decimals: e.target.value})} />
            <label className="label">Initial Supply</label>
            <input className="input" value={erc20Form.initialSupply} onChange={e => setErc20Form({...erc20Form, initialSupply: e.target.value})} placeholder="1000000" />
            <label className="label">Max Supply (optional)</label>
            <input className="input" value={erc20Form.maxSupply} onChange={e => setErc20Form({...erc20Form, maxSupply: e.target.value})} />
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
              <input type="checkbox" checked={erc20Form.mintable} onChange={e => setErc20Form({...erc20Form, mintable: e.target.checked})} />
              Owner-mintable (can mint more after deployment)
            </label>
            <button className="btn" onClick={deployERC20}>Deploy Token</button>
            {status && <p style={{ marginTop: '1rem', color: 'var(--warning)' }}>{status}</p>}
          </div>
        )}

        {tab === 'nft' && (
          <div>
            <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>Create NFT Collection</h3>
            <label className="label">Collection Name</label>
            <input className="input" value={nftForm.name} onChange={e => setNftForm({...nftForm, name: e.target.value})} placeholder="e.g., My Collection" />
            <label className="label">Collection Symbol</label>
            <input className="input" value={nftForm.symbol} onChange={e => setNftForm({...nftForm, symbol: e.target.value})} placeholder="e.g., MYNFT" />
            <button className="btn">Deploy Collection</button>
          </div>
        )}

        {tab === 'mint' && (
          <div>
            <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>Mint Tokens/NFTs</h3>
            <label className="label">Contract Address</label>
            <input className="input" value={mintForm.contract} onChange={e => setMintForm({...mintForm, contract: e.target.value})} placeholder="0x..." />
            <label className="label">Recipient Address</label>
            <input className="input" value={mintForm.recipient} onChange={e => setMintForm({...mintForm, recipient: e.target.value})} placeholder="0x..." />
            <label className="label">Amount / Token ID</label>
            <input className="input" value={mintForm.amount} onChange={e => setMintForm({...mintForm, amount: e.target.value})} />
            <button className="btn">Mint</button>
          </div>
        )}

        {tab === 'my' && (
          <div>
            <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>My Deployed Tokens</h3>
            <p style={{ color: 'var(--text-secondary)' }}>No tokens deployed yet</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default TokenStudio
