//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import './interfaces/IAntsDAO.sol';
import './interfaces/IEgg.sol';
import 'hardhat/console.sol';

contract AntsDAO is IAntsDAO {
  IEgg public eggs;
  uint256 public eggPrice = 0.01 ether;
  uint256 private _proposalId;
  uint256 public proposalPeriod;

  // constans
  uint256 public constant ZERO_EGGS = 0;

  enum Status {
    Pristine,
    Pending,
    Current,
    Closed
  }

  struct ProposalInfo {
    uint256 price;
    uint256 timestamp;
    Status status;
    uint256 votes;
  }

  /// @dev mapping(proposalId => ProposalInfo)
  mapping(uint256 => ProposalInfo) public proposals;

  // This is for the user to know which prices are being proposed easier
  uint256[] public proposedPrices;

  modifier enoughEggs() {
    if (eggs.balanceOf(msg.sender) < 1) revert NotVotingPower();
    _;
  }

  function proposeEggPrice(uint256 proposedPrice) external override enoughEggs {
    Status proposalStatus = proposals[proposedPrice].status;
    if (proposedPrice == eggPrice || proposalStatus == Status.Pending || proposalStatus == Status.Current) {
      revert PriceAlreadyExists();
    }

    // make proposal ids incremental for assuring they are the same in both data structures
    proposals[_proposalId] = ProposalInfo(proposedPrice, block.timestamp, Status.Pending, ZERO_EGGS);
    proposedPrices.push(proposedPrice);

    _proposalId += 1;
  }

  function approveProposal(uint256 proposalId) external override enoughEggs {
    if (proposals[proposalId].status != Status.Pending) revert ProposalNotFound();

    proposals[proposalId].votes += eggs.balanceOf(msg.sender);
  }

  function executeProposal(uint256 proposalId) external override {
    if (proposals[proposalId].status != Status.Pending) revert ProposalNotFound();

    if (block.timestamp - proposals[proposalId].timestamp < proposalPeriod) {
      revert UnfinishedPeriod();
    }

    uint256 totalSupply = eggs.totalSupply();
    uint256 approvalsThreshold = totalSupply / 2;

    bool approved = false;
    Status status = Status.Closed;

    if (proposals[proposalId].votes > approvalsThreshold) {
      approved = true;
      eggPrice = proposals[proposalId].price;
      status = Status.Current;
    }

    proposals[proposalId].status = status;

    emit ExecutedProposal(approved, proposalId);
  }
}
