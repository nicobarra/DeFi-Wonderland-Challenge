//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

/**
 * @dev Required interface of an Egg compliant contract.
 */
interface IEgg is IERC20 {
  /* functions */
  /** @dev Mints an egg 'amount' to 'to' address  */
  function mint(address, uint256) external;

  /** @dev Burns an egg 'amount' from 'from' address  */
  function burn(address, uint256) external;
}
