# Bitcoin Silver Native Assets (BSNA) Standard Proposal v1.0 (Draft)

Status: **PROPOSED** - Not implemented  
Date: 2026-10-22  
Branch: experimental/deposit-prelude-v1

## 1. Purpose
Define ecosystem-level asset identification, requirements, metadata conventions, compatibility, verification, conformance, and versioning for native assets in the BTCS ecosystem.

## 2. Relationship to Existing Standards
- **ERC-20**: Underlying interface for fungible BSNA tokens (required)
- **ERC-721**: Underlying interface for BSNA NFTs where appropriate (required for NFT type)
- **BSNA**: Standard and recognition layer above, not a replacement
- **EVM Compatibility**: Retained

## 3. Asset Types
- BSNA-Fungible: Based on ERC-20
- BSNA-NonFungible: Based on ERC-721
- BSNA-SemiFungible: Future (ERC-1155) - not in scope now

## 4. Identification
- `bsnaVersion`: Semantic version string (e.g., "1.0")
- `assetType`: "fungible" | "nonfungible"
- Contract address + chain ID + bsnaVersion identify asset

## 5. Required Interface Extensions
```solidity
interface IBSNA {
    function bsnaVersion() external pure returns (string memory);
    function assetType() external pure returns (string memory);
    function bsnaMetadata() external view returns (string memory);
}
```

## 6. Metadata Conventions
JSON metadata with standard fields: name, description, image, external_url, attributes

## 7. Conformance
- Explorer/wallet recognition based on interface detection
- Verification status tracked separately
- Not enforced by L1 consensus
- Conformance claims must be verifiable

## 8. Integration Points
- Token Studio: Add BSNA conformance indicator
- Explorer: Display BSNA badge
- Wallets: Recognition layer
- L1: No consensus changes

## 9. Governance
Versioning, compatibility rules, conformance policies - to be defined
