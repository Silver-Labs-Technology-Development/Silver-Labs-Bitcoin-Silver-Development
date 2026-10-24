// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

/// Shared ERC-20 / BEP-20 interface template.
///
/// The selectors match the common fungible-token interface. A deployment on one
/// network is a separate asset from a deployment of this same bytecode on
/// another network. This contract does not bridge, lock, or mint remote supply.
/// It is not BSNA-20 and it is not SimpleERC20.
contract EvmFungibleAsset {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InvalidOwner();
    error InvalidReceiver();
    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(
        string memory tokenName,
        string memory tokenSymbol,
        uint8 tokenDecimals,
        uint256 atomicSupply,
        address initialOwner
    ) {
        if (initialOwner == address(0)) revert InvalidOwner();
        require(bytes(tokenName).length > 0, "name");
        require(bytes(tokenSymbol).length > 0, "symbol");
        name = tokenName;
        symbol = tokenSymbol;
        decimals = tokenDecimals;
        owner = initialOwner;
        totalSupply = atomicSupply;
        balanceOf[initialOwner] = atomicSupply;
        emit Transfer(address(0), initialOwner, atomicSupply);
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed < value) revert InsufficientAllowance();
        allowance[from][msg.sender] = allowed - value;
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert InvalidReceiver();
        uint256 fromBalance = balanceOf[from];
        if (fromBalance < value) revert InsufficientBalance();
        uint256 toBalance = balanceOf[to];
        balanceOf[from] = fromBalance - value;
        balanceOf[to] = toBalance + value;
        emit Transfer(from, to, value);
    }
}
