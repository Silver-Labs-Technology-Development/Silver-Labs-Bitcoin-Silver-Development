// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IBSNA {
    function bsnaVersion() external pure returns (string memory);
    function assetType() external pure returns (string memory);
    function bsnaProfile() external pure returns (string memory);
    function bsnaMetadata() external view returns (string memory);
}

contract BSNA721 is ERC721, ERC721URIStorage, Ownable, IBSNA {
    uint256 private _nextTokenId;
    string private _collectionMetadata;
    
    constructor(
        string memory name,
        string memory symbol,
        string memory metadataUri,
        address initialOwner
    ) ERC721(name, symbol) Ownable(initialOwner) {
        _collectionMetadata = metadataUri;
    }
    
    function bsnaVersion() external pure override returns (string memory) {
        return "1.0";
    }
    
    function assetType() external pure override returns (string memory) {
        return "nonfungible";
    }
    
    function bsnaProfile() external pure override returns (string memory) {
        return "BSNA-721";
    }
    
    function bsnaMetadata() external view override returns (string memory) {
        return _collectionMetadata;
    }
    
    function safeMint(address to, string memory uri) public onlyOwner {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
    }
    
    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }
    
    function supportsInterface(bytes4 interfaceId) public view override(ERC721, ERC721URIStorage) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
