export async function getRecentTransactions(blocks, callRpc, limit = 50) {
  if (!Array.isArray(blocks) || !Number.isInteger(limit) || limit < 0) {
    throw new TypeError('Invalid recent-block transaction request')
  }

  const transactions = blocks.flatMap((block) => {
    if (!Array.isArray(block.transactions)) {
      throw new Error(`Block ${block.number} is missing its full transaction list`)
    }

    return block.transactions.map((transaction) => ({
      ...transaction,
      blockNumber: block.number,
      blockHash: block.hash,
    }))
  })

  return Promise.all(
    transactions.slice(0, limit).map(async (transaction) => {
      const receipt = await callRpc('eth_getTransactionReceipt', [transaction.hash])
      return {
        ...transaction,
        receiptGasUsed: receipt?.gasUsed ?? null,
        receiptStatus: receipt?.status ?? null,
      }
    }),
  )
}

function summarizeBlock(block) {
  if (!Array.isArray(block.transactions)) {
    throw new Error(`Block ${block.number} is missing its full transaction list`)
  }

  return {
    number: Number.parseInt(block.number, 16),
    hash: block.hash,
    timestamp: Number.parseInt(block.timestamp, 16),
    txCount: block.transactions.length,
    gasUsed: Number.parseInt(block.gasUsed, 16),
    gasLimit: Number.parseInt(block.gasLimit, 16),
    miner: block.miner,
    transactions: block.transactions,
  }
}

function parseBlockNumber(query) {
  if (/^(0|[1-9]\d*)$/.test(query)) {
    const number = Number(query)
    return Number.isSafeInteger(number) ? number : null
  }

  if (/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(query)) {
    const number = Number.parseInt(query.slice(2), 16)
    return Number.isSafeInteger(number) ? number : null
  }

  return null
}

export async function lookupExplorerQuery(query, callRpc) {
  if (typeof query !== 'string' || typeof callRpc !== 'function') {
    throw new TypeError('Invalid explorer lookup request')
  }

  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    throw new TypeError('Enter a block number, block hash, or transaction hash')
  }

  if (/^0x[0-9a-f]{64}$/i.test(normalizedQuery)) {
    const block = await callRpc('eth_getBlockByHash', [normalizedQuery, true])
    if (block) {
      const summary = summarizeBlock(block)
      return {
        type: 'block',
        block: summary,
        transactions: await getRecentTransactions([summary], callRpc),
      }
    }

    const transaction = await callRpc('eth_getTransactionByHash', [normalizedQuery])
    if (!transaction) return null

    const receipt = await callRpc('eth_getTransactionReceipt', [normalizedQuery])
    return {
      type: 'transaction',
      transaction: {
        ...transaction,
        receiptGasUsed: receipt?.gasUsed ?? null,
        receiptStatus: receipt?.status ?? null,
      },
    }
  }

  const blockNumber = parseBlockNumber(normalizedQuery)
  if (blockNumber === null) {
    throw new TypeError('Enter a decimal/hex block number or a 32-byte block/transaction hash')
  }

  const block = await callRpc('eth_getBlockByNumber', [`0x${blockNumber.toString(16)}`, true])
  if (!block) return null

  const summary = summarizeBlock(block)
  return {
    type: 'block',
    block: summary,
    transactions: await getRecentTransactions([summary], callRpc),
  }
}
