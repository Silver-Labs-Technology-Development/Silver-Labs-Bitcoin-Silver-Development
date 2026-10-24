// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SimpleERC20 is ERC20, Ownable {
    uint256 public maxSupply;
    
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        uint256 _maxSupply,
        address initialOwner
    ) ERC20(name, symbol) Ownable(initialOwner) {
        if (initialSupply > 0) {
            _mint(initialOwner, initialSupply * 10 ** decimals());
        }
        maxSupply = _maxSupply * 10 ** decimals();
    }
    
    function mint(address to, uint256 amount) public onlyOwner {
        uint256 amountWithDecimals = amount * 10 ** decimals();
        if (maxSupply > 0) {
            require(totalSupply() + amountWithDecimals <= maxSupply, "Exceeds max supply");
        }
        _mint(to, amountWithDecimals);
    }
}
