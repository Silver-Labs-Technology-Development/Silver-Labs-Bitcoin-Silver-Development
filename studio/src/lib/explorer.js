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
