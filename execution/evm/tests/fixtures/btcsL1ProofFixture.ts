/**
 * Captured fixtures from the disposable BTCS Core regtest node used for local
 * verification. These are test vectors only; they are not a canonical chain
 * checkpoint and do not authorize mainnet assumptions.
 */
export const HEIGHT_555_HASH = '6989bb1793d50a5924c9cf4207a3752eeb8fd24e555a4189d30dcc3cc0a325be'
export const HEIGHT_556_HASH = '18a3761639f04add542fa3499e5bedced8e1fe52f6261855f45897e8ec0ac35f'
export const HEIGHT_556_PREVIOUS_HASH = HEIGHT_555_HASH
export const HEIGHT_556_MERKLE_ROOT =
  'b77269d37fac5e57a088f47398dd4c29606fd0765a74a4ac498eaaa69f263553'
export const HEIGHT_556_TIME = 1792635718
export const HEIGHT_555_TIME = 1792634835
export const HEIGHT_555_MERKLE_ROOT =
  '5aa32f7030b49fb322c407dcb13ad820a35bdbb7f00a4d0350564225fc76463c'
export const HEIGHT_555_PREVIOUS_HASH =
  '1c0cac56500231be210b18a50a30d366b2a3a5be2293b2962abf59d53ee904ec'

/** Real transaction in height 556. */
export const REAL_TXID =
  'e4089e4abb04b8a9c7fe671edc40afdebd08ef5e00836d672b6e8664bd9c7a7e'

/** Raw `gettxoutproof` result for REAL_TXID in HEIGHT_556_HASH. */
export const REAL_PROOF =
  '00000020be25a3c03ccc0dd389415a554ed28feb2e75a30742cfc924590ad59317bb896953' +
  '35269fa6aa8e49aca4745a76d06f60294cdd9873f488a0575eac7fd36972b74673d96affff' +
  '7f200000000002000000027e7a9cbd64866e2b676d83005eef08bddeaf40dc1e67fec7a9b8' +
  '04bb4a9e08e41c95d7705c4ace216fe02c07b8f96e7e7dd8bbbd1e8d3777717ea4d5d5469' +
  '3330103'
