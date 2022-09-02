//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

interface IAntsDAO {
  /* events */
  /// @dev Emitted when 'msg.sender' executes a proposal
  /// with the 'proposalPrice' of this and the 'approved' result
  event ExecutedProposal(bool approved, uint256 proposalPrice);

  /* functions */
  /** @dev proposes a new egg price
   * Requirements:
   * - 'msg.sender' balance must be at least one egg
   * - 'proposalStatus' must be or Closed or Pristine
   */
  function proposeEggPrice(uint256) external;

  /** @dev Approves a price proposal. The voting power is equal than egg balance
   * Requirements:
   * - 'msg.sender' balance must be at least one egg
   * - 'proposalStatus' must be or Pending
   */
  function approveProposal(uint256) external;

  /** @dev Executes a price proposal
   * Requirements:
   * - 'proposalStatus' must be Pending
   */
  function executeProposal(uint256) external;

  /* errors */
  /// @dev Error when 'msg.sender' does not have at least one egg balance
  error NotVotingPower();
  /// @dev Error when proposed price is the actual price or is already proposed
  error PriceAlreadyExists();
  /// @dev Error when the proposal of the id passed status in 'executeProposal' is not Pending
  error ProposalNotFound();
  /// @dev Error in 'executeProposal' when the 'proposalPeriod' is not finished yet
  error UnfinishedPeriod();
}
