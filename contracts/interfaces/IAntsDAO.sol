//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

interface IAntsDAO {
  // events
  event ExecutedProposal(bool approved, uint256 proposalPrice, ProposalInfo info);

  enum Status {
    Pending,
    Approved
  }

  struct ProposalInfo {
    uint256 id;
    uint256 timestamp;
    Status status;
    uint256 votes;
  }

  // external functions
  function proposeEggPrice(uint256) external;

  function approveProposal(uint256) external;

  function executeProposal(uint256) external;

  // errors
  error NotVotingPower();
  error PriceAlreadyExists();
  error ClosedProposal();
  error UnfinishedPeriod();
}
