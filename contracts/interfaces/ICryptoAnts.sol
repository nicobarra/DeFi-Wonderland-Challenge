//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

interface ICryptoAnts is IERC721 {
  // events
  event EggsBought(address indexed owner, uint256 amount);
  event AntsCreated(address indexed owner, uint256 amount);
  event EggsCreated(address indexed owner, uint256 amount);

  // external functions
  function buyEggs() external payable;

  function createAnt() external;

  function sellAnt(uint256) external;

  function layEggs(uint256) external;

  // errors
  error NoEggs();
  error NoAnt();
  error NotAntOwner();
  error NotEnoughTimePassed();
}
