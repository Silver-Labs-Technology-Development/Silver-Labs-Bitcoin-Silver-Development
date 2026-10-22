// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BsnaMetadataProbe
 * @notice Test-only helper used by the BSNA asset/metadata integration test.
 *
 * @dev The local development JSON-RPC server does not expose `eth_call`, so a
 * read-only contract call cannot be executed from a test. This contract calls
 * the BSNA interface on a deployed asset and stores the results so the test
 * can read them back from storage.
 *
 * The probe declares its own copy of the BSNA interface so that it does not
 * depend on the import graph of the reference contracts. The integration test
 * asserts that the selectors used here match the selectors in the compiled
 * BSNA-20 and BSNA-721 ABIs, so a change to the canonical interface fails the
 * test instead of silently passing.
 *
 * This contract is not part of the BSNA standard. It must not be deployed
 * outside of tests.
 */
interface IBSNAProbeTarget {
    function bsnaVersion() external pure returns (string memory);
    function assetType() external pure returns (string memory);
    function bsnaProfile() external pure returns (string memory);
    function bsnaMetadata() external view returns (string memory);
}

interface IERC721MetadataProbeTarget {
    function tokenURI(uint256 tokenId) external view returns (string memory);
}

contract BsnaMetadataProbe {
    uint256 public metadataLength;
    bytes32 public metadataHash;
    bytes32 public versionHash;
    bytes32 public assetTypeHash;
    bytes32 public profileHash;
    uint256 public tokenUriLength;
    bytes32 public tokenUriHash;

    /// @notice Capture the metadata document URI returned by the asset.
    function captureMetadata(address target) external {
        bytes memory data = bytes(IBSNAProbeTarget(target).bsnaMetadata());
        metadataLength = data.length;
        metadataHash = keccak256(data);
    }

    /// @notice Capture the BSNA identity values returned by the asset.
    function captureIdentity(address target) external {
        versionHash = keccak256(bytes(IBSNAProbeTarget(target).bsnaVersion()));
        assetTypeHash = keccak256(bytes(IBSNAProbeTarget(target).assetType()));
        profileHash = keccak256(bytes(IBSNAProbeTarget(target).bsnaProfile()));
    }

    /// @notice Capture the token URI returned by an ERC-721 asset.
    function captureTokenUri(address target, uint256 tokenId) external {
        bytes memory data = bytes(IERC721MetadataProbeTarget(target).tokenURI(tokenId));
        tokenUriLength = data.length;
        tokenUriHash = keccak256(data);
    }
}
