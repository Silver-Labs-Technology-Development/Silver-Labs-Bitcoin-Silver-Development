import React, { useState, useEffect, useCallback } from 'react'
import { ethers } from 'ethers'
import { ImageUpload } from '../components/ImageUpload'
import { uploadAssetLogo, fetchAssetServiceLimits, rpcCall, fetchEngineNetworks, engineConnect, engineEstimateFees, engineDeploy, engineListDeployments, deploymentLogoUrl, engineMint } from '../lib/api'

const RPC_URL = 'http://127.0.0.1:8545'

// EvmFungibleAsset contract ABI (shared ERC-20/BEP-20 interface)
const FUNGIBLE_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function transfer(address,uint256) returns (bool)',
  'function approve(address,uint256) returns (bool)',
  'function transferFrom(address,address,uint256) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
]

// BSNA-FTS1 extended interface (when available)
const FTS1_ABI = [
  ...FUNGIBLE_ABI,
  'function bsnaStandard() view returns (string)',
  'function bsnaVersion() view returns (string)',
  'function admin() view returns (address)',
  'function minter() view returns (address)',
  'function paused() view returns (bool)',
  'function maxSupply() view returns (uint256)',
  'function supplyPolicy() view returns (uint8)',
  'function burnPolicy() view returns (uint8)',
  'function pausePolicy() view returns (uint8)',
  'function metadataURI() view returns (string)',
  'function metadataHash() view returns (bytes32)',
  'function mint(address,uint256)',
  'function burn(uint256)',
  'function pause()',
  'function unpause()',
  'function setMinter(address)',
  'function transferAdmin(address)',
  'function renounceAdmin()',
  'function setMetadata(string,bytes32)',
]

function deploymentToToken(deployment) {
  return {
    id: deployment.assetId,
    network: deployment.networkName,
    chainId: deployment.chainId,
    standard: deployment.standard ?? 'ERC-20',
    contractAddress: deployment.contractAddress,
    name: deployment.name,
    symbol: deployment.symbol,
    decimals: deployment.decimals,
    totalSupply: deployment.supplyAtomic,
    owner: deployment.deployer,
    deployTxHash: deployment.creationTransactionHash,
    blockNumber: 'N/A',
    gasUsed: 'N/A',
    effectiveGasPrice: null,
    status: undefined,
    logs: [],
    logoUri: deployment.metadata.logo?.uri || null,
    metadataUri: deployment.metadata.uri || deployment.metadata.logo?.uri || null,
    permissions: deployment.permissions,
    deployedAt: new Date().toISOString(),
    type: 'fungible',
  }
}

function TokenStudio() {
  const [tab, setTab] = useState('erc20')
  const [status, setStatus] = useState({ message: '', type: '' }) // type: 'info' | 'success' | 'error' | 'warning'
  const [loading, setLoading] = useState(false)
  const [assetServiceReady, setAssetServiceReady] = useState(false)
  const [assetServiceLimits, setAssetServiceLimits] = useState(null)
  const [rpcConnected, setRpcConnected] = useState(false)
  const [chainId, setChainId] = useState(null)
  const [deployedTokens, setDeployedTokens] = useState([])
  const [selectedToken, setSelectedToken] = useState(null)

  // Asset Engine state
  const [engineNetworks, setEngineNetworks] = useState([])
  const [selectedNetworkId, setSelectedNetworkId] = useState('btcs-l2-local')
  const [engineConnected, setEngineConnected] = useState(false)
  const [engineConnection, setEngineConnection] = useState(null)
  const [feeEstimate, setFeeEstimate] = useState(null)
  const [estimatingFees, setEstimatingFees] = useState(false)
  const [deploymentReceipt, setDeploymentReceipt] = useState(null)

  // ERC-20 / BSNA-FTS1 form state
  const [erc20Form, setErc20Form] = useState({
    standard: 'BSNA-FTS1',
    name: '',
    symbol: '',
    decimals: '18',
    initialSupply: '',
    maxSupply: '',
    supplyPolicy: 'fixed', // 'fixed' | 'authorized-mint'
    burnPolicy: 'disabled', // 'disabled' | 'holder-burn'
    pausePolicy: 'disabled', // 'disabled' | 'admin-pause'
    metadataMutable: false,
    description: '',
    externalUrl: '',
    owner: '',
    logoFile: null,
    logoPreview: null,
    logoDimensions: null,
  })

  // NFT form state
  const [nftForm, setNftForm] = useState({
    name: '',
    symbol: '',
    owner: '',
    uri: '',
    logoFile: null,
    logoPreview: null,
    logoDimensions: null,
  })

  // Mint form state (BSNA-FTS1 authorized-mint only)
  const [mintForm, setMintForm] = useState({
    assetId: '',
    recipient: '',
    amount: '',
  })

  // Validation
  const validateErc20Form = useCallback(() => {
    const errors = []
    if (!erc20Form.name.trim()) errors.push('Token name is required')
    if (!erc20Form.symbol.trim()) errors.push('Token symbol is required')
    if (erc20Form.symbol.trim().length > 10) errors.push('Symbol must be 10 characters or less')
    const decimals = parseInt(erc20Form.decimals, 10)
    if (isNaN(decimals) || decimals < 0 || decimals > 18) errors.push('Decimals must be between 0 and 18')
    let initialSupply = 0n
    try {
      initialSupply = BigInt(erc20Form.initialSupply || '0')
      if (initialSupply < 0n) errors.push('Initial supply cannot be negative')
    } catch {
      errors.push('Initial supply must be a whole number')
    }
    if (erc20Form.maxSupply) {
      try {
        const maxSupply = BigInt(erc20Form.maxSupply)
        if (maxSupply < initialSupply) errors.push('Max supply must be >= initial supply')
        if (erc20Form.supplyPolicy === 'fixed' && maxSupply !== initialSupply) {
          errors.push('For fixed supply, max supply must equal initial supply (or leave it empty)')
        }
      } catch {
        errors.push('Max supply must be a whole number')
      }
    }
    if (erc20Form.standard === 'BSNA-FTS1' && erc20Form.supplyPolicy === 'fixed' && erc20Form.maxSupply && initialSupply !== BigInt(erc20Form.maxSupply || '0')) {
      errors.push('BSNA-FTS1 fixed supply requires max supply to equal initial supply')
    }
    if (!erc20Form.logoFile) errors.push('Token logo is required')
    return errors
  }, [erc20Form])

  const validateNftForm = useCallback(() => {
    const errors = []
    if (!nftForm.name.trim()) errors.push('Collection name is required')
    if (!nftForm.symbol.trim()) errors.push('Collection symbol is required')
    if (nftForm.symbol.trim().length > 10) errors.push('Symbol must be 10 characters or less')
    return errors
  }, [nftForm])

  // Check asset service and RPC on mount
  useEffect(() => {
    const checkServices = async () => {
      try {
        const health = await fetch('http://127.0.0.1:3001/healthz').then(r => r.json())
        setAssetServiceReady(health.ok === true)
        if (health.ok) {
          const limits = await fetchAssetServiceLimits()
          setAssetServiceLimits(limits)
        }
      } catch {
        setAssetServiceReady(false)
      }

      try {
        const cid = await rpcCall('eth_chainId')
        setChainId(cid)
        setRpcConnected(true)
      } catch {
        setRpcConnected(false)
      }

      // Fetch engine networks
      if (assetServiceReady) {
        try {
          const networks = await fetchEngineNetworks()
          setEngineNetworks(networks)
          // Connect to default network
          const defaultNetwork = networks.find(n => n.id === 'btcs-l2-local') || networks[0]
          if (defaultNetwork) {
            setSelectedNetworkId(defaultNetwork.id)
            const connection = await engineConnect(defaultNetwork.id)
            setEngineConnection(connection)
            setEngineConnected(true)
            try {
              const deployments = await engineListDeployments(defaultNetwork.id)
              setDeployedTokens(deployments.map(deploymentToToken))
            } catch (deploymentError) {
              console.warn('Could not load deployments:', deploymentError)
            }
          }
        } catch (error) {
          console.error('Failed to connect to asset engine:', error)
        }
      }
    }
    checkServices()
    const interval = setInterval(checkServices, 10000)
    return () => clearInterval(interval)
  }, [assetServiceReady])

  // Handle logo upload for ERC-20
  const handleErc20LogoChange = useCallback((result) => {
    setErc20Form(prev => ({
      ...prev,
      logoFile: result?.file || null,
      logoPreview: result?.base64 || null,
      logoDimensions: result?.dimensions || null,
    }))
  }, [])

  // Handle logo upload for NFT
  const handleNftLogoChange = useCallback((result) => {
    setNftForm(prev => ({
      ...prev,
      logoFile: result?.file || null,
      logoPreview: result?.base64 || null,
      logoDimensions: result?.dimensions || null,
    }))
  }, [])

  // Deploy ERC-20 / BSNA-FTS1
  const deployERC20 = async () => {
    const errors = validateErc20Form()
    if (errors.length > 0) {
      setStatus({ message: errors.join('; '), type: 'error' })
      return
    }
    if (!rpcConnected) {
      setStatus({ message: 'L2 RPC not connected. Start the L2 node first.', type: 'error' })
      return
    }
    if (!assetServiceReady) {
      setStatus({ message: 'Asset service not available. A token logo is required and must be uploaded before deployment.', type: 'error' })
      return
    }
    if (!engineConnected) {
      setStatus({ message: 'Asset engine not connected. Please wait for connection.', type: 'error' })
      return
    }

    setLoading(true)
    setStatus({ message: 'Deploying token via asset engine...', type: 'info' })
    setDeploymentReceipt(null)

    try {
      // Convert logo file to base64 if provided
      let logoBase64 = null
      if (erc20Form.logoFile) {
        logoBase64 = await new Promise((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result.split(',')[1])
          reader.onerror = reject
          reader.readAsDataURL(erc20Form.logoFile)
        })
      }

      // Deploy via asset engine
      const isFts1 = erc20Form.standard === 'BSNA-FTS1'
      const result = await engineDeploy({
        networkId: selectedNetworkId,
        standard: erc20Form.standard,
        name: erc20Form.name.trim(),
        symbol: erc20Form.symbol.trim(),
        decimals: parseInt(erc20Form.decimals, 10),
        initialSupply: erc20Form.initialSupply || '0',
        ...(isFts1
          ? {
              maxSupply: erc20Form.maxSupply || (erc20Form.supplyPolicy === 'fixed' ? (erc20Form.initialSupply || '0') : '0'),
              supplyPolicy: erc20Form.supplyPolicy,
              burnPolicy: erc20Form.burnPolicy,
              pausePolicy: erc20Form.pausePolicy,
              metadataMutable: erc20Form.metadataMutable,
              metadataUri: '',
              metadataHash: '0',
            }
          : {}),
        description: erc20Form.description.trim() || undefined,
        externalUrl: erc20Form.externalUrl.trim() || undefined,
        logoBase64,
        allowMainnet: false,
      })

      const deployment = result.deployment
      const connection = result.connection
      const feeQuote = result.feeQuote

      // Fetch actual transaction receipt from RPC for real gas used, block number, etc.
      let receipt = null
      try {
        receipt = await rpcCall('eth_getTransactionReceipt', [deployment.creationTransactionHash])
      } catch (receiptError) {
        console.warn('Could not fetch receipt:', receiptError)
      }

      const newToken = {
        ...deploymentToToken(deployment),
        blockNumber: receipt?.blockNumber ? parseInt(receipt.blockNumber, 16) : 'N/A',
        gasUsed: receipt?.gasUsed ? parseInt(receipt.gasUsed, 16).toLocaleString() : String(feeQuote.gasLimit),
        effectiveGasPrice: receipt?.effectiveGasPrice ? parseInt(receipt.effectiveGasPrice, 16) : null,
        status: receipt?.status,
        logs: receipt?.logs || [],
        deployedAt: new Date().toISOString(),
      }

      // Create deployment receipt for detailed view
      const deploymentReceipt = {
        deployment,
        connection,
        feeQuote,
        receipt,
        token: newToken,
      }
      setDeploymentReceipt(deploymentReceipt)

      setDeployedTokens(prev => [newToken, ...prev])
      setSelectedToken(newToken)
      setStatus({
        message: `Token deployed successfully at ${deployment.contractAddress} on ${deployment.networkName}`,
        type: 'success'
      })

      // Refresh deployments list
      const deployments = await engineListDeployments(selectedNetworkId)
      setDeployedTokens(deployments.map(deploymentToToken))

      // Reset form
      setErc20Form({
        standard: 'BSNA-FTS1',
        name: '',
        symbol: '',
        decimals: '18',
        initialSupply: '',
        maxSupply: '',
        supplyPolicy: 'fixed',
        burnPolicy: 'disabled',
        pausePolicy: 'disabled',
        metadataMutable: false,
        description: '',
        externalUrl: '',
        owner: '',
        logoFile: null,
        logoPreview: null,
        logoDimensions: null,
      })

    } catch (error) {
      console.error('Deployment error:', error)
      setStatus({
        message: `Deployment failed: ${error.message}`,
        type: 'error'
      })
    } finally {
      setLoading(false)
    }
  }

  // Mint BSNA-FTS1 tokens through the asset engine (authorized-mint only)
  const handleMint = async () => {
    const token = deployedTokens.find(t => t.id === mintForm.assetId)
    if (!token) {
      setStatus({ message: 'Select a BSNA-FTS1 token with authorized-mint supply', type: 'error' })
      return
    }
    if (!ethers.isAddress(mintForm.recipient)) {
      setStatus({ message: 'Invalid recipient address', type: 'error' })
      return
    }
    if (!/^[0-9]+$/.test(mintForm.amount)) {
      setStatus({ message: 'Amount must be a non-negative whole number in atomic units', type: 'error' })
      return
    }
    setLoading(true)
    setStatus({ message: 'Minting via asset engine...', type: 'info' })
    try {
      const result = await engineMint({
        networkId: selectedNetworkId,
        assetId: token.id,
        to: mintForm.recipient,
        atomicAmount: mintForm.amount,
        allowMainnet: false,
      })
      const deployments = await engineListDeployments(selectedNetworkId)
      setDeployedTokens(deployments.map(deploymentToToken))
      setMintForm({ assetId: '', recipient: '', amount: '' })
      setStatus({
        message: `Minted ${mintForm.amount} atomic units. Tx: ${result.transactionHash}. Total supply is now ${result.onChain.totalSupply}.`,
        type: 'success',
      })
    } catch (error) {
      setStatus({ message: `Mint failed: ${error.message}`, type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  // Render functions for each tab
  const renderErc20Tab = () => {
    const errors = validateErc20Form()
    const canDeploy = errors.length === 0 && rpcConnected && engineConnected && !loading
    const selectedNetwork = engineNetworks.find(n => n.id === selectedNetworkId)
    const isFts1 = erc20Form.standard === 'BSNA-FTS1'

    const handleEstimateFees = async () => {
      if (errors.length > 0) return
      setEstimatingFees(true)
      try {
        const estimate = await engineEstimateFees({
          networkId: selectedNetworkId,
          standard: erc20Form.standard,
          name: erc20Form.name.trim(),
          symbol: erc20Form.symbol.trim(),
          decimals: parseInt(erc20Form.decimals, 10),
          initialSupply: erc20Form.initialSupply || '0',
          ...(isFts1
            ? {
                maxSupply: erc20Form.maxSupply || (erc20Form.supplyPolicy === 'fixed' ? (erc20Form.initialSupply || '0') : '0'),
                supplyPolicy: erc20Form.supplyPolicy,
                burnPolicy: erc20Form.burnPolicy,
                pausePolicy: erc20Form.pausePolicy,
                metadataMutable: erc20Form.metadataMutable,
                metadataUri: '',
                metadataHash: '0',
              }
            : {}),
        })
        setFeeEstimate(estimate)
      } catch (error) {
        setFeeEstimate(null)
        setStatus({ message: `Fee estimation failed: ${error.message}`, type: 'warning' })
      } finally {
        setEstimatingFees(false)
      }
    }

    const handleNetworkChange = async (networkId) => {
      setSelectedNetworkId(networkId)
      setFeeEstimate(null)
      try {
        const connection = await engineConnect(networkId)
        setEngineConnection(connection)
        setEngineConnected(true)
        try {
          const deployments = await engineListDeployments(networkId)
          setDeployedTokens(deployments.map(deploymentToToken))
        } catch (deploymentError) {
          console.warn('Could not load deployments:', deploymentError)
          setDeployedTokens([])
        }
      } catch (error) {
        setStatus({ message: `Failed to connect to network: ${error.message}`, type: 'error' })
        setEngineConnected(false)
      }
    }

    return (
      <div>
        <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>Create Fungible Token (ERC-20 / BSNA-FTS1)</h3>

        {/* Network Selection */}
        <div className="form-row" style={{ marginBottom: '1.5rem' }}>
          <div className="form-col">
            <label className="label">Network</label>
            <select className="input" value={selectedNetworkId} onChange={e => handleNetworkChange(e.target.value)} disabled={loading}>
              {engineNetworks.map(network => (
                <option key={network.id} value={network.id} disabled={!network.configured}>
                  {network.name} (Chain ID: {network.chainId}) {network.configured ? '' : ' - Not Configured'}
                </option>
              ))}
            </select>
            {!selectedNetwork?.configured && (
              <p style={{ color: 'var(--warning)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                ⚠ This network is not configured. Set the required environment variables to enable deployment.
              </p>
            )}
          </div>
          <div className="form-col">
            <label className="label">Gas Symbol</label>
            <input className="input" value={selectedNetwork?.nativeGas?.symbol || 'N/A'} readOnly />
          </div>
        </div>

        <div className="form-row">
          <div className="form-col">
            <label className="label">Token Standard</label>
            <select className="input" value={erc20Form.standard} onChange={e => setErc20Form({...erc20Form, standard: e.target.value})} disabled={loading}>
              <option value="BSNA-FTS1">BSNA-FTS1 (policy fields apply)</option>
              <option value="ERC-20">ERC-20 (legacy fixed supply)</option>
            </select>
          </div>
          <div className="form-col">
            <label className="label">Supply Unit</label>
            <input className="input" value="Atomic units (never scaled by decimals)" readOnly />
          </div>
        </div>
        {!isFts1 && (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '-0.5rem', marginBottom: '1rem' }}>
            ERC-20 deploys the existing fixed-supply EvmFungibleAsset contract. Burn, pause, and mint policies
            below are ignored. Choose BSNA-FTS1 to deploy those rules on-chain.
          </p>
        )}

        <div className="form-row">
          <div className="form-col">
            <label className="label">Token Name</label>
            <input className="input" value={erc20Form.name} onChange={e => setErc20Form({...erc20Form, name: e.target.value})} placeholder="e.g., Test Token" />
          </div>
          <div className="form-col">
            <label className="label">Token Symbol</label>
            <input className="input" value={erc20Form.symbol} onChange={e => setErc20Form({...erc20Form, symbol: e.target.value})} placeholder="e.g., TEST" maxLength={10} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-col">
            <label className="label">Decimals</label>
            <input className="input" type="number" value={erc20Form.decimals} onChange={e => setErc20Form({...erc20Form, decimals: e.target.value})} min={0} max={18} />
          </div>
          <div className="form-col">
            <label className="label">Initial Supply (atomic units)</label>
            <input className="input" value={erc20Form.initialSupply} onChange={e => setErc20Form({...erc20Form, initialSupply: e.target.value})} placeholder="1000000" />
          </div>
        </div>

        <div className="form-row">
          <div className="form-col">
            <label className="label">Max Supply (optional, atomic)</label>
            <input className="input" value={erc20Form.maxSupply} onChange={e => setErc20Form({...erc20Form, maxSupply: e.target.value})} placeholder="Leave empty for no cap" />
          </div>
          <div className="form-col">
            <label className="label">Supply Policy</label>
            <select className="input" value={erc20Form.supplyPolicy} onChange={e => setErc20Form({...erc20Form, supplyPolicy: e.target.value})}>
              <option value="fixed">Fixed (immutable supply)</option>
              <option value="authorized-mint">Authorized Mint (admin can mint)</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-col">
            <label className="label">Burn Policy</label>
            <select className="input" value={erc20Form.burnPolicy} onChange={e => setErc20Form({...erc20Form, burnPolicy: e.target.value})}>
              <option value="disabled">Disabled</option>
              <option value="holder-burn">Holder Burn</option>
            </select>
          </div>
          <div className="form-col">
            <label className="label">Pause Policy</label>
            <select className="input" value={erc20Form.pausePolicy} onChange={e => setErc20Form({...erc20Form, pausePolicy: e.target.value})}>
              <option value="disabled">Disabled</option>
              <option value="admin-pause">Admin Pause</option>
            </select>
          </div>
        </div>

        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <input type="checkbox" checked={erc20Form.metadataMutable} onChange={e => setErc20Form({...erc20Form, metadataMutable: e.target.checked})} />
          Metadata Mutable (admin can update URI/hash later)
        </label>

        <div className="form-row">
          <div className="form-col">
            <label className="label">Description</label>
            <input className="input" value={erc20Form.description} onChange={e => setErc20Form({...erc20Form, description: e.target.value})} placeholder="Token description" />
          </div>
          <div className="form-col">
            <label className="label">External URL</label>
            <input className="input" value={erc20Form.externalUrl} onChange={e => setErc20Form({...erc20Form, externalUrl: e.target.value})} placeholder="https://example.com" />
          </div>
        </div>

        <ImageUpload
          onChange={handleErc20LogoChange}
          assetKind="bsna20-logo"
          value={erc20Form.logoPreview}
          label="Token Logo (required)"
          disabled={!assetServiceReady}
        />
        {!assetServiceReady && (
          <p style={{ color: 'var(--warning)', fontSize: '0.75rem', marginTop: '0.5rem' }}>
            ⚠ Asset service not running. Logo upload and token deployment are unavailable.
          </p>
        )}

        {/* Fee Estimation */}
        <div style={{ marginTop: '1rem', padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '4px', border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
            <strong>Fee Estimate</strong>
            <button className="btn btn-secondary" onClick={handleEstimateFees} disabled={estimatingFees || errors.length > 0 || !selectedNetwork?.configured} style={{ padding: '0.375rem 0.75rem', fontSize: '0.75rem' }}>
              {estimatingFees ? 'Estimating...' : 'Estimate Fees'}
            </button>
          </div>
          {feeEstimate && (
            <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              <div>Gas Limit: {feeEstimate.gasLimit}</div>
              <div>Estimated Fee: {feeEstimate.estimatedNativeFee} {feeEstimate.nativeSymbol} (native)</div>
              {feeEstimate.maxFeePerGas && <div>Max Fee Per Gas: {feeEstimate.maxFeePerGas} wei</div>}
              {feeEstimate.maxPriorityFeePerGas && <div>Max Priority Fee Per Gas: {feeEstimate.maxPriorityFeePerGas} wei</div>}
              {feeEstimate.gasPrice && <div>Gas Price (legacy): {feeEstimate.gasPrice} wei</div>}
              <div>Fee Model: {feeEstimate.model}</div>
            </div>
          )}
          {!feeEstimate && !estimatingFees && (
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', margin: 0 }}>Click "Estimate Fees" to get a fee quote for this deployment.</p>
          )}
        </div>

        {errors.length > 0 && (
          <div className="validation-errors" style={{ color: 'var(--error)', marginBottom: '1rem', fontSize: '0.875rem' }}>
            <strong>Validation errors:</strong>
            <ul style={{ margin: '0.5rem 0 0 1.5rem' }}>
              {errors.map((err, i) => <li key={i}>{err}</li>)}
            </ul>
          </div>
        )}

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <button className="btn" onClick={deployERC20} disabled={!canDeploy} style={{ flex: 1, minWidth: '200px' }}>
            {loading ? 'Deploying...' : 'Deploy Token'}
          </button>
          <button className="btn btn-secondary" onClick={() => setErc20Form({
            standard: 'BSNA-FTS1',
            name: '', symbol: '', decimals: '18', initialSupply: '', maxSupply: '',
            supplyPolicy: 'fixed', burnPolicy: 'disabled', pausePolicy: 'disabled',
            metadataMutable: false, description: '', externalUrl: '', owner: '',
            logoFile: null, logoPreview: null, logoDimensions: null
          })} disabled={loading}>
            Clear Form
          </button>
        </div>

        {status.message && (
          <p style={{ marginTop: '1rem', color: `var(--${status.type})` }}>
            {status.message}
          </p>
        )}
      </div>
    )
  }

  const renderNftTab = () => {
    return (
      <div>
        <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>Create NFT Collection (ERC-721 / BSNA-721)</h3>
        <div className="warning" style={{ marginBottom: '1rem' }}>
          NFT collection deployment is not available in this developer alpha. The previous tab sent
          constructor calldata without contract bytecode, so it could not create a contract. ERC-721 and
          BSNA-721 need their own audited reference contract before this form can be enabled.
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>
          Use the ERC-20 / BSNA-FTS1 tab for the supported fungible-token path. No NFT transaction is
          sent from this screen.
        </p>
        <button className="btn" disabled style={{ marginTop: '1rem', minWidth: '200px' }}>
          NFT deployment unavailable
        </button>
        {status.message && (
          <p style={{ marginTop: '1rem', color: `var(--${status.type})` }}>
            {status.message}
          </p>
        )}
      </div>
    )
  }

  const renderMintTab = () => {
    const mintable = deployedTokens.filter(
      t => t.standard === 'BSNA-FTS1' && t.permissions?.supplyPolicy === 'authorized-mint',
    )
    const canMint = mintable.length > 0 && mintForm.assetId && mintForm.recipient && mintForm.amount && !loading

    return (
      <div>
        <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>Mint BSNA-FTS1 (Authorized Mint)</h3>

        <div className="warning" style={{ marginBottom: '1rem' }}>
          Minting is sent by the local asset service with the development key on BTCS L2 local only.
          Fixed-supply tokens and the legacy ERC-20 contract have no mint entry point and are not listed here.
        </div>

        {mintable.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>
            No authorized-mint BSNA-FTS1 tokens are available on this network. Deploy one with the
            "Authorized Mint" supply policy first.
          </p>
        ) : (
          <>
            <div className="form-row">
              <div className="form-col">
                <label className="label">Token</label>
                <select className="input" value={mintForm.assetId} onChange={e => setMintForm({...mintForm, assetId: e.target.value})}>
                  <option value="">Select a token</option>
                  {mintable.map(token => (
                    <option key={token.id} value={token.id}>
                      {token.name} ({token.symbol}) — {token.contractAddress}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-col">
                <label className="label">Recipient Address</label>
                <input className="input" value={mintForm.recipient} onChange={e => setMintForm({...mintForm, recipient: e.target.value})} placeholder="0x..." />
              </div>
            </div>

            <label className="label">Amount (atomic units)</label>
            <input className="input" value={mintForm.amount} onChange={e => setMintForm({...mintForm, amount: e.target.value})}
              placeholder="1000000" />

            <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
              <button className="btn" onClick={handleMint} disabled={!canMint} style={{ flex: 1, minWidth: '200px' }}>
                {loading ? 'Minting...' : 'Mint'}
              </button>
              <button className="btn btn-secondary" onClick={async () => {
                try {
                  const deployments = await engineListDeployments(selectedNetworkId)
                  setDeployedTokens(deployments.map(deploymentToToken))
                } catch (error) {
                  setStatus({ message: `Could not refresh deployments: ${error.message}`, type: 'warning' })
                }
              }} disabled={loading}>
                Refresh Tokens
              </button>
            </div>
          </>
        )}

        {status.message && (
          <p style={{ marginTop: '1rem', color: `var(--${status.type})` }}>
            {status.message}
          </p>
        )}
      </div>
    )
  }

  const renderMyTokensTab = () => {
    return (
      <div>
        <h3 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>My Deployed Tokens</h3>

        {deployedTokens.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" style={{ margin: '0 auto 1rem', opacity: 0.5 }}>
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p>No tokens deployed yet</p>
            <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Create your first token using the ERC-20 or NFT tab
            </p>
          </div>
        ) : (
          <div className="tokens-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {deployedTokens.map(token => (
              <div key={token.id} className="token-card" style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: '8px',
                padding: '1.5rem',
                borderLeft: `3px solid ${token.type === 'fungible' ? 'var(--btcs-gold)' : 'var(--btcs-silver)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem', marginBottom: '1rem' }}>
                  {token.logoUri && (
                    <img src={deploymentLogoUrl(token.logoUri)} alt={`${token.name} logo`}
                      style={{ width: '48px', height: '48px', borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h4 style={{ color: 'var(--btcs-gold)', margin: 0, fontSize: '1.1rem' }}>
                      {token.name} ({token.symbol})
                    </h4>
                    <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      {token.standard || 'ERC-20'} · Fungible
                    </p>
                  </div>
                </div>

                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  <div><strong>Address:</strong> <code style={{ wordBreak: 'break-all' }}>{token.contractAddress}</code></div>
                  <div><strong>Network:</strong> {token.network} (Chain ID: {token.chainId})</div>
                  <div><strong>Deploy Tx:</strong> <code style={{ wordBreak: 'break-all' }}>{token.deployTxHash}</code></div>
                  <div><strong>Block:</strong> {token.blockNumber} | <strong>Gas Used:</strong> {token.gasUsed}</div>
                  {token.type === 'fungible' && (
                    <>
                      <div><strong>Decimals:</strong> {token.decimals}</div>
                      <div><strong>Total Supply:</strong> {token.totalSupply} (atomic)</div>
                    </>
                  )}
                  <div><strong>Owner:</strong> <code style={{ wordBreak: 'break-all' }}>{token.owner}</code></div>
                  <div><strong>Deployed:</strong> {new Date(token.deployedAt).toLocaleString()}</div>
                </div>

                {token.metadataUri && (
                  <a href={deploymentLogoUrl(token.metadataUri)} target="_blank" rel="noopener noreferrer"
                    className="btn btn-secondary" style={{ marginTop: '1rem', fontSize: '0.75rem', padding: '0.5rem 1rem' }}>
                    View Metadata
                  </a>
                )}

                <button
                  className="btn btn-secondary"
                  style={{ marginTop: '1rem', width: '100%', fontSize: '0.75rem', padding: '0.5rem' }}
                  onClick={() => setSelectedToken(token)}
                >
                  Inspect Contract
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // Status indicators
  const statusIndicators = (
    <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap', fontSize: '0.875rem' }}>
      <span className={rpcConnected ? 'success' : 'error'} style={{
        display: 'flex', alignItems: 'center', gap: '0.35rem',
        color: rpcConnected ? 'var(--success)' : 'var(--error)'
      }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }} />
        L2 RPC: {rpcConnected ? `Connected (Chain ${chainId})` : 'Disconnected'}
      </span>
      <span className={assetServiceReady ? 'success' : 'warning'} style={{
        display: 'flex', alignItems: 'center', gap: '0.35rem',
        color: assetServiceReady ? 'var(--success)' : 'var(--warning)'
      }}>
        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }} />
        Asset Service: {assetServiceReady ? 'Ready' : 'Unavailable'}
      </span>
    </div>
  )

  return (
    <div className="container">
      <h1 style={{ color: 'var(--btcs-gold)', marginBottom: '1rem' }}>Token Studio</h1>

      <div className="warning">
        Experimental token creation on BTCS L2 local development network only.
        Tokens are not backed by BTCS L1. This is a trusted single-operator prototype.
      </div>

      {statusIndicators}

      <div className="card">
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
          <button className={`btn ${tab === 'erc20' ? '' : 'btn-secondary'}`} onClick={() => { setTab('erc20'); setStatus({ message: '', type: '' }) }}>ERC-20 / BSNA-FTS1</button>
          <button className={`btn ${tab === 'nft' ? '' : 'btn-secondary'}`} onClick={() => { setTab('nft'); setStatus({ message: '', type: '' }) }}>NFT (ERC-721 / BSNA-721)</button>
          <button className={`btn ${tab === 'mint' ? '' : 'btn-secondary'}`} onClick={() => { setTab('mint'); setStatus({ message: '', type: '' }) }}>Mint</button>
          <button className={`btn ${tab === 'my' ? '' : 'btn-secondary'}`} onClick={() => { setTab('my'); setStatus({ message: '', type: '' }) }}>My Tokens</button>
        </div>

        {tab === 'erc20' && renderErc20Tab()}
        {tab === 'nft' && renderNftTab()}
        {tab === 'mint' && renderMintTab()}
        {tab === 'my' && renderMyTokensTab()}

        {/* Token detail modal */}
        {selectedToken && (
          <div className="modal-overlay" onClick={() => setSelectedToken(null)} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem'
          }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '2rem', maxWidth: '600px', width: '100%',
              maxHeight: '80vh', overflow: 'auto'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: 'var(--btcs-gold)', margin: 0 }}>Contract Details</h3>
                <button onClick={() => setSelectedToken(null)} style={{
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1
                }}>×</button>
              </div>
              <pre style={{
                background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px',
                overflow: 'auto', fontSize: '0.75rem', color: 'var(--text-primary)',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word'
              }}>
{JSON.stringify(selectedToken, null, 2)}
              </pre>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setSelectedToken(null)}>Close</button>
              </div>
            </div>
          </div>
        )}

        {/* Deployment receipt modal */}
        {deploymentReceipt && (
          <div className="modal-overlay" onClick={() => setDeploymentReceipt(null)} style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.7)', zIndex: 1001,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem'
          }}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '2rem', maxWidth: '700px', width: '100%',
              maxHeight: '85vh', overflow: 'auto'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                <h3 style={{ color: 'var(--btcs-gold)', margin: 0 }}>Deployment Receipt</h3>
                <button onClick={() => setDeploymentReceipt(null)} style={{
                  background: 'none', border: 'none', color: 'var(--text-secondary)',
                  fontSize: '1.5rem', cursor: 'pointer', lineHeight: 1
                }}>×</button>
              </div>

              {/* Transaction Status */}
              <div style={{ marginBottom: '1.5rem', padding: '1rem', borderRadius: '4px',
                background: deploymentReceipt.receipt?.status === '0x1' ? 'rgba(74, 222, 128, 0.1)' : 'rgba(248, 113, 113, 0.1)',
                border: `1px solid ${deploymentReceipt.receipt?.status === '0x1' ? 'var(--success)' : 'var(--error)'}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{
                    width: '12px', height: '12px', borderRadius: '50%',
                    background: deploymentReceipt.receipt?.status === '0x1' ? 'var(--success)' : 'var(--error)'
                  }} />
                  <strong style={{ color: deploymentReceipt.receipt?.status === '0x1' ? 'var(--success)' : 'var(--error)' }}>
                    {deploymentReceipt.receipt?.status === '0x1' ? 'Transaction Confirmed' : 'Transaction Reverted'}
                  </strong>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    Block: {deploymentReceipt.token.blockNumber !== 'N/A' ? `#${deploymentReceipt.token.blockNumber}` : 'Pending'}
                  </span>
                </div>
              </div>

              {/* Key Details Grid */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Contract Address</div>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.875rem' }}>{deploymentReceipt.deployment.contractAddress}</code>
                </div>
                <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Transaction Hash</div>
                  <code style={{ wordBreak: 'break-all', fontSize: '0.875rem' }}>{deploymentReceipt.deployment.creationTransactionHash}</code>
                </div>
                <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Chain ID</div>
                  <code>{deploymentReceipt.deployment.chainId} (0x{deploymentReceipt.deployment.chainId.toString(16)})</code>
                </div>
                <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Network</div>
                  <code>{deploymentReceipt.deployment.networkName}</code>
                </div>
              </div>

              {/* Gas & Block Details */}
              {deploymentReceipt.receipt && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                  <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Block Number</div>
                    <code>{deploymentReceipt.token.blockNumber}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Gas Used</div>
                    <code>{deploymentReceipt.token.gasUsed}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Effective Gas Price</div>
                    <code>{deploymentReceipt.token.effectiveGasPrice ? (deploymentReceipt.token.effectiveGasPrice / 1e9).toFixed(2) + ' gwei' : 'N/A'}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', marginBottom: '0.25rem' }}>Logs</div>
                    <code>{deploymentReceipt.token.logs?.length || 0} events</code>
                  </div>
                </div>
              )}

              {/* Fee Quote */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: 'var(--btcs-gold)', marginBottom: '0.75rem', fontSize: '0.875rem' }}>Fee Estimate (Pre-Deployment)</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Estimated Gas Limit</div>
                    <code>{deploymentReceipt.feeQuote.gasLimit}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Estimated Native Fee</div>
                    <code>{deploymentReceipt.feeQuote.estimatedNativeFee} {deploymentReceipt.feeQuote.nativeSymbol}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Fee Model</div>
                    <code>{deploymentReceipt.feeQuote.model}</code>
                  </div>
                  {deploymentReceipt.feeQuote.maxFeePerGas && (
                    <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      <div style={{ color: 'var(--text-secondary)' }}>Max Fee Per Gas</div>
                      <code>{(deploymentReceipt.feeQuote.maxFeePerGas / 1e9).toFixed(2)} gwei</code>
                    </div>
                  )}
                  {deploymentReceipt.feeQuote.maxPriorityFeePerGas && (
                    <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                      <div style={{ color: 'var(--text-secondary)' }}>Max Priority Fee</div>
                      <code>{(deploymentReceipt.feeQuote.maxPriorityFeePerGas / 1e9).toFixed(2)} gwei</code>
                    </div>
                  )}
                </div>
              </div>

              {/* Contract Details */}
              <div style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ color: 'var(--btcs-gold)', marginBottom: '0.75rem', fontSize: '0.875rem' }}>Deployed Contract</h4>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.875rem' }}>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Name</div>
                    <code>{deploymentReceipt.deployment.name}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Symbol</div>
                    <code>{deploymentReceipt.deployment.symbol}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Decimals</div>
                    <code>{deploymentReceipt.deployment.decimals}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Total Supply (atomic)</div>
                    <code>{deploymentReceipt.deployment.supplyAtomic}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Owner / Deployer</div>
                    <code style={{ wordBreak: 'break-all' }}>{deploymentReceipt.deployment.deployer}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Standard</div>
                    <code>{deploymentReceipt.deployment.standard || 'ERC-20'}</code>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--text-secondary)' }}>Interface</div>
                    <code>{deploymentReceipt.deployment.interfaceConvention.toUpperCase()}</code>
                  </div>
                </div>
              </div>

              {/* Metadata & Logo */}
              {(deploymentReceipt.deployment.metadata.logo || deploymentReceipt.deployment.metadata.description) && (
                <div style={{ marginBottom: '1.5rem' }}>
                  <h4 style={{ color: 'var(--btcs-gold)', marginBottom: '0.75rem', fontSize: '0.875rem' }}>Metadata</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem' }}>
                    {deploymentReceipt.deployment.metadata.description && (
                      <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Description</div>
                        <code>{deploymentReceipt.deployment.metadata.description}</code>
                      </div>
                    )}
                    {deploymentReceipt.deployment.metadata.externalUrl && (
                      <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>External URL</div>
                        <a href={deploymentReceipt.deployment.metadata.externalUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--btcs-gold)', wordBreak: 'break-all' }}>
                          {deploymentReceipt.deployment.metadata.externalUrl}
                        </a>
                      </div>
                    )}
                    {deploymentReceipt.deployment.metadata.logo && (
                      <div style={{ background: 'var(--bg-secondary)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--border)' }}>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>Logo URI</div>
                        <code style={{ wordBreak: 'break-all' }}>{deploymentReceipt.deployment.metadata.logo.uri}</code>
                        {deploymentReceipt.deployment.metadata.logo.uri && (
                          <img src={deploymentLogoUrl(deploymentReceipt.deployment.metadata.logo.uri)} alt="Logo" style={{ width: '64px', height: '64px', borderRadius: '4px', marginTop: '0.5rem', objectFit: 'cover' }} />
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Full JSON */}
              <details style={{ marginTop: '1.5rem' }}>
                <summary style={{ cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Show Full JSON</summary>
                <pre style={{
                  background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '4px', marginTop: '0.75rem',
                  overflow: 'auto', fontSize: '0.7rem', color: 'var(--text-primary)',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: '300px'
                }}>
{JSON.stringify(deploymentReceipt, null, 2)}
                </pre>
              </details>

              <div style={{ display: 'flex', gap: '1rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary" onClick={() => setDeploymentReceipt(null)}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default TokenStudio