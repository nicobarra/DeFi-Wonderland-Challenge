//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC721/IERC721.sol';

/**
 * @dev Required interface of a CryptoAnt compliant contract.
 */
interface ICryptoAnts is IERC721 {
  /* events */
  /// @dev Emitted when an egg is minted to 'owner' for some ETH 'amount'
  event EggsBought(address indexed owner, uint256 amount);

  /// @dev Emitted when an ERC721 ant with its 'antId' is minted to 'owner' for some ETH amount
  event AntsCreated(address indexed owner, uint256 antId);

  /// @dev Emitted when an 'amount' of eggs is layed from ant, to the 'owner'
  event EggsLayed(address indexed owner, uint256 amount);

  /// @dev Emmited when an ant is sold from 'owner' with the burned 'antId'
  event AntSold(address indexed owner, uint256 antId);

  /* functions */
  /**  @dev Mints an egg to the msg.sender
   * Requirements:
   * - 'msg.sender' must have enough ETH for at least buying one egg
   */
  function buyEggs() external payable;

  /** @dev Creates a single ant from a single egg
   * Requirements:
   * - 'msg.sender' must have at least one egg
   */
  function createAnt() external;

  /** @dev Burns ant from 'from' identified by the 'antId' of it
   * Requirements:
   * - ant owner must be 'msg.sender'
   * - ant must exists and ant.isAlive must be equal true
   */
  function sellAnt(uint256) external;

  /** @dev Lays eggs from an ant identified by the 'antId'
   * Requirements:
   * - ant owner must be 'msg.sender'
   * - ant must exists and ant.isAlive must be equal true
   */
  function layEggs(uint256) external;

  /* errors */
  /// @dev Error when 'msg.sender' egg balance is less than one
  error NoEggs();
  /// @dev Error when ant does not exists or is it not alive
  error NoAnt();
  /// @dev Error when the 'msg.sender' of the passed ant is not the 'ant.owner'
  error NotAntOwner();
  /// @dev Error when the 'MIN_LAY_PERIOD' to the ant for lay an egg again did not pass
  error NotEnoughTimePassed();
}
