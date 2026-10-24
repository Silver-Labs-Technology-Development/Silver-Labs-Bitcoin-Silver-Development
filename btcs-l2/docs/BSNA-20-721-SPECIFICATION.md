# BSNA-20 and BSNA-721 Specification Proposal v1.0 (Draft)

Status: **DRAFT PROFILE** — reference contracts exist (`contracts/token/BSNA20.sol`, `contracts/token/BSNA721.sol`) and the asset-service metadata integration tests pass. This is not a product release, and it is not BSNA-FTS1. See `docs/BSNA-FTS1-PROPOSAL.md`.
Date: 2026-10-22  
Branch: experimental/deposit-prelude-v1

## 1. Overview
BSNA (Bitcoin Silver Native Assets) defines two profiles built on EVM standards:
- **BSNA-20**: Fungible native assets based on ERC-20
- **BSNA-721**: Non-fungible native assets based on ERC-721

BSNA is a recognition/conformance layer above ERC standards, not a replacement.

## 2. BSNA-20 (Fungible)
### Required
- ERC-20 interface compatibility
- `bsnaVersion()` returns "1.0"
- `assetType()` returns "fungible"
- `bsnaProfile()` returns "BSNA-20"
- `bsnaMetadata()` returns JSON metadata URI/hash

### Requirements
- name, symbol, decimals (standard ERC-20)
- Clear minting policy (fixed supply or authorized minter)
- Optional maxSupply enforcement in contract
- Owner/permissions clearly defined
- Total supply tracking

### Conformance Checks
- Implements ERC-20
- Implements IBSNA interface
- Minting permissions enforced
- Supply caps enforced if declared
- Metadata accessible

## 3. BSNA-721 (Non-Fungible)
### Required
- ERC-721 interface compatibility
- `bsnaVersion()` returns "1.0"
- `assetType()` returns "nonfungible"
- `bsnaProfile()` returns "BSNA-721"
- `bsnaMetadata()` returns collection metadata

### Requirements
- name, symbol (standard ERC-721)
- Token URI for each token
- Minting permissions enforced
- Token ID uniqueness
- Collection metadata
- Optional supply cap

### Conformance Checks
- Implements ERC-721
- Implements IBSNA interface
- Authorization enforced
- Token IDs unique
- URIs accessible
- Metadata structure valid

## 4. Interface
```solidity
interface IBSNA {
    function bsnaVersion() external pure returns (string memory);
    function assetType() external pure returns (string memory);
    function bsnaProfile() external pure returns (string memory);
    function bsnaMetadata() external view returns (string memory);
}
```

## 5. Conformance Status
- `NOT_CHECKED` - Not verified
- `NON_CONFORMANT` - Fails requirements
- `CONFORMANT` - Passes all checks
- `VERIFIED` - Manually verified (future)

ERC compatibility does not imply BSNA conformance.

## 6. Integration
Planned for Silver Forge (Studio, web, Core Qt wallet). No L1 consensus changes.
