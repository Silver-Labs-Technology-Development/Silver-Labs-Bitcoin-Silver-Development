# BTCS L2 regtest batch-data publication and reconstruction

Date: 2026-10-21
Result: **PASS**

The Node v24.17.0 runner independently execution-verified a two-block sample
settlement batch, published its full canonical JSON in one transaction per
fragment, published the matching batch commitment, mined the transactions in
one BTCS Core regtest block, then reconstructed and verified the exact bytes
from that active block.

## Run

- Core version: BitcoinSilver v31.1.3
- Network: `regtest`
- Existing dedicated chain: `~/.local/share/btcs-l2-deposit-regtest-20261011`
- RPC endpoint: IPv6 loopback, port `29445`
- Wallet: `btcs-l2-deposit-e2e`
- Starting height: `305`
- Wallet preparation: 201 regtest funding blocks were mined to a fresh wallet
  address because no confirmed spendable outputs remained; the chain reached
  height `506` before publication.
- The runner broadcasts transactions and mines one block. Core was stopped
  afterward with its local `stop` RPC. A follow-up RPC request failed to
  connect, confirming that the dedicated daemon had stopped. Wallet and chain
  data remain on disk.

## Verified publication

- Settlement batch hash: `795e59d15f242bd4b307673892fa568078c19e7bb3c9e39a78cd8341bf0af2cf`
- Batch range: heights `0–1`; two blocks independently execution-verified
- Canonical serialized batch size: `4,472` bytes
- Data fragments: `128`, each carrying at most 35 batch bytes plus its
  versioned batch-hash/index/count/length header
- Commitment transaction: `d7a9f5f4805d6827acb85e457397b092c7c253173cf7e5ed6cab8b2a2f6600e2`
- First fragment transaction: `69e62bc5ca985dfb1dcc8c309e78b816181ea338bfa4faa0f2a777494994a8d1`
- Last fragment transaction: `e00ce9e162bf5a962391149e0e951ba6455dbe0f6bfdaf05a05b071e375c9fbf`
- Publication block: `2013c1b7a0a630b2f8e20ae17f1f17445ce55b60f6feafab87997dc903702ef6`, height `507`
- Core accepted the fragment transactions and the matching commitment; all 129
  transactions were found in the active publication block.
- The anchor confirmation verifier returned one active-chain confirmation.
- Reconstruction from verbosity-2 block outputs returned all `128` fragments;
  canonical bytes matched exactly and the existing batch hash verified.

The E2E sets the wallet fee rate to `2 sat/vB`, since this regtest had no fee
estimation history and Core's fallback fee was disabled. It uses IPv6 loopback
because this Core instance bound RPC to `::1`; the runner accepts only
`127.0.0.1`, `localhost`, or `::1`.

## Limits

The fragment codec caps a batch at 16 KiB and 468 fragments. The runner caps
itself at 500 data transactions. This is a small prototype, not an economical or
scalable data-availability design. The E2E puts all fragments in one regtest
block and verifies one confirmation; it does not test fragment reorg recovery,
an external clean-node sync, or independent BTCS inclusion proofs. Recovery
requires a caller to fetch active-chain Core blocks, apply a confirmation
policy, then invoke the reconstruction helper with the expected batch hash and
trusted start anchors.
