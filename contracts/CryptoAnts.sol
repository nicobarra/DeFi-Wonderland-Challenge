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
  // event only necessary for knowing that the randomness was requested
  event RandomnessRequested(uint256 requestId);

  // ants and eggs constants
  uint256 public constant ANT_RECENTLY_CREATED = 100;
  uint256 public constant ANTS_PRICE = 0.004 ether;
  uint256 public constant ANT_HEALTH = 100;
  uint256 public constant EGGS_ANT_LAYS = 1;
  uint256 public constant MAX_ANTS_PER_EGG = 1;
  uint256 public constant MIN_LAY_PERIOD = 10 minutes;

  // only for have a recording
  uint256 public antsAlive = 0;
  uint256 private _antIdsCount;

  // this is for managing the vrf randomness when creating a new egg
  address private _ownerRequested;
  uint256 private _requestedAntId;

  // VRF variables
  VRFCoordinatorV2Interface private immutable _vrfCoordinator;
  bytes32 private immutable _keyHash; // gasLane: Max gas price you're willing to pay in wei for a request (in VRF V2)
  uint64 private immutable _subscriptionId; // id of the VRF V2 sub
  uint32 private immutable _callbackGasLimit; // Max gas price you're willing to pay in wei in the VRF V2 callback (fullFillRandomness, the 2nd tx)
  uint16 public constant REQUEST_CONFIRMATIONS = 3;
  uint32 public constant NUM_NUMBERS = 1; // Number of nums that VRF is gonna return

  struct Ant {
    bool isAlive; // needed for assertion in sellAnt
    uint256 eggsCreated; // eggs that the ant layed
    uint256 timeLastEggLayed; // timestamp of the last egg layed
  }

  struct OwnerAnt {
    address ownerAddress;
    uint256 antId;
  }

  /// @notice necessary for _layEgg func execution, since this contract doesn't
  /// executes this function directly, and is the random VRF which does.
  /// By managing this state is possible to exec logic correctly when the randomness arrives
  OwnerAnt[] private _layEggQueue;

  // An owner could have different Ants
  /// @dev mapping(owner => mapping(antId => Ant))
  mapping(address => mapping(uint256 => Ant)) public ownerAnts;

  /// @dev mapping(owner => antId[]))
  mapping(address => uint256[]) public ownerIds;

  // modifier that checks that the inserted address is not the zero address
  modifier notZeroAddress(address tokenAddr) {
    if (tokenAddr == address(0)) revert NoZeroAddress();
    _;
  }

  constructor(
    address _eggs,
    address vrfCoordinatorV2,
    bytes32 keyHash,
    uint64 subscriptionId,
    uint32 callbackGasLimit,
    uint256 _proposalPeriod
  ) ERC721('Crypto Ants', 'ANTS') VRFConsumerBaseV2(vrfCoordinatorV2) notZeroAddress(_eggs) {
    eggs = IEgg(_eggs);
    _vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
    _keyHash = keyHash;
    _subscriptionId = subscriptionId;
    _callbackGasLimit = callbackGasLimit;
    proposalPeriod = _proposalPeriod;
  }

  // method for buying eggs
  function buyEggs() external payable override nonReentrant {
    uint256 eggsSenderCanBuy = (msg.value / eggPrice);

    if (eggsSenderCanBuy < 1) revert NoEggs();

    eggs.mint(msg.sender, eggsSenderCanBuy);
    emit EggsBought(msg.sender, eggsSenderCanBuy);
  }

  // this function keeps the ants created by sender incremental
  function createAnt() external {
    if (eggs.balanceOf(msg.sender) < 1) revert NoEggs();

    _antIdsCount += 1;
    ownerIds[msg.sender].push(_antIdsCount);
    ownerAnts[msg.sender][_antIdsCount] = Ant(true, ZERO_EGGS, ANT_RECENTLY_CREATED);

    _createAnts(_antIdsCount);
    emit AntsCreated(msg.sender, 1);
  }

  function sellAnt(uint256 _antId) external override {
    console.log(1);
    if (!ownerAnts[msg.sender][_antId].isAlive) revert NoAnt();

    console.log(2);
    delete ownerAnts[msg.sender][_antId];
    console.log(3);
    delete ownerIds[msg.sender][_antId - 1]; // this is possible because the ant ids are incremental and equal in both mappings
    console.log(4);
    antsAlive -= 1;
    // _antIdsCount += 1; ??

    console.log('burning...');
    _burn(_antId);
    console.log(1);
    payable(msg.sender).transfer(ANTS_PRICE);
  }

  // method for creating eggs from ants
  function layEggs(uint256 _antId) external override nonReentrant {
    if (!ownerAnts[msg.sender][_antId].isAlive) revert NoAnt();

    uint256 lastEggCreated = ownerAnts[msg.sender][_antId].timeLastEggLayed;
    if ((lastEggCreated != ANT_RECENTLY_CREATED) && (block.timestamp - lastEggCreated < MIN_LAY_PERIOD)) {
      revert NotEnoughTimePassed();
    }

    // set the state for the requested ant to create eggs after receiviing the randomness
    _layEggQueue.push(OwnerAnt(msg.sender, _antId));

    // request randomness
    console.log('requesting...');
    uint256 requestId = _vrfCoordinator.requestRandomWords(_keyHash, _subscriptionId, REQUEST_CONFIRMATIONS, _callbackGasLimit, NUM_NUMBERS);

    emit RandomnessRequested(requestId);
  }

  // method for getting a random number with the VRF
  // once the randomness is received, it will execute the funciton for creating eggs
  // solhint-disable-next-line
  function fulfillRandomWords(
    uint256, /* requestId */
    uint256[] memory randomNumbers
  ) internal override {
    console.log('fulfillRandomWords');

    // transform the random number to a number between 1 and 50 inclusively
    uint256 normalizedRandom = (randomNumbers[0] % 50) + 1;
    _layEggs(normalizedRandom);
  }

  // method with the logic for execute the creating and checking if the ant dies based on the randomness
  function _layEggs(uint256 randomNumber) internal {
    console.log('_layEggs');
    address ownerAddr = _layEggQueue[0].ownerAddress;
    uint256 antId = _layEggQueue[0].antId;

    Ant memory ant = ownerAnts[ownerAddr][antId];
    uint256 eggsAmount = _calcEggsCreation(randomNumber);
    ant.eggsCreated += eggsAmount;

    bool antDies = _antDies(antId, randomNumber);
    if (!antDies) ant.isAlive = false;

    delete _ownerRequested;
    delete _requestedAntId;

    console.log('minting...');
    eggs.mint(ownerAddr, eggsAmount);
    console.log(eggsAmount);

    emit EggsCreated(ownerAddr, eggsAmount);
  }

  // method for checking if the ant will die or not
  function _antDies(uint256 _antId, uint256 randomNumber) internal view returns (bool antDies) {
    uint256 eggsCreated = ownerAnts[msg.sender][_antId].eggsCreated;
    antDies = false;

    // by this way, there is a random part (1, 30) but another part that is based in how many eggs the ant has created
    if (randomNumber * (eggsCreated / 2) > ANT_HEALTH) {
      antDies = true;
    }
  }

  // method for calculating how much eggs is going to create the ant
  function _calcEggsCreation(uint256 randomNumber) internal pure returns (uint256) {
    // 50% probabilities of creating the double amount each time
    if (randomNumber % 2 == 0) {
      return EGGS_ANT_LAYS * 2;
    }

    return EGGS_ANT_LAYS;
  }

  function _createAnts(uint256 id) internal {
    antsAlive += 1;

    _mint(msg.sender, id);
    eggs.burn(msg.sender, MAX_ANTS_PER_EGG);
  }

  /* view functions */

  function getProposalInfo(uint256 proposedPrice) external view returns (ProposalInfo memory) {
    return proposals[proposedPrice];
  }

  function getProposalPrices() external view returns (uint256[] memory) {
    return proposedPrices;
  }

  function getContractBalance() external view returns (uint256) {
    return address(this).balance;
  }

  function getOwnerAntIds(address ownerAddr) external view returns (uint256[] memory) {
    return ownerIds[ownerAddr];
  }

  function getAntById(address ownerAddr, uint256 antId) external view returns (Ant memory) {
    return ownerAnts[ownerAddr][antId];
  }
}
