//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/SafeMath.sol';
import '@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol';
import '@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol';
import './interfaces/IEgg.sol';
import './interfaces/ICryptoAnts.sol';
import './AntsDAO.sol';

contract CryptoAnts is ERC721, ICryptoAnts, AntsDAO, VRFConsumerBaseV2, ReentrancyGuard {
  // event only necessary for knowing that the randomness was requested
  event RandomnessRequested(uint256 requestId);

  // ants and egg constants
  uint256 public constant ANT_RECENTLY_CREATED = 100;
  uint256 public constant ANTS_PRICE = 0.004 ether;
  uint256 public constant ANT_HEALTH = 100;
  uint256 public constant EGGS_ANT_LAYS = 1;
  uint256 public constant MAX_ANTS_PER_EGG = 1;
  uint256 public constant MIN_LAY_PERIOD = 10 minutes;
  bool public constant ANT_IS_ALIVE = true;

  // VRF V2 (randomness) variables
  uint16 public constant REQUEST_CONFIRMATIONS = 3; // Block confirmations before send randomness
  uint32 private immutable _callbackGasLimit; // Max gas price you're willing to pay in wei in the VRF V2 callback (fullFillRandomness, the 2nd tx)
  uint32 public constant NUM_NUMBERS = 1; // Number of nums that VRF is gonna return
  uint64 private immutable _subscriptionId; // id of the VRF V2 sub
  VRFCoordinatorV2Interface private immutable _vrfCoordinator;
  bytes32 private immutable _keyHash; // Max gas price you're willing to pay in wei for a request (in VRF V2)

  // internal variables
  uint256 private _antIdsCounter;

  // only for have a recording
  uint256 public antsAlive = 0;

  // this is for having an incremental recording state in the layEggs() func queue
  uint256 private _queueIdx = 0;

  // this is for having an incremental recording state in the _layEggs() func queue
  uint256 private _queueCounter = 0;

  struct Ant {
    address owner; // ant owner
    uint256 ownerCounter; // position of ant in the 'ownerIds' array
    bool isAlive; // needed for assertion in sellAnt
    uint256 eggsCreated; // eggs that the ant layed
    uint256 timeLastEggLayed; // timestamp of the last egg layed
  }

  // ant info mapping by antId
  /// @dev mapping(antId => Ant)
  mapping(uint256 => Ant) public antsInfo;

  /// @dev mapping(queueCounter => antId);
  mapping(uint256 => uint256) private _layEggQueue;

  // owner address antId's recording, so is easier to get this info externally
  /// @dev mapping(owner => antId[]))
  mapping(address => uint256[]) public ownerIds;

  // modifier that chheck the 'msg.sender' is the 'ant.owner'
  modifier checkAntOwner(uint256 antId) {
    if (antsInfo[antId].owner != msg.sender) revert NotAntOwner();
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
    // get and check the eggs 'msg.sender' can buy are greater than one
    uint256 eggsSenderCanBuy = (msg.value / eggPrice);
    if (eggsSenderCanBuy < 1) revert NoEggs();

    // mint 'eggsSenderCanBuy' to 'msg.sender'
    eggs.mint(msg.sender, eggsSenderCanBuy);
    emit EggsBought(msg.sender, eggsSenderCanBuy);
  }

  // this function keeps the ants created by sender incremental
  function createAnt() external override {
    // check 'msg.sender' has enough egg balance
    if (eggs.balanceOf(msg.sender) < 1) revert NoEggs();

    // this is for keep the ant ids incremental
    _antIdsCounter += 1;

    /// @notice since the antId in 'ownerIds' array is saved in 'antsInfo', is possible to link this both data structure.
    /// is length because after pushing a value to the array that is the correct index
    uint256 antIdx = ownerIds[msg.sender].length;
    antsInfo[_antIdsCounter] = Ant(msg.sender, antIdx, ANT_IS_ALIVE, ZERO_EGGS, ANT_RECENTLY_CREATED);
    ownerIds[msg.sender].push(_antIdsCounter);

    _createAnts(_antIdsCounter);
    emit AntsCreated(msg.sender, _antIdsCounter);
  }

  // method for selling ant from 'msg.sender' passing the 'antId'
  function sellAnt(uint256 _antId) external override checkAntOwner(_antId) {
    // check the ant exists and is alive
    if (!antsInfo[_antId].isAlive) revert NoAnt();

    // get te index to delete in 'ownerIds' array and delete it
    uint256 idxToDel = antsInfo[_antId].ownerCounter;
    // this is possible because the ant ids are incremental and equal in both mappings
    delete ownerIds[msg.sender][idxToDel];

    // delete ant in 'antsInfo' and update 'antsAlive'
    delete antsInfo[_antId];
    antsAlive -= 1;

    // burn ant token and transfer 'ANTS_PRICE' to 'msg.sender'
    _burn(_antId);
    payable(msg.sender).transfer(ANTS_PRICE);

    emit AntSold(msg.sender, _antId);
  }

  // method for laying eggs from ants
  function layEggs(uint256 _antId) external override nonReentrant checkAntOwner(_antId) {
    // check the ant exists and is alive
    if (!antsInfo[_antId].isAlive) revert NoAnt();

    // check that 'MIN_LAY_PERIOD_ is finished or that the ant has been recently created
    uint256 lastEggCreated = antsInfo[_antId].timeLastEggLayed;
    if ((lastEggCreated != ANT_RECENTLY_CREATED) && (block.timestamp - lastEggCreated < MIN_LAY_PERIOD)) {
      revert NotEnoughTimePassed();
    }

    /// @notice here I managed this info by states, since this contract does not executes '_layEggs' func directly but the VRF
    /// is which does it when it sends the randomness. So I implemented 2 incremental states on both 'layEggs()' and '_layEggs()' funcs
    _layEggQueue[_queueIdx] = _antId;
    _queueIdx += 1;

    // request randomness to the VRF
    uint256 requestId = _vrfCoordinator.requestRandomWords(_keyHash, _subscriptionId, REQUEST_CONFIRMATIONS, _callbackGasLimit, NUM_NUMBERS);

    // only for testing purposes (necessary in the mock)
    emit RandomnessRequested(requestId);
  }

  // method for executed by the VRF when it sends the randomness
  // solhint-disable-next-line
  function fulfillRandomWords(
    uint256, /* requestId */
    uint256[] memory randomNumbers
  ) internal override {
    // transform the random number to a number between 1 and 30 inclusively
    uint256 normalizedRandom = (randomNumbers[0] % 30) + 1;

    // execute '_layEggs' with this random numbre
    _layEggs(normalizedRandom);
  }

  // method with the logic for execute the creating and checking if the ant dies based on the randomness
  function _layEggs(uint256 randomNumber) internal {
    // get the older antId in the queue for lay an egg
    uint256 antId = _layEggQueue[_queueCounter];

    // calc eggs amount and update this info
    uint256 eggsAmount = _calcEggsCreation(randomNumber);
    antsInfo[antId].eggsCreated += eggsAmount;
    antsInfo[antId].timeLastEggLayed = block.timestamp;

    // calc if ant dies, and if it does, update that state
    bool antDies = _antDies(antId, randomNumber);
    if (antDies) antsInfo[antId].isAlive = false;

    // update the queue index for the next time this func has to execute the logic it will respect the
    // correct order (the first which execute will lay first the egg/eggs)
    delete _layEggQueue[_queueCounter];
    _queueCounter += 1;

    // mint the eggs amount to the ant owner
    eggs.mint(antsInfo[antId].owner, eggsAmount);

    emit EggsLayed(antsInfo[antId].owner, eggsAmount);
  }

  // method for checking if the ant will die or not
  function _antDies(uint256 _antId, uint256 randomNumber) internal view returns (bool antDies) {
    // get 'eggsCreated' from ant and set 'antDIes' to false
    uint256 eggsCreated = antsInfo[_antId].eggsCreated;
    antDies = false;

    // there is a random part (1, 30) but another part that is based in how many eggs the ant has created
    if (randomNumber * (eggsCreated / 2) > ANT_HEALTH) {
      // if this is true, update antDies
      antDies = true;
    }
  }

  // method for calculating how much eggs is going to create the ant
  function _calcEggsCreation(uint256 randomNumber) internal pure returns (uint256) {
    // there is a 50% probabilities of creating the double amount each time
    if (randomNumber % 2 == 0) {
      return EGGS_ANT_LAYS * 2;
    }

    return EGGS_ANT_LAYS;
  }

  // method that updates 'antsAlive', mints the ant and burn the egg from 'msg.sender'
  function _createAnts(uint256 id) internal {
    antsAlive += 1;

    _mint(msg.sender, id);
    eggs.burn(msg.sender, MAX_ANTS_PER_EGG);
  }

  // method for updating 'antsInfo' and 'ownerIds' state before is transferred between 2 addresses
  function _beforeTokenTransfer(
    address from,
    address to,
    uint256 tokenId
  ) internal override {
    // dismiss if is a burn or a mint operation
    if (from == address(0) || to == address(0)) return;

    // delete the previous owner info
    uint256 prevOwnerId = antsInfo[tokenId].ownerCounter;
    delete ownerIds[from][prevOwnerId];

    // update ant 'antsinfo' mapping state with the new owner info
    uint256 antIdxTo = ownerIds[to].length;
    antsInfo[_antIdsCounter].owner = to;
    antsInfo[_antIdsCounter].ownerCounter = antIdxTo;

    // push to new owner 'ownerIds' array
    ownerIds[to].push(tokenId);
  }

  /* view functions */

  // method for get all owner ant ids
  function getOwnerAntIds(address ownerAddr) external view returns (uint256[] memory) {
    return ownerIds[ownerAddr];
  }

  // method for get an ant info
  function getAntInfo(uint256 antId) external view returns (Ant memory) {
    return antsInfo[antId];
  }

  // method for get a proposal info
  function getProposalInfo(uint256 proposedPrice) external view returns (ProposalInfo memory) {
    return proposals[proposedPrice];
  }

  // method for get an array with all proposed prices
  function getProposalPrices() external view returns (uint256[] memory) {
    return proposedPrices;
  }

  // method for get the contract ETH balance
  function getContractBalance() external view returns (uint256) {
    return address(this).balance;
  }
}
