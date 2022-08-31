//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

interface IEgg is IERC20 {
  function mint(address, uint256) external;

  function burn(address, uint256) external;

  error OnlyAnts(address ants, address badSender);
  error NoZeroAddress();
}
