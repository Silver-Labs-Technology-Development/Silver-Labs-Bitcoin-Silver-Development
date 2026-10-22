# BSNA Asset Upload API v1.0 (Draft)

Status: **PROPOSED** - Implemented for local development  
Date: 2026-10-22  
Branch: experimental/deposit-prelude-v1  
Service: `services/asset-service` (Node.js, zero runtime dependencies)

## 1. Overview

The asset service accepts an image, stores it, and produces a BSNA metadata
document that points at the stored image. The metadata URI returned by the
service is the value that is written into a BSNA contract:

| Asset kind              | Contract target                                   | Contract call        |
| ----------------------- | ------------------------------------------------- | -------------------- |
| `bsna20-logo`           | `BSNA20` constructor `metadataUri`                | `bsnaMetadata()`     |
| `bsna721-collection-image` | `BSNA721` constructor `metadataUri`             | `bsnaMetadata()`     |
| `bsna721-token-image`   | `BSNA721.safeMint(to, uri)`                       | `tokenURI(tokenId)`  |

The service never deploys or mutates a contract. It produces the metadata URI
and the metadata document; the caller decides where the URI is written.

### 1.1 ERC-20 logo clarification

ERC-20 defines no metadata and no logo field. A BSNA-20 logo is carried by the
BSNA metadata document that the contract exposes through `bsnaMetadata()`. The
service therefore produces a full BSNA metadata document for
`bsna20-logo` uploads, not a bare image URI, and the image itself is referenced
by the document's `image` field.

## 2. Running the service

```bash
cd services/asset-service
npm install
npm start          # listens on 127.0.0.1:8787 by default
```

Node.js 24.17.x is required (`engines` in `package.json`). The service binds to
the loopback interface by default; it is a development component and is not
designed to be exposed directly to the public internet.

### 2.1 Verification commands

```bash
npm run typecheck      # tsc --noEmit
npm test               # unit and HTTP tests (tests/*.test.ts)
npm run test:contracts # contract integration tests (tests/contract/*.test.ts)
```

`npm run test:contracts` compiles `contracts/token/BSNA20.sol` and
`contracts/token/BSNA721.sol` with `solc` and deploys them on the local
development chain. It requires `execution/evm/node_modules` to be installed,
because the test reuses the local chain harness from that package.

## 3. HTTP API

All responses are JSON. Successful responses carry `"ok": true`, failures carry
`"ok": false` and a structured `error` object.

| Method | Path                              | Purpose                                   |
| ------ | --------------------------------- | ----------------------------------------- |
| `POST` | `/api/assets/images`              | Upload an image, get the metadata URI     |
| `GET`  | `/api/assets/images/limits`       | Limits, accepted kinds and formats        |
| `GET`  | `/assets/objects/<digest>.<ext>`  | Stored object (local provider only)       |
| `GET`  | `/healthz`                        | Deployment status                         |
| `OPTIONS` | any route                      | CORS preflight                            |

### 3.1 `POST /api/assets/images`

Request: `multipart/form-data`. Exactly one file part is allowed.

| Part      | Field name | Required | Description                                                        |
| --------- | ---------- | -------- | ------------------------------------------------------------------ |
| File      | `image`    | yes      | The image bytes. `file` is accepted as an alias.                   |
| Text      | `assetKind`| yes      | `bsna20-logo`, `bsna721-collection-image` or `bsna721-token-image`. |
| Text      | `bsnaProfile` | no     | `BSNA-20` or `BSNA-721`. When present it must agree with `assetKind`. |
| Text      | `bsnaVersion` | no     | Semantic version such as `1.0`. Defaults to `1.0`.                 |
| Text      | `name`     | no       | Asset name. 1 to 200 characters. Defaults to a kind specific name. |
| Text      | `description` | no    | Free text, up to 2000 characters. Defaults to an empty string.    |
| Text      | `externalUrl` | no     | Absolute `http`/`https` URL used for the `external_url` field.     |
| Text      | `chainId`  | no       | EVM chain id of the asset.                                         |
| Text      | `contractAddress` | no    | 20 byte hex address of the asset.                                  |
| Text      | `tokenId`  | no       | Decimal token id, relevant for `bsna721-token-image`.              |
| Text      | `attributes` | no     | JSON array of `{"trait_type": "...", "value": "..."}` objects.      |

A contradictory `bsnaProfile` is rejected rather than silently corrected.

Response `200`:

```json
{
  "ok": true,
  "imageUri": "http://127.0.0.1:8787/assets/objects/<sha256>.png",
  "contentHash": "sha256:<64 hex characters>",
  "mimeType": "image/png",
  "sizeBytes": 1234,
  "storageProvider": "local-dev",
  "durability": "local-only",
  "portable": false,
  "width": 512,
  "height": 512,
  "format": "png",
  "metadataUri": "http://127.0.0.1:8787/assets/objects/<sha256>.json",
  "metadataContentHash": "sha256:<64 hex characters>",
  "metadataStorageProvider": "local-dev",
  "metadataDurability": "local-only",
  "metadataPortable": false,
  "metadata": {
    "name": "Silver Forge Token",
    "description": "...",
    "image": "http://127.0.0.1:8787/assets/objects/<sha256>.png",
    "external_url": "",
    "attributes": [
      { "trait_type": "BSNA Profile", "value": "BSNA-20" },
      { "trait_type": "BSNA Version", "value": "1.0" },
      { "trait_type": "Asset Type", "value": "fungible" }
    ]
  },
  "bsnaProfile": "BSNA-20",
  "assetType": "fungible",
  "metadataTarget": "bsna20-metadata-uri",
  "warnings": ["The image URI is local-only. ..."]
}
```

The `metadata` field is the BSNA metadata document. The stored document is
byte identical to it: the service serializes the document to canonical JSON
(sorted keys, compact separators) before hashing and storing it, so
`metadataContentHash` always matches the bytes behind `metadataUri`.

### 3.2 `GET /api/assets/images/limits`

```json
{
  "ok": true,
  "limits": {
    "maxFileBytes": 5242880,
    "maxRequestBytes": 8388608,
    "maxImageWidth": 4096,
    "maxImageHeight": 4096,
    "maxImagePixels": 16777216
  },
  "supportedAssetKinds": ["bsna20-logo", "bsna721-collection-image", "bsna721-token-image"],
  "supportedImageFormats": ["png", "jpeg", "gif", "webp"],
  "storageProvider": "local-dev",
  "storageDurability": "local-only"
}
```

### 3.3 `GET /healthz`

Returns `200` with `"status": "ready"` when a storage provider is configured,
and `503` with `"status": "storage-not-configured"` and a `reason` otherwise.
No credential is ever included in the response.

### 3.4 Error codes

Failures use the shape:

```json
{
  "ok": false,
  "error": {
    "code": "file-too-large",
    "message": "the uploaded image is 7340032 bytes which exceeds the 5242880 byte limit",
    "details": { "sizeBytes": 7340032, "maxFileBytes": 5242880 }
  }
}
```

| Code                        | HTTP | Meaning                                                    |
| --------------------------- | ---- | ---------------------------------------------------------- |
| `invalid-request`           | 400  | A field is malformed or contradicts another field.          |
| `missing-file`              | 400  | The multipart body contains no image part.                  |
| `method-not-allowed`        | 405  | Wrong HTTP method for the route.                            |
| `not-found`                 | 404  | Unknown route or unknown stored object.                     |
| `unsupported-media-type`    | 415  | The body was not `multipart/form-data`.                     |
| `unsupported-image-format`  | 415  | The detected format is not PNG, JPEG, GIF or WebP.           |
| `content-type-mismatch`     | 415  | The browser declared MIME type contradicts the file bytes.  |
| `file-too-large`            | 413  | The image exceeded `ASSET_MAX_FILE_BYTES`.                  |
| `payload-too-large`         | 413  | The request body exceeded `ASSET_MAX_REQUEST_BYTES`.        |
| `invalid-image`             | 422  | The bytes are not a structurally valid image.               |
| `dimensions-out-of-range`   | 422  | The image dimensions exceed the configured bounds.          |
| `storage-failure`           | 502  | The storage provider could not persist the object.          |
| `storage-verification-failed` | 502 | The stored bytes could not be verified against the upload.  |
| `storage-not-configured`    | 503  | The deployment has no usable storage provider.              |
| `internal-error`            | 500  | Unexpected failure.                                         |

## 4. Validation rules

The format is always detected from the file bytes, never from the request
headers or the file name.

| Format | Detection and validation                                                                     |
| ------ | -------------------------------------------------------------------------------------------- |
| PNG    | 8 byte signature, chunk walk with CRC verification per chunk, `IHDR` first, `IEND` last, no trailing bytes, at least one image data chunk. |
| JPEG   | `SOI` marker, marker stream walk with segment length validation, start-of-frame header required, end-of-image marker required. |
| GIF    | `GIF87a`/`GIF89a` header, logical screen descriptor, trailer byte.                            |
| WebP   | `RIFF` container, `WEBP` form type, RIFF size must match the file length, dimension bearing chunk (`VP8X`, `VP8 ` or `VP8L`) required. |

Honest limitation: validation is **structural and header level**. The service
walks the container structure and verifies the header checksums, but it does not
decode the compressed pixel data. A file with a valid container and a corrupt
image payload is accepted. SVG is deliberately not supported: it is an active
document format, not a raster image format.

The declared browser MIME type is compared against the detected format and a
contradiction is rejected with `content-type-mismatch`. The declared type is
never used to decide the format.

## 5. BSNA metadata document

The generated document contains exactly the field set declared by
`docs/BSNA-STANDARD-PROPOSAL.md` section 6 and nothing else:

```json
{
  "name": "...",
  "description": "...",
  "image": "<uri of the stored image>",
  "external_url": "...",
  "attributes": [{ "trait_type": "...", "value": "..." }]
}
```

Caller supplied `attributes` are emitted first, followed by the service derived
attributes:

| Attribute                | Value                                                     |
| ------------------------ | --------------------------------------------------------- |
| `BSNA Profile`           | `BSNA-20` or `BSNA-721`.                                   |
| `BSNA Version`           | The `bsnaVersion` value, `1.0` by default.                 |
| `Asset Type`             | `fungible` or `nonfungible`, matching `assetType()`.       |
| `Chain ID`               | Only when `chainId` was supplied.                          |
| `Contract Address`       | Only when `contractAddress` was supplied.                  |
| `Token ID`               | Only when `tokenId` was supplied.                          |
| `Image Content Hash`     | `sha256:<hex>` of the image bytes.                         |
| `Image Media Type`       | The detected MIME type.                                     |
| `Image Dimensions`       | `<width>x<height>`.                                         |

`bsnaProfile`, `assetType` and `bsnaVersion` in the attribute list mirror the
values the BSNA contracts return from `bsnaProfile()`, `assetType()` and
`bsnaVersion()`.

## 6. Storage and durability

| Provider   | `storageProvider` | `durability` | `portable` | URI shape                                    |
| ---------- | ----------------- | ------------ | ---------- | -------------------------------------------- |
| `local-dev` | `local-dev`      | `local-only` | `false`    | `http://<host>:<port>/assets/objects/<sha256>.<ext>` |
| `ipfs`      | `ipfs`           | `durable`    | `true`     | `ipfs://<cid>`                                  |

A `local-only` URI resolves only on the machine that produced it, only while
the object store directory still exists, and nowhere else. It must never be
presented to a user as durable or as portable to another machine. Every
`local-only` response therefore carries an explicit `warnings` entry.

The IPFS provider only reports `durable` after three positive checks:

1. the returned CID addresses the same SHA-256 digest as the uploaded bytes,
2. when pinning is enabled, the object is present in the pin list
   (`/api/v0/pin/ls`),
3. a `cat` round trip returns exactly the uploaded bytes.

If any check fails the upload fails with `storage-verification-failed` and the
service does not return a URI.

## 7. Configuration

All configuration is read from the process environment. Credentials are read on
the server only, are never returned to the browser and are never written to
disk.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `ASSET_HOST` | `127.0.0.1` | Listen address. |
| `ASSET_PORT` | `8787` | Listen port. |
| `ASSET_MAX_FILE_BYTES` | `5242880` (5 MiB) | Maximum image size. |
| `ASSET_MAX_REQUEST_BYTES` | `8388608` (8 MiB) | Maximum request body size. |
| `ASSET_MAX_IMAGE_WIDTH` | `4096` | Maximum image width in pixels. |
| `ASSET_MAX_IMAGE_HEIGHT` | `4096` | Maximum image height in pixels. |
| `ASSET_MAX_IMAGE_PIXELS` | `16777216` | Maximum pixel count. |
| `ASSET_ALLOWED_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma separated CORS allow list. |
| `ASSET_STORAGE_PROVIDER` | `local-dev` | `local-dev` or `ipfs`. |
| `ASSET_STORAGE_DATA_DIR` | `./.asset-store` | Local object store directory. |
| `ASSET_STORAGE_PUBLIC_BASE_URL` | the listen address | Base URL used for local object URIs. |
| `ASSET_IPFS_API_URL` | - | Kubo RPC endpoint, required for `ipfs`. |
| `ASSET_IPFS_GATEWAY_URL` | - | Gateway used to build gateway URIs. |
| `ASSET_IPFS_AUTH_TOKEN` | - | Bearer token for the IPFS API. |
| `ASSET_IPFS_USERNAME` / `ASSET_IPFS_PASSWORD` | - | Basic auth credentials for the IPFS API. |
| `ASSET_IPFS_PIN` | `true` | Pin the uploaded object. |
| `ASSET_IPFS_TIMEOUT_MS` | `15000` | Per request timeout for the IPFS API. |

CORS: only requests whose `Origin` is in `ASSET_ALLOWED_ORIGINS` receive an
`Access-Control-Allow-Origin` header. The preflight response allows `GET`,
`POST`, `OPTIONS` and the `Content-Type` header.

## 8. Studio integration

The Studio dev server proxies `/rpc` to the local chain. The asset API needs one
more proxy entry. In `studio/vite.config.js`:

```js
server: {
  port: 3000,
  proxy: {
    '/rpc': {
      target: 'http://127.0.0.1:8545',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/rpc/, '')
    },
    '/api': {
      target: 'http://127.0.0.1:8787',
      changeOrigin: true
    }
  }
}
```

The `/api` proxy must not rewrite the path: the asset service serves
`/api/assets/images` and `/api/assets/images/limits` under that prefix.

With that proxy in place the Studio calls the service through the same origin
as the rest of the application, so no CORS exception is needed:

```js
const form = new FormData()
form.append('image', file)
form.append('assetKind', 'bsna20-logo')
form.append('name', 'Silver Forge Token')

const response = await fetch('/api/assets/images', { method: 'POST', body: form })
const result = await response.json()
if (!result.ok) throw new Error(result.error.message)

// result.metadataUri is the value to pass to the BSNA20 constructor.
```

The Studio should read the accepted kinds, formats and limits from
`GET /api/assets/images/limits` instead of hard coding them.

## 9. Contract integration

The service produces the metadata URI. Writing it into a contract is the
caller's job:

```solidity
// BSNA-20: the constructor stores the URI, bsnaMetadata() returns it.
BSNA20 token = new BSNA20(name, symbol, initialSupply, maxSupply, metadataUri, owner);

// BSNA-721 collection metadata.
BSNA721 collection = new BSNA721(name, symbol, collectionMetadataUri, owner);

// BSNA-721 token metadata.
collection.safeMint(recipient, tokenMetadataUri);
```

### 9.1 Verification without `eth_call`

The local development JSON-RPC server does not implement `eth_call`, so the
integration test cannot read a contract function directly. The test deploys a
small probe contract, `contracts/test/BsnaMetadataProbe.sol`, that calls the BSNA
interface on the deployed asset and stores the result, and then reads the probe
storage with `eth_getStorageAt`. The probe is a test artifact; it is not part of
the BSNA standard and must not be deployed outside of tests.

`npm run test:contracts` asserts that:

- `bsnaMetadata()` on a deployed `BSNA20` returns exactly the `metadataUri` the
  service produced, and the same for a `BSNA721` collection,
- `tokenURI(0)` on a `BSNA721` returns exactly the token metadata URI passed to
  `safeMint`,
- `bsnaVersion()`, `assetType()` and `bsnaProfile()` return `1.0`, `fungible` /
  `nonfungible` and `BSNA-20` / `BSNA-721`,
- the stored metadata document contains only the five BSNA fields,
- the BSNA interface selectors in the reference contracts are the canonical
  ones.

## 10. Known limitations

1. The local development object store is single host and not durable. Use the
   IPFS provider, or a real object store, for anything that must survive a
   machine restart.
2. Pixel data is not decoded. A structurally valid container with a corrupt
   image payload is accepted.
3. Animated images are accepted as a single frame; no animation frame is
   inspected and no animation is rewritten.
4. The service does not deploy contracts, does not sign transactions and does
   not verify that a contract actually stores the URI it is handed.
5. The service performs no content moderation and no malware scanning. It
   accepts any structurally valid image of an accepted format.
