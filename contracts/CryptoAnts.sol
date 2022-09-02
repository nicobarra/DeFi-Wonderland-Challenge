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
  bool public constant ANT_IS_ALIVE = true;

  // only for have a recording
  uint256 public antsAlive = 0;
  uint256 private _antIdsCounter;
  uint256 private _lastEggLayed;

  // VRF variables
  VRFCoordinatorV2Interface private immutable _vrfCoordinator;
  bytes32 private immutable _keyHash; // gasLane: Max gas price you're willing to pay in wei for a request (in VRF V2)
  uint64 private immutable _subscriptionId; // id of the VRF V2 sub
  uint32 private immutable _callbackGasLimit; // Max gas price you're willing to pay in wei in the VRF V2 callback (fullFillRandomness, the 2nd tx)
  uint16 public constant REQUEST_CONFIRMATIONS = 3;
  uint32 public constant NUM_NUMBERS = 1; // Number of nums that VRF is gonna return

  struct Ant {
    address owner;
    uint256 ownerCounter; // number of ant that owner has
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
  uint256[] private _layEggQueue;

  // An owner could have different Ants
  /// @dev mapping(owner => mapping(antId => Ant))
  mapping(uint256 => Ant) public ownerAnts;

  /// @dev mapping(owner => antId[]))
  mapping(address => uint256[]) public ownerIds;

  modifier checkAntOwner(uint256 antId) {
    if (ownerAnts[antId].owner != msg.sender) revert NotAntOwner();
    _;
  }

  constructor(
    address _eggs,
    address vrfCoordinatorV2,
    bytes32 keyHash,
    uint64 subscriptionId,
    uint32 callbackGasLimit,
    uint256 _proposalPeriod
  ) ERC721('Crypto Ants', 'ANTS') VRFConsumerBaseV2(vrfCoordinatorV2) {
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
  function createAnt() external override {
    if (eggs.balanceOf(msg.sender) < 1) revert NoEggs();

    _antIdsCounter += 1;
    uint256 antIdx = ownerIds[msg.sender].length;
    ownerAnts[_antIdsCounter] = Ant(msg.sender, antIdx, ANT_IS_ALIVE, ZERO_EGGS, ANT_RECENTLY_CREATED);
    ownerIds[msg.sender].push(_antIdsCounter);

    _createAnts(_antIdsCounter);
    emit AntsCreated(msg.sender, _antIdsCounter);
  }

  function sellAnt(uint256 _antId) external override checkAntOwner(_antId) {
    console.log('_antId', _antId);
    if (!ownerAnts[_antId].isAlive) revert NoAnt();

    uint256 idxToDel = ownerAnts[_antId].ownerCounter;
    delete ownerIds[msg.sender][idxToDel]; // this is possible because the ant ids are incremental and equal in both mappings
    delete ownerAnts[_antId];
    antsAlive -= 1;

    _burn(_antId);

    console.log('ownerAnts[_antId]', ownerAnts[_antId].owner);
    console.log('ownerAnts[_antId + 1]', ownerAnts[_antId + 1].owner);

    payable(msg.sender).transfer(ANTS_PRICE);
  }

  // method for creating eggs from ants
  function layEggs(uint256 _antId) external override nonReentrant checkAntOwner(_antId) {
    if (!ownerAnts[_antId].isAlive) revert NoAnt();

    uint256 lastEggCreated = ownerAnts[_antId].timeLastEggLayed;
    console.log('lastEggCreated', lastEggCreated);
    console.log('block.timestamp', block.timestamp);
    console.log('MIN_LAY_PERIOD', MIN_LAY_PERIOD);

    if ((lastEggCreated != ANT_RECENTLY_CREATED) && (block.timestamp - lastEggCreated < MIN_LAY_PERIOD)) {
      revert NotEnoughTimePassed();
    }

    // set the state for the requested ant to create eggs after receiviing the randomness
    _layEggQueue.push(_antId);
    console.log(_layEggQueue[0]);
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

    // transform the random number to a number between 1 and 30 inclusively
    uint256 normalizedRandom = (randomNumbers[0] % 30) + 1;
    _layEggs(normalizedRandom);
  }

  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId
  ) internal override {
    if (from == address(0) || to == address(0)) return;
    // delete the previous owner info
    uint256 prevOwnerId = ownerAnts[tokenId].ownerCounter;
    console.log('prevOwnerId', prevOwnerId);
    delete ownerIds[from][prevOwnerId];

    // update the info for the new owner that receives the NFT
    uint256 antIdxTo = ownerIds[to].length + 1;
    ownerAnts[_antIdsCounter].owner = to;
    ownerAnts[_antIdsCounter].ownerCounter = antIdxTo;
  }

  // method with the logic for execute the creating and checking if the ant dies based on the randomness
  function _layEggs(uint256 randomNumber) internal {
    console.log('_layEggs');
    uint256 antId = _layEggQueue[_lastEggLayed];

    uint256 eggsAmount = _calcEggsCreation(randomNumber);
    ownerAnts[antId].eggsCreated += eggsAmount;
    ownerAnts[antId].timeLastEggLayed = block.timestamp;

    console.log('antId.timeLastEggLayed', ownerAnts[antId].timeLastEggLayed);

    bool antDies = _antDies(antId, randomNumber);
    if (antDies) ownerAnts[antId].isAlive = false;

    _lastEggLayed = _layEggQueue.length;

    console.log('minting...', eggsAmount);
    eggs.mint(ownerAnts[antId].owner, eggsAmount);

    emit EggsCreated(ownerAnts[antId].owner, eggsAmount);
  }

  // method for checking if the ant will die or not
  function _antDies(uint256 _antId, uint256 randomNumber) internal view returns (bool antDies) {
    uint256 eggsCreated = ownerAnts[_antId].eggsCreated;
    antDies = false;

    // by this way, there is a random part (1, 30) but another part that is based in how many eggs the ant has created
    console.log('math', (randomNumber * (eggsCreated / 2) > ANT_HEALTH));
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

  function getAntInfo(uint256 antId) external view returns (Ant memory) {
    return ownerAnts[antId];
  }
}
