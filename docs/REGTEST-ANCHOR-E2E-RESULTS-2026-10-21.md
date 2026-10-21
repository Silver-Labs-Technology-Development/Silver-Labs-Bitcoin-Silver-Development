# BTCS L2 regtest settlement-anchor publication

Date: 2026-10-21
Result: **PASS**

The existing anchor publisher ran on Node v24.17.0 against the dedicated BTCS
Core regtest daemon and funded test wallet used by the deposit E2E. Core
reported chain=regtest. The signed transaction passed Core's mempool
acceptance check, was mined at height 305, and its confirmed publication record
matched after reopening the local publication store. The daemon was stopped
after the run. The publication store used for this run was temporary and its
verified result is preserved below.

## Verified values

- L2 batch: 0e1584e64bbad4599a3c41b99ad0adc742d3dd71aeb4a1a65dc7e2bb9cca92e2
- L2 range: heights 0–1, two blocks independently execution-verified
- BTCS transaction: 0f8e38fd2becf74caefffc36f8f7da8cb16f17bc5693f9dc4be1b9df76343e43
- Inclusion block: 64cc4bd3cc6546c160936e1e6544d6043c22a1afbb521e78f4b28e694c1faaf5
- Inclusion height and confirmations: 305, 1
- Publication lifecycle: prepared → submitted → confirmed
- Durable reopen: confirmed record matched the verified record byte-for-byte after JSON serialization
- Signed transaction: exactly one expected OP_RETURN commitment; testmempoolaccept returned allowed

## Limits

The transaction contains only the batch commitment. The complete batch body was
not published to BTCS, and this run therefore does not establish data
availability or reconstruction from L1. It also did not run the optional
destructive reorg scenario. Verification trusts local BTCS Core RPC and is a
regtest prototype result, not production settlement finality.
