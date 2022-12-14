//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import './interfaces/IAntsDAO.sol';
import './interfaces/IEgg.sol';
import 'hardhat/console.sol';

contract AntsDAO is IAntsDAO {
  // internal variables
  IEgg public eggs;
  uint256 public eggPrice = 0.01 ether;
  uint256 public proposalPeriod;

  // constants
  uint256 public constant ZERO_EGGS = 0;

  // status
  enum Status {
    Pristine,
    Pending,
    Current
  }

  // proposal information
  struct ProposalInfo {
    uint256 price;
    uint256 timestamp;
    Status status;
    uint256 votes;
  }

  /// @dev mapping(proposalPrices => ProposalInfo)
  mapping(uint256 => ProposalInfo) private _proposals;

  // This is only for externally know which prices are being proposed easier
  uint256[] private _proposedPrices;

  // modifier that checks 'msg.sender' egg balance is at least one
  modifier enoughEggs() {
    if (eggs.balanceOf(msg.sender) < 1) revert NotVotingPower();
    _;
  }

  // method for propose a new egg price
  function proposeEggPrice(uint256 proposedPrice) external override enoughEggs {
    // check the price is not the current one or that the proposal already exists
    if (proposedPrice == eggPrice || _proposals[proposedPrice].status != Status.Pristine) {
      revert PriceAlreadyExists();
    }

    // make proposal ids incremental for assuring they are the same in both data structures
    _proposals[proposedPrice] = ProposalInfo(proposedPrice, block.timestamp, Status.Pending, ZERO_EGGS);
    _proposedPrices.push(proposedPrice);
  }

  // method for approving a proposal identified by 'proposalId'
  function approveProposal(uint256 proposedPrice) external override enoughEggs {
    // check the proposal to approve is in 'Pending' status
    if (_proposals[proposedPrice].status != Status.Pending) revert ProposalNotFound();

    // the proposal would have as many votes as the 'msg.sender' egg balance
    _proposals[proposedPrice].votes += eggs.balanceOf(msg.sender);
  }

  // method for executing proposal
  function executeProposal(uint256 proposedPrice) external override {
    // check the proposal status is 'Pending'
    if (_proposals[proposedPrice].status != Status.Pending) revert ProposalNotFound();

    // check the 'proposalPeriod' to vote is already finished
    if (block.timestamp - _proposals[proposedPrice].timestamp < proposalPeriod) {
      revert UnfinishedPeriod();
    }

    // defines 'approvalsThreshold' as more thant the 50% of the total supply
    uint256 totalSupply = eggs.totalSupply();
    uint256 approvalsThreshold = totalSupply / 2;

    // define contract as false
    bool approved = false;

    // if the votes are greater than 'approvalsThreshold', update variables and egg price
    if (_proposals[proposedPrice].votes > approvalsThreshold) {
      approved = true;
      eggPrice = _proposals[proposedPrice].price;
      _proposals[proposedPrice].status = Status.Current;
    }

    // delete proposal from array
    delete _proposals[proposedPrice];

    emit ExecutedProposal(approved, proposedPrice);
  }

  // method for get a proposal info
  function getProposalInfo(uint256 proposedPrice) external view returns (ProposalInfo memory) {
    return _proposals[proposedPrice];
  }

  function getProposalPrices() external view returns (uint256[] memory) {
    return _proposedPrices;
  }
}
