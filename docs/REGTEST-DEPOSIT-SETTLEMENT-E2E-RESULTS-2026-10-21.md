# BTCS L2 regtest deposit-to-settlement run

Date: 2026-10-21
Result: **PASS**

The real E2E ran with Node v24.17.0 against the dedicated BTCS Core regtest
data directory `~/.local/share/btcs-l2-deposit-regtest-20261011`. Core reported
`chain=regtest`. The daemon was stopped with the matching `bitcoinsilver-cli
stop` command after the run; the dedicated Core wallet and data remain on disk.
The runner's temporary L2 chain and deposit-store files were cleaned up.

## Finding and correction

The first run mined 101 blocks and then failed at `fundrawtransaction` with
`Insufficient funds`. The BTCS Core source sets
`COINBASE_MATURITY = 200` in `src/consensus/consensus.h`; therefore 101 blocks
leave all coinbase rewards immature. The E2E runner and its README now mine 201
funding blocks. The successful retry started from the existing height 101,
mined the additional 201 funding blocks, and completed the full deposit and
settlement flow.

## Successful run

- L1 deposit transaction: `6a6d91b053844081736ce9f6f4b8dba0dbf1b3c9b61cbb5c47050d1df7fed791`
- Inclusion block: `0e9134bc7d6dff5db145a4c264ebd6da2366fa0814b39f6e4292819e8dc7861a`, height 303, 2 confirmations
- Deposit record: `6a6d91b053844081736ce9f6f4b8dba0dbf1b3c9b61cbb5c47050d1df7fed791:0`
- Amount: 10,000,000 satoshis (0.1 BTC)
- L2 profile: `btcs-l2-local-v0.12-deposit-prelude`
- L2 block: height 1, hash `0xe5cee52795e039c7266719e35f5ce6eeabd7a660910006f31bf239fa670fe38d`
- L2 recipient: `0x1111111111111111111111111111111111111111`
- Credited amount: `100000000000000000` wei
- L2 state root: `0x680666422276e0bbb9de9c4179f94533bff91ba551457b3e2ef3292de09a9f9b`
- Settlement: v2 batch `f4cbd534c93c3bd3573f1a942f532e83d71f62d19784bcf3439accad3970a0ab`
- Settlement execution replay passed for both blocks; the child block was re-executed, and the independent state root and recipient balance matched.

## Limits

This demonstrates the local deposit-to-settlement prototype against a real
regtest transaction. L1 verification trusts the local Core RPC. The run did not
simulate an L1 reorg, prove trustless inclusion, test production escrow, or
implement withdrawals.
