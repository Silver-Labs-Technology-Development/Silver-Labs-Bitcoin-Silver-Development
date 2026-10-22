import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeBtcsL1AnchorScript } from '../src/btcsL1Anchor.js'
import { verifyBtcsL1AnchorConfirmation } from '../src/btcsL1Confirmation.js'
import {
  encodeBtcsL1DepositPayload,
  encodeBtcsL1DepositScript,
  verifyBtcsL1Deposit,
} from '../src/btcsL1Deposit.js'

const txid = '1'.repeat(64)
const blockHash = '2'.repeat(64)
const batchHash = '3'.repeat(64)
const recipient = '0x1111111111111111111111111111111111111111'
const depositScript = '76a914' + 'ab'.repeat(20) + '88ac'

function makeAnchorRpc(options: any = {}) {
  return {
    async getRawTransaction() {
      if (options.rawTxError) throw options.rawTxError
      if (options.rawTxReturnsUndefined) return undefined
      return options.rawTx ?? {
        txid,
        blockhash: blockHash,
        in_active_chain: true,
        confirmations: 10,
        vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }],
      }
    },
    async getBlockHeader() {
      if (options.headerError) throw options.headerError
      if (options.headerReturnsUndefined) return undefined
      return options.header ?? {
        hash: blockHash,
        height: 120,
        confirmations: 10,
      }
    },
  }
}

function makeDepositRpc(options: any = {}) {
  return {
    async getRawTransaction() {
      if (options.rawTxError) throw options.rawTxError
      if (options.rawTxReturnsUndefined) return undefined
      return options.rawTx ?? {
        txid,
        blockhash: blockHash,
        in_active_chain: true,
        confirmations: 10,
        vout: [
          { n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } },
          { n: 1, value: 1.0, scriptPubKey: { hex: depositScript } },
        ],
      }
    },
    async getBlockHeader() {
      if (options.headerError) throw options.headerError
      if (options.headerReturnsUndefined) return undefined
      return options.header ?? {
        hash: blockHash,
        height: 150,
        confirmations: 10,
      }
    },
  }
}

test('SG-01 anchor: wrong network/chain identity - rejects non-active chain', async () => {
  const rpc = makeAnchorRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: false, confirmations: 10, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }] } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /active chain/)
})

test('SG-01 anchor: txid mismatch', async () => {
  const rpc = makeAnchorRpc({ rawTx: { txid: '4'.repeat(64), blockhash: blockHash, in_active_chain: true, confirmations: 10, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }] } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /different txid/)
})

test('SG-01 anchor: blockhash mismatch', async () => {
  const rpc = makeAnchorRpc({ rawTx: { txid, blockhash: '5'.repeat(64), in_active_chain: true, confirmations: 10, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }] } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /not in the requested block/)
})

test('SG-01 anchor: missing tx/vout', async () => {
  const rpc = makeAnchorRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 10 } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /vout/)
})

test('SG-01 anchor: header mismatch', async () => {
  const rpc = makeAnchorRpc({ header: { hash: '6'.repeat(64), height: 120, confirmations: 10 } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /different block hash/)
})

test('SG-01 anchor: confirmations disagree', async () => {
  const rpc = makeAnchorRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 9, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }] }, header: { hash: blockHash, height: 120, confirmations: 10 } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /confirmation counts disagree/)
})

test('SG-01 anchor: insufficient confirmations', async () => {
  const rpc = makeAnchorRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 5, vout: [{ scriptPubKey: { hex: encodeBtcsL1AnchorScript(batchHash) } }] }, header: { hash: blockHash, height: 120, confirmations: 5 } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 6 }), /insufficient confirmations/)
})

test('SG-01 anchor: RPC timeout/error propagates', async () => {
  const rpc = makeAnchorRpc({ rawTxError: new Error('timeout') })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /timeout/)
})

test('SG-01 anchor: malformed header', async () => {
  const rpc = makeAnchorRpc({ header: { hash: blockHash, height: -1, confirmations: 10 } })
  await assert.rejects(verifyBtcsL1AnchorConfirmation(rpc as any, { txid, blockHash, batchHash, requiredConfirmations: 1 }), /invalid height/)
})

test('SG-01 deposit: wrong chain/active', async () => {
  const rpc = makeDepositRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: false, confirmations: 10, vout: [{ n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } }, { n: 1, value: 1.0, scriptPubKey: { hex: depositScript } }] } })
  await assert.rejects(verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /active chain/)
})

test('SG-01 deposit: txid/block mismatch', async () => {
  const rpc = makeDepositRpc({ rawTx: { txid: '7'.repeat(64), blockhash: blockHash, in_active_chain: true, confirmations: 10, vout: [{ n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } }, { n: 1, value: 1.0, scriptPubKey: { hex: depositScript } }] } })
  await assert.rejects(verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /different txid/)
})

test('SG-01 deposit: missing intent or duplicate', async () => {
  const rpc = makeDepositRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 10, vout: [{ n: 1, value: 1.0, scriptPubKey: { hex: depositScript } }] } })
  await assert.rejects(verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /exactly one/)
  const rpc2 = makeDepositRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 10, vout: [{ n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } }, { n: 2, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } }, { n: 1, value: 1.0, scriptPubKey: { hex: depositScript } }] } })
  await assert.rejects(verifyBtcsL1Deposit(rpc2 as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /exactly one/)
})

test('SG-01 deposit: wrong recipient', async () => {
  const rpc = makeDepositRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 10, vout: [{ n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript('0x2222222222222222222222222222222222222222') } }, { n: 1, value: 1.0, scriptPubKey: { hex: depositScript } }] } })
  await assert.rejects(verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /recipient does not match/)
})

test('SG-01 deposit: payment not whole satoshis', async () => {
  const rpc = makeDepositRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 10, vout: [{ n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } }, { n: 1, value: 1.00000001, scriptPubKey: { hex: depositScript } }] } })
  try {
    await verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 })
    assert.fail('should have thrown')
  } catch (e: any) {
    assert.ok(e instanceof Error)
  }
})

test('SG-01 deposit: intent has value', async () => {
  const rpc = makeDepositRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 10, vout: [{ n: 0, value: 0.001, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } }, { n: 1, value: 1.0, scriptPubKey: { hex: depositScript } }] } })
  await assert.rejects(verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /zero value/)
})

test('SG-01 deposit: header confirms disagree', async () => {
  const rpc = makeDepositRpc({ rawTx: { txid, blockhash: blockHash, in_active_chain: true, confirmations: 9, vout: [{ n: 0, value: 0, scriptPubKey: { hex: encodeBtcsL1DepositScript(recipient) } }, { n: 1, value: 1.0, scriptPubKey: { hex: depositScript } }] }, header: { hash: blockHash, height: 150, confirmations: 10 } })
  await assert.rejects(verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /confirmation counts disagree/)
})

test('SG-01 deposit: RPC timeout', async () => {
  const rpc = makeDepositRpc({ headerError: new Error('timeout') })
  await assert.rejects(verifyBtcsL1Deposit(rpc as any, { txid, blockHash, recipientAddress: recipient, depositScriptPubKeyHex: depositScript, requiredConfirmations: 1 }), /timeout/)
})
