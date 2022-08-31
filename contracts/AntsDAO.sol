//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import './interfaces/IAntsDAO.sol';
import './interfaces/IEgg.sol';

contract AntsDAO is IAntsDAO {
  IEgg public eggs;
  uint256 public eggPrice = 0.01 ether;
  uint256 public proposalId = 1;
  uint256 public constant PROPOSAL_PERIOD = 4 days;
  ProposalInfo private _proposal;

  /// @dev mapping(proposalPrice => ProposalInfo)
  mapping(uint256 => ProposalInfo) public proposals;

  modifier enoughEggs() {
    if (eggs.balanceOf(msg.sender) > 1) revert NotVotingPower();
    _;
  }

  function proposeEggPrice(uint256 proposedPrice) external override enoughEggs {
    if (proposedPrice == eggPrice || proposals[proposedPrice].id != 0) revert PriceAlreadyExists();

    proposals[proposedPrice] = ProposalInfo(proposalId, block.timestamp, Status.Pending, 0);
    proposalId += 1;
  }

  function approveProposal(uint256 proposedPrice) external override enoughEggs {
    _proposal = proposals[proposedPrice];
    if (_proposal.status != Status.Pending) revert ClosedProposal();

    _proposal.votes += eggs.balanceOf(msg.sender);
  }

  function executeProposal(uint256 proposedPrice) external override {
    _proposal = proposals[proposedPrice];
    if (_proposal.status != Status.Pending) revert ClosedProposal();

    if (block.timestamp - _proposal.timestamp < PROPOSAL_PERIOD) {
      revert UnfinishedPeriod();
    }

    uint256 totalSupply = eggs.totalSupply();
    uint256 approvalsThreshold = totalSupply / 2;
    bool approved = false;

    if (_proposal.votes > approvalsThreshold) {
      approved = true;
      eggPrice = proposedPrice;
    }

    ProposalInfo memory eventProposal = _proposal; // this is with the unique purpose of emitting on the event
    delete _proposal; // necessary for the price assertion

    emit ExecutedProposal(approved, proposedPrice, eventProposal);
  }
}
