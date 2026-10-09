# BTCS L2 Local JSON-RPC v0.12 Draft

Status: local prototype interface. This document specifies the read-only
loopback RPC exposed by `execution/evm/src/rpc.ts`. The optional v0.14
development-sequencer extension is documented in
[`BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md`](BTCS-L2-TRANSACTION-POOL-v0.14-DRAFT.md).
Neither mode is a production node or a claim of complete Ethereum JSON-RPC
compatibility.

## Scope and trust boundary

The RPC reads the canonical history of the v0.11 local persistent processor.
Queries invoke canonical replay, which reexecutes the selected chain from the
fixed genesis and checks stored blocks, transactions, execution sidecars, and
roots before returning results. State queries select the state root from that
verified replay. Read methods return only canonical blocks and included
transactions. By default the server does not build blocks or mutate chain
state. Only when explicitly started with `--dev-sequencer` does it create a
process-local signed-transaction pool and expose raw transaction admission and
manual block production. Neither mode broadcasts transactions or connects to
BTCS L1.

EthereumJS supplies Osaka EVM and Ethereum block/transaction/receipt encodings.
The local chain still uses its own genesis, chain rules, block-production
policy, and persistent-chain selection. EVM chain ID `31337` is development
only. The block response resembles an Ethereum block object because it reports
the stored EthereumJS block header; it does not make this custom chain an
Ethereum network or an Ethereum consensus implementation.

Each HTTP request that reads canonical data lazily replays the chain from
genesis once and creates an in-memory `CanonicalReadView`. The entries in a
JSON-RPC batch share that verified snapshot. The view is discarded when the
HTTP request finishes; there is no cache across requests or across store
reopens, so the next request rechecks on-disk canonical records. This avoids
replaying twice within one block or state query and keeps a batch on one
consistent snapshot. Replay time and the view's memory use still grow with
history.

The server permits at most four in-flight HTTP requests and rejects further
requests with HTTP 503 and `-32005` until a slot is free. This bounds
simultaneous replay sessions but does not provide a request-rate limiter, a
per-chain-height work budget, or a production availability guarantee. This
prototype is intended for a trusted local developer process.

## Transport and lifecycle

- The listener binds exclusively to IPv4 `127.0.0.1`. There is no host/bind
  override and no IPv6, wildcard, or public-interface listener.
- Only `POST /` is accepted. The request must use `Content-Type:
  application/json` (an optional charset parameter is allowed) and omit
  `Content-Encoding` or use `identity`.
- The peer address must be `127.0.0.1`. `Host` must name `127.0.0.1` or
  `localhost` and the actual listening port. At port 80, the standard omitted
  port spelling is also accepted. Other hosts receive HTTP 403.
- No CORS headers are sent; `OPTIONS` receives HTTP 405. There is no static
  file route, arbitrary path access, authentication layer, or remote access.
- The CLI requires an explicit local store path:
  `npm run rpc -- --datadir <local-store-path> [--port 8545]`. An empty path is
  initialized with the processor's fixed local genesis. The default port is
  `8545`; port `0` is available only through the in-process test API.
- Read-only methods are the default. `--dev-sequencer` must be supplied to
  enable `eth_sendRawTransaction` and the explicitly invoked `btcs_dev_mine`.
  No block is produced automatically.
- `SIGINT` and `SIGTERM` stop accepting connections and close open HTTP
  connections. A startup error exits nonzero. The CLI does not start a block
  producer or transaction pool.

## Request and response format

Requests use JSON-RPC 2.0 objects:

```json
{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}
```

Implemented methods use positional array parameters. Named-parameter objects
are not supported and produce `-32602`. Unknown envelope properties, an
invalid JSON-RPC version, invalid method, or invalid ID produce
`-32600`. IDs may be `null`, strings up to 128 characters, or safe integer
numbers. A missing ID is treated as a notification: the method is processed
and no response is returned (HTTP 204 when every request in a batch is a
notification).

The server rejects duplicate JSON object member names, including names that
become equal after JSON escape decoding. It rejects the entire body with
`-32600` and a null ID before dispatch, including when the duplicate is inside
parameters or a batch entry. Raw JSON depth, node, and per-container limits
are checked before dispatch, counting repeated members as they appear in the
body.

Responses have the JSON-RPC 2.0 `result` or `error` member and preserve the
request ID. A batch is processed in supplied order, with one response per
request that has an ID. An empty batch is invalid. A malformed JSON body
receives HTTP 400 and a `-32700` error object. Other JSON-RPC errors normally
use HTTP 200.

## Encodings and parameters

- Quantity inputs use the lowercase `0x` prefix and minimal hexadecimal digits
  (hex digits may be upper or lowercase); outputs use lowercase. Zero is
  `0x0`.
  Block-number quantities are limited to `0` through `2^53 - 1`, the maximum
  safely indexable height in this prototype. A quantity with leading zeroes,
  a decimal number, a negative value, or a value above that limit is invalid.
- Byte data uses `0x` followed by an even number of hexadecimal digits. Fixed
  addresses are 20 bytes; block and transaction hashes and topics are 32
  bytes. Input hex digits are case-insensitive; returned data is lowercase.
  Returned code and log data are byte data. `eth_getStorageAt` accepts a
  minimal quantity from `0` through `2^256 - 1` as its storage position and
  returns exactly 32 bytes, left-padded with zeroes.
- Block references accept `latest`, `earliest`, or a supported hexadecimal
  block number. `pending`, `safe`, and `finalized` are rejected because this
  chain defines no pending block, safe head, or finalized head.
- An absent state block reference is not accepted by state methods; callers
  provide it explicitly. Historical reads are allowed only for canonical
  heights. A state block number above the canonical tip is invalid parameters
  (`-32602`); a missing/corrupt canonical record fails closed as `-32000`.
- `eth_getBlockByNumber` and `eth_getBlockByHash` require the second parameter
  to be a boolean. `false` returns transaction hashes; `true` returns full
  signed type-2 transaction objects.
- `eth_getLogs` accepts only `fromBlock`, `toBlock`, `blockHash`, `address`,
  and `topics`. Each omitted range endpoint defaults to `latest`. A supplied
  `blockHash` cannot be combined with either range endpoint; an unknown
  canonical hash returns an empty array. Address filters accept one address
  or up to 64 addresses. There may be up to four topic positions; a position
  may be `null`, one topic, or up to 32 alternatives. Address and topic
  matching is case-insensitive. `removed` is always false because this local
  chain has no reorganization/fork-choice API.

## Limits

| Input or output | Limit |
|---|---:|
| HTTP request body | 1,048,576 bytes |
| JSON-RPC batch | 20 requests |
| JSON nesting depth | 32 levels |
| JSON value nodes | 10,000 |
| Items or properties in any JSON container | 256 |
| Method name | 128 characters |
| String request ID | 128 characters |
| `eth_getLogs` block span, inclusive | 10,000 blocks |
| `eth_getLogs` matching results | 10,000 logs |
| Log filter addresses | 64 |
| Topic positions | 4 |
| Alternatives at one topic position | 32 |
| Serialized response | 33,554,432 bytes |
| Concurrent HTTP requests | 4 |
| Raw transaction bytes (when enabled) | 131,072 bytes |
| Pending transactions (when enabled) | 1,024 |
| Pending serialized bytes (when enabled) | 15,728,640 bytes |
| Pending transactions per sender (when enabled) | 64 |
| HTTP headers / header timeout | 64 / 5 seconds |
| HTTP request timeout / keep-alive timeout | 10 / 5 seconds |
| Requests per socket | 100 |

Oversized requests receive HTTP 413 and `-32005`. Excessive log span,
result count, or response size returns `-32005`. An oversized batch receives
`-32600`. Requests above the concurrency cap receive HTTP 503 and `-32005`.
Complexity and fixed numeric log-span limits are checked before replay where
possible. There is no configurable limit override.

## Methods

| Method | Parameters | Result and behavior |
|---|---|---|
| `web3_clientVersion` | `[]` | Fixed local client/version string. |
| `eth_chainId` | `[]` | `0x7a69` (31337), development-only EVM chain ID. |
| `eth_blockNumber` | `[]` | Verified canonical tip height as a quantity. |
| `eth_getBlockByNumber` | `[blockRef, fullTransactions]` | Canonical block object or `null`. |
| `eth_getBlockByHash` | `[32-byte hash, fullTransactions]` | Canonical block object or `null`; side-chain blocks are not indexed. |
| `eth_getTransactionReceipt` | `[32-byte transactionHash]` | Receipt for a canonical included transaction or `null`. |
| `eth_getCode` | `[address, blockRef]` | Code at the selected canonical state. |
| `eth_getStorageAt` | `[address, storagePosition, blockRef]` | 32-byte storage word at the selected canonical state. |
| `eth_getBalance` | `[address, blockRef]` | Account balance as a quantity. |
| `eth_getTransactionCount` | `[address, blockRef]` | Account nonce as a quantity. |
| `eth_getLogs` | `[filter]` | Canonical logs satisfying the range/address/topic filter. |
| `eth_sendRawTransaction` | `[rawSignedTransaction]` | Opt-in only; validates and admits to the in-memory v0.14 pool. |
| `btcs_dev_mine` | `[]` | Opt-in only; explicitly builds and verifies one local block. |

Block and receipt objects use Ethereum-style field names, minimal quantities,
and hex byte data. The implementation currently admits only type-2
transactions, so full transaction objects describe that local type. Receipt
status, gas accounting, bloom, and logs come from the independently replayed
canonical execution outcomes. These objects do not imply that this chain
implements Ethereum fork choice, consensus, all transaction types, or all
optional JSON-RPC fields and methods.

`eth_sendRawTransaction` and `btcs_dev_mine` are available only when the
server was explicitly started with `--dev-sequencer`; otherwise each returns
`-32601`. They implement the in-memory pool and explicit local production
rules in the v0.14 draft. Submission means pool admission only, not inclusion.
Still not implemented: `eth_call`, persistent pending transactions,
filters/subscriptions, transaction lookup by hash, fee history, automatic
mining/block production, wallet methods, `net_*`, `personal_*`, and
administrative methods.

## Errors

| Code | Meaning |
|---:|---|
| `-32700` | Malformed JSON parse error. |
| `-32600` | Invalid JSON-RPC request, empty/excessive batch, or complexity violation. |
| `-32601` | Method is not implemented. |
| `-32602` | Invalid parameter count, type, encoding, block reference, or filter. |
| `-32603` | Internal error; implementation details and filesystem paths are not exposed. |
| `-32000` | Canonical chain replay/verification failed. |
| `-32005` | Request, log query, response, concurrent-request, or pool limit exceeded. |
| `-32010` | Development pool rejected a transaction. |
| `-32011` | Replacement transaction did not meet the fee bump. |
| `-32012` | Canonical tip changed; pool reconciliation is required. |
| `-32013` | Explicit local block production failed before commit. |

Transport failures use HTTP 403 for an unapproved host/peer, 404 for a path
other than `/`, 405 for a method other than POST, 413 for an oversized body,
415 for a disallowed media type or content encoding, and 503 when four requests
are already in flight. Error messages avoid including paths, environment
variables, private keys, and underlying exception details.

## Planned separately

`eth_call` requires a documented non-committing execution context and block
override policy. Public RPC, authentication, rate limiting, durable pool
storage, network access, decentralized sequencing, rollup proofs, data
availability, and BTCS L1 settlement remain outside this draft.
