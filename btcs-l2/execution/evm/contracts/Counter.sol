// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.37;

contract Counter {
    uint256 public count;

    event Incremented(uint256 value);

    function increment() external {
        count += 1;
        emit Incremented(count);
    }

    function incrementThenRevert() external {
        count += 10;
        emit Incremented(count);
        revert("prototype revert");
    }
}
