const ASSET_SERVICE_URL = import.meta.env.VITE_ASSET_SERVICE_URL || 'http://127.0.0.1:3001'
const RPC_URL = import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545'

export async function uploadAssetLogo(file, context) {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('assetKind', context.assetKind)
  if (context.name) formData.append('name', context.name)
  if (context.description) formData.append('description', context.description)
  if (context.externalUrl) formData.append('externalUrl', context.externalUrl)
  if (context.chainId) formData.append('chainId', String(context.chainId))
  if (context.contractAddress) formData.append('contractAddress', context.contractAddress)
  if (context.tokenId) formData.append('tokenId', context.tokenId)
  if (context.attributes) formData.append('attributes', JSON.stringify(context.attributes))

  const response = await fetch(`${ASSET_SERVICE_URL}/api/assets/images`, {
    method: 'POST',
    body: formData,
  })

  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Upload failed')
  }
  return data
}

export async function fetchAssetServiceLimits() {
  const response = await fetch(`${ASSET_SERVICE_URL}/api/assets/images/limits`)
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Failed to fetch limits')
  }
  return data
}

export async function fetchAssetServiceHealth() {
  const response = await fetch(`${ASSET_SERVICE_URL}/healthz`)
  const data = await response.json()
  return data
}

// Asset Engine API
export async function fetchEngineNetworks() {
  const response = await fetch(`${ASSET_SERVICE_URL}/api/asset-engine/networks`)
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Failed to fetch networks')
  }
  return data.networks
}

export async function engineConnect(networkId, rpcUrl) {
  const response = await fetch(`${ASSET_SERVICE_URL}/api/asset-engine/connect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ networkId, rpcUrl }),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Failed to connect to network')
  }
  return data.connection
}

export async function engineGetConnection() {
  const response = await fetch(`${ASSET_SERVICE_URL}/api/asset-engine/connection`)
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Failed to get connection')
  }
  return data.connection
}

export async function engineEstimateFees(params) {
  const response = await fetch(`${ASSET_SERVICE_URL}/api/asset-engine/estimate-fees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Failed to estimate fees')
  }
  return data.estimate
}

export async function engineDeploy(params) {
  const response = await fetch(`${ASSET_SERVICE_URL}/api/asset-engine/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Deployment failed')
  }
  return data
}

export async function engineListDeployments(networkId) {
  const url = new URL(`${ASSET_SERVICE_URL}/api/asset-engine/deployments`)
  if (networkId) url.searchParams.set('networkId', networkId)
  const response = await fetch(url)
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Failed to list deployments')
  }
  return data.deployments
}

/**
 * Registry-local logos are stored by digest, not by a browser-loadable URL.
 * Translate them through the asset service so <img> and links work.
 */
export function deploymentLogoUrl(uri) {
  if (typeof uri !== 'string' || uri.length === 0) return uri
  const prefix = 'registry-local:'
  if (!uri.startsWith(prefix)) return uri
  const digest = uri.slice(prefix.length)
  if (!/^[0-9a-f]{64}$/.test(digest)) return null
  return `${ASSET_SERVICE_URL}/api/asset-engine/logos/${digest}`
}

export async function engineMint(params) {
  const response = await fetch(`${ASSET_SERVICE_URL}/api/asset-engine/mint`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Mint failed')
  }
  return data
}

export async function engineAttachLogo(assetId, logoBase64) {  const response = await fetch(`${ASSET_SERVICE_URL}/api/asset-engine/attach-logo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, logoBase64 }),
  })
  const data = await response.json()
  if (!response.ok || !data.ok) {
    throw new Error(data.error?.message || 'Failed to attach logo')
  }
  return data.deployment
}

export async function rpcCall(method, params = []) {
  const response = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const data = await response.json()
  if (data.error) {
    throw new Error(data.error.message)
  }
  return data.result
}

export async function fetchChainId() {
  return rpcCall('eth_chainId')
}

export async function fetchBlockNumber() {
  return rpcCall('eth_blockNumber')
}

export async function fetchNetVersion() {
  return rpcCall('net_version')
}

export async function fetchNetListening() {
  return rpcCall('net_listening')
}

export async function fetchNetPeerCount() {
  return rpcCall('net_peerCount')
}