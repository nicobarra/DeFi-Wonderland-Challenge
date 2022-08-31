//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/SafeMath.sol';
import '@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol';
import '@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol';
import 'hardhat/console.sol';
import './interfaces/IEgg.sol';
import './interfaces/ICryptoAnts.sol';
import './AntsDAO.sol';

contract CryptoAnts is ERC721, ICryptoAnts, AntsDAO, VRFConsumerBaseV2, ReentrancyGuard {
  uint256 public antsCreated = 0;
  uint256 public antsAlive = 0;
  uint256 public constant ANT_RECENTLY_CREATED = 100;
  uint256 public constant MAX_ANT_HEALTH = 100;
  uint256 public constant MIN_EGGS_FROM_ANT = 1;

  // this is for managing the vrf randomness when creating a new egg
  address private _ownerRequested;
  uint256 private _requestedAntId;

  // VRF variables
  VRFCoordinatorV2Interface private immutable _vrfCoordinator;
  bytes32 private immutable _keyHash; // gasLane: Max gas price you're willing to pay in wei for a request (in VRF V2)
  uint64 private immutable _subscriptionId; // id of the VRF V2 sub
  uint32 private immutable _callbackGasLimit; // Max gas price you're willing to pay in wei in the VRF V2 callback (fullFillRandomness, the 2nd tx)
  uint16 public constant REQUEST_CONFIRMATIONS = 2;
  uint32 public constant NUM_NUMBERS = 1; // Number of nums that VRF is gonna return
  bool private _randomnessUsed;

  struct Ant {
    bool isAlive; // needed for assertion in sellAnt
    uint256 eggsCreated;
    uint256 timeLastEggCreated;
  }

  // An owner could have different Ants
  /// @dev mapping(owner => mapping(antId => Ant))
  mapping(address => mapping(uint256 => Ant)) public ownerAnts;

  modifier notZeroAddress(address tokenAddr) {
    if (tokenAddr == address(0)) revert NoZeroAddress();
    _;
  }

  constructor(
    address _eggs,
    uint256 _proposalPeriod,
    address vrfCoordinatorV2,
    bytes32 keyHash,
    uint64 subscriptionId,
    uint32 callbackGasLimit
  ) ERC721('Crypto Ants', 'ANTS') VRFConsumerBaseV2(vrfCoordinatorV2) notZeroAddress(_eggs) {
    eggs = IEgg(_eggs);
    proposalPeriod = _proposalPeriod;
    _vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
    _keyHash = keyHash;
    _subscriptionId = subscriptionId;
    _callbackGasLimit = callbackGasLimit;
  }

  // method for buying eggs
  function buyEggs() external payable override nonReentrant {
    uint256 eggsCallerCanBuy = (msg.value / eggPrice);

    if (eggsCallerCanBuy < 1) revert NoEggs();

    eggs.mint(msg.sender, eggsCallerCanBuy);
    emit EggsBought(msg.sender, eggsCallerCanBuy);
  }

  // method for creating multiple ants
  function createAnt(uint256 antsToCreate) external nonReentrant {
    if (eggs.balanceOf(msg.sender) < antsToCreate) revert NoEggs();

    // maybe seems costly but is easier for the user to mint multiple ants by this way
    for (uint256 i = 1; i > antsToCreate; i++) {
      uint256 antId = ++antsCreated;
      ownerAnts[msg.sender][antId] = Ant(true, 0, ANT_RECENTLY_CREATED);

      _createAnts(antId);
    }

    eggs.burn(msg.sender, antsToCreate);
    emit AntsCreated(msg.sender, antsToCreate);
  }

  function sellAnt(uint256 _antId) external override {
    if (!ownerAnts[msg.sender][_antId].isAlive) revert NoAnt();

    delete ownerAnts[msg.sender][_antId];
    antsAlive -= 1;

    payable(msg.sender).transfer(0.004 ether);
  }

  // method for creating eggs from ants
  function createEggsFromAnt(uint256 _antId) external override nonReentrant {
    if (!ownerAnts[msg.sender][_antId].isAlive) revert NoAnt();

    uint256 lastEggCreated = ownerAnts[msg.sender][_antId].timeLastEggCreated;
    if ((lastEggCreated != ANT_RECENTLY_CREATED) && (block.timestamp - lastEggCreated < 10 minutes)) {
      revert NotEnoughTimePassed();
    }

    // set the state for the requested ant to create eggs after receiviing the randomness
    _ownerRequested = msg.sender;
    _requestedAntId = _antId;

    // request randomness
    _vrfCoordinator.requestRandomWords(_keyHash, _subscriptionId, REQUEST_CONFIRMATIONS, _callbackGasLimit, NUM_NUMBERS);
  }

  // method for getting a random number with the VRF
  // once the randomness is received, it will execute the funciton for creating eggs
  // solhint-disable-next-line
  function fulfillRandomWords(
    uint256, /* requestId */
    uint256[] memory randomNumbers
  ) internal override {
    // transform the random number result to a number between 1 and 30 inclusively
    uint256 normalizedRandom = (randomNumbers[0] % 30) + 1;
    _createEggsFromAnt(_ownerRequested, _requestedAntId, normalizedRandom);
  }

  // method with the logic for execute the creating and checking if the ant dies based on the randomness
  function _createEggsFromAnt(
    address ownerAddr,
    uint256 antId,
    uint256 randomNumber
  ) internal {
    Ant memory ant = ownerAnts[ownerAddr][antId];
    uint256 eggsAmount = _calcEggsCreation(randomNumber);
    ant.eggsCreated += eggsAmount;

    bool antDies = _antDies(antId, randomNumber);
    if (!antDies) ant.isAlive = false;

    delete _ownerRequested;
    delete _requestedAntId;

    eggs.mint(msg.sender, eggsAmount);
    emit EggsCreated(msg.sender, eggsAmount);
  }

  // method for checking if the ant will die or not
  function _antDies(uint256 _antId, uint256 randomNumber) internal view returns (bool antDies) {
    uint256 eggsCreated = ownerAnts[msg.sender][_antId].eggsCreated;
    antDies = false;

    // by this way, there is a random part (1, 30) but another part that is based in how many eggs the ant has created
    if (randomNumber * (eggsCreated / 2) > MAX_ANT_HEALTH) {
      antDies = true;
    }
  }

  // method for calculating how much eggs is going to create the ant
  function _calcEggsCreation(uint256 randomNumber) internal pure returns (uint256) {
    // 50% probabilities of creating the double amount each time
    if (randomNumber % 2 == 0) {
      return MIN_EGGS_FROM_ANT * 2;
    }

    return MIN_EGGS_FROM_ANT;
  }

  function _createAnts(uint256 id) internal {
    antsCreated += 1;
    antsAlive += 1;

    _mint(msg.sender, id);
  }

  function getContractBalance() external view returns (uint256) {
    return address(this).balance;
  }

  function getAntsCreated() external view returns (uint256) {
    return antsCreated;
  }
}
