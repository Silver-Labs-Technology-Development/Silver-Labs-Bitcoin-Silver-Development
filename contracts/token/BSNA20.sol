// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IBSNA {
    function bsnaVersion() external pure returns (string memory);
    function assetType() external pure returns (string memory);
    function bsnaProfile() external pure returns (string memory);
    function bsnaMetadata() external view returns (string memory);
}

contract BSNA20 is ERC20, Ownable, IBSNA {
    uint256 public maxSupply;
    string private _bsnaMetadata;
    
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        uint256 _maxSupply,
        string memory metadataUri,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        _bsnaMetadata = metadataUri;
        if (initialSupply > 0) {
            _mint(initialOwner, initialSupply * 10 ** decimals());
        }
        maxSupply = _maxSupply * 10 ** decimals();
    }
    
    function bsnaVersion() external pure override returns (string memory) {
        return "1.0";
    }
    
    function assetType() external pure override returns (string memory) {
        return "fungible";
    }
    
    function bsnaProfile() external pure override returns (string memory) {
        return "BSNA-20";
    }
    
    function bsnaMetadata() external view override returns (string memory) {
        return _bsnaMetadata;
    }
    
    function mint(address to, uint256 amount) public onlyOwner {
        uint256 amountWithDecimals = amount * 10 ** decimals();
        if (maxSupply > 0) {
            require(totalSupply() + amountWithDecimals <= maxSupply, "Exceeds max supply");
        }
        _mint(to, amountWithDecimals);
    }
}
