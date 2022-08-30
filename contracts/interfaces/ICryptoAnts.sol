//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

interface ICryptoAnts is IERC721 {
  // events
  event EggsBought(address indexed owner, uint256 amount);
  event AntsCreated(address indexed owner, uint256 amount);
  event EggsCreated(address indexed owner, uint256 amount);

  // external functions
  function buyEggs(uint256) external payable;

  function createEggsFromAnt(uint256) external;

  function sellAnt(uint256) external;

  function setEggPrice(uint256) external;

  // errors
  error NoEggs();
  error NoAnt();
  error NoZeroAddress();
  error NotEnoughTimePassed();
  error AlreadyExists();
  error WrongEtherSent();
}
