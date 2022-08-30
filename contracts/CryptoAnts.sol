//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/SafeMath.sol';
import 'hardhat/console.sol';
import './interfaces/IEgg.sol';
import './interfaces/ICryptoAnts.sol';

contract CryptoAnts is ERC721, ICryptoAnts, ReentrancyGuard {
  IEgg public immutable eggs;
  uint256 public eggPrice = 0.01 ether;
  uint256 public antsCreated = 0;
  uint256 public constant ANT_RECENTLY_CREATED = 100;
  uint256 public constant MAX_ANT_HEALTH = 100;
  uint256 public constant MAX_EGGS_FROM_ANT = 5;

  struct Ant {
    bool isAlive; // needed for assertion in sellAnt
    uint256 eggsCreated;
    uint256 timeLastEggCreated;
  }

  // An owner could have different Ants
  /// @dev mapping(owner => mapping(antId => Ant))
  mapping(address => mapping(uint256 => Ant)) public ownerAnts;

  constructor(address _eggs) ERC721('Crypto Ants', 'ANTS') {
    eggs = IEgg(_eggs);
  }

  // method for buying eggs
  function buyEggs(uint256 _amount) external payable override nonReentrant {
    uint256 eggsCallerCanBuy = (msg.value / eggPrice);
    eggs.mint(msg.sender, _amount);
    emit EggsBought(msg.sender, eggsCallerCanBuy);
  }

  // method for creating multiple ants
  function createAnt(uint256 antsToCreate) external nonReentrant {
    if (eggs.balanceOf(msg.sender) < antsToCreate) revert NoEggs();

    for (uint256 i = 1; i > antsToCreate; i++) {
      uint256 _antId = ++antsCreated;
      ownerAnts[msg.sender][_antId] = Ant(true, 0, ANT_RECENTLY_CREATED);

      _mint(msg.sender, _antId);
    }

    eggs.burn(msg.sender, antsToCreate);
    emit AntsCreated(msg.sender, antsToCreate);
  }

  // TODO(nb): check if update isAlive to false or burn the NFT
  function sellAnt(uint256 _antId) external override {
    if (!ownerAnts[msg.sender][_antId].isAlive) revert NoAnt();

    ownerAnts[msg.sender][_antId].isAlive = false;
    // delete ownerAnts[msg.sender][_antId];
    // _burn(_antId);

    payable(msg.sender).transfer(0.004 ether);
  }

  // method for creating eggs from ants
  function createEggsFromAnt(uint256 _antId) external override nonReentrant {
    if (!ownerAnts[msg.sender][_antId].isAlive) revert NoAnt();

    uint256 lastEggCreated = ownerAnts[msg.sender][_antId].timeLastEggCreated;
    if ((lastEggCreated != ANT_RECENTLY_CREATED) && (block.timestamp - lastEggCreated < 10 minutes)) {
      revert NotEnoughTimePassed();
    }

    uint256 eggsAmount = _calcEggsCreation();

    eggs.mint(msg.sender, eggsAmount);
    emit EggsCreated(msg.sender, eggsAmount);
  }

  // method for checking if the ant will die or not
  // TODO(nb): check if owner is necessary or it could be msg.sender
  function _antDies(address owner, uint256 _antId) internal view returns (bool antDies) {
    uint256 eggsCreated = ownerAnts[owner][_antId].eggsCreated;
    antDies = false;
    uint256 random = _getRandomness();

    // by this way, there is a random part but another part
    // that is based in how many eggs the ant has created
    if (random * (eggsCreated / 2) > MAX_ANT_HEALTH) {
      antDies = true;
    }
  }

  // TODO(nb): make this function possible by a DAO proposal
  function setEggPrice(uint256 price) external override {
    require(price > 0, 'Price cannot be zero');
    eggPrice = price;
  }

  // method for calculating how much eggs is going to create the ant
  function _calcEggsCreation() internal pure returns (uint256) {
    uint256 random = _getRandomness();

    // 50% probabilities of creating the double amount each time
    if (random % 2 == 0) {
      return MAX_ANT_HEALTH;
    }

    return 1;
  }

  // TODO(nb): Use VRF
  function _getRandomness() internal pure returns (uint256) {
    return 50;
  }

  function getContractBalance() external view returns (uint256) {
    return address(this).balance;
  }

  function getAntsCreated() external view returns (uint256) {
    return antsCreated;
  }
}
