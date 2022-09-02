import { expect, use } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber } from 'ethers';
import { waffleChai } from '@ethereum-waffle/chai';
import { CryptoAnts, CryptoAnts__factory, Egg, Egg__factory, VRFCoordinatorV2Mock } from '@typechained';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { deployVRFv2Mock, KEY_HASH, CALLBACK_GAS_LIMIT, subscriptionId } from '../utils/vrf-mock';
import { advanceTimeAndBlock } from '@utils/evm';
const logger = require('pino')();
use(waffleChai);

const FORK_BLOCK_NUMBER = 7506810;

describe('CryptoAnts-AntsDAO', () => {
  // signers
  let deployer: SignerWithAddress;
  let randomUser: SignerWithAddress;

  // factories
  let cryptoAntsFactory: CryptoAnts__factory;
  let eggFactory: Egg__factory;

  // contracts
  let cryptoAnts: CryptoAnts;
  let egg: Egg;
  let vrfCoordinatorV2Mock: VRFCoordinatorV2Mock;

  // contract variables
  let eggPrice: BigNumber;

  // misc
  let snapshotId: string;

  before(async () => {
    // forking mainnet
    await evm.reset({
      jsonRpcUrl: process.env.RPC_GOERLI,
      blockNumber: FORK_BLOCK_NUMBER,
    });

    // getting signers with ETH
    [, deployer, randomUser] = await ethers.getSigners();

    // deploying VRF V2 Mock contract
    vrfCoordinatorV2Mock = (await deployVRFv2Mock()) as VRFCoordinatorV2Mock;
    logger.info(`yes: ${await vrfCoordinatorV2Mock.getSubscription(subscriptionId)}`);

    const tx = await vrfCoordinatorV2Mock.connect(randomUser).getRequestConfig();
    logger.info(`tx: ${tx}`);

    const proposalPeriod = 60 * 60 * 24 * 2; // 2 days

    // deploying CryptoAnts and Egg contracts
    eggFactory = (await ethers.getContractFactory('Egg')) as Egg__factory;
    egg = await eggFactory.connect(deployer).deploy();

    cryptoAntsFactory = (await ethers.getContractFactory('CryptoAnts')) as CryptoAnts__factory;
    cryptoAnts = await cryptoAntsFactory.deploy(
      egg.address,
      vrfCoordinatorV2Mock.address,
      KEY_HASH,
      subscriptionId,
      CALLBACK_GAS_LIMIT,
      proposalPeriod
    );

    await egg.transferOwnership(cryptoAnts.address);

    eggPrice = await cryptoAnts.eggPrice();

    // snapshot
    snapshotId = await evm.snapshot.take();

    const eggOwner = await egg.owner();
    const eggFromAntsContract = await cryptoAnts.eggs();

    expect(eggOwner).to.be.equal(cryptoAnts.address);
    expect(eggFromAntsContract).to.be.equal(egg.address);
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('DAO related tests', () => {
    it('should propose, approve and execute the proposal correctly', async () => {
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice.mul(2) });

      const newProposedPrice = eggPrice.div(2);
      await cryptoAnts.connect(randomUser).proposeEggPrice(newProposedPrice);

      const proposedPrices = await cryptoAnts.getProposalPrices();

      let proposalId = 0;
      for (let i = 0; i < proposedPrices.length; i++) {
        if (proposedPrices[i] == newProposedPrice) {
          proposalId = i;
        }
      }

      await cryptoAnts.connect(randomUser).approveProposal(proposalId);
      const proposalPeriod = await cryptoAnts.proposalPeriod();
      await advanceTimeAndBlock(proposalPeriod.toNumber());

      await cryptoAnts.connect(randomUser).executeProposal(proposalId);
      const newEggPrice = await cryptoAnts.eggPrice();

      expect(newEggPrice).to.be.equal(newProposedPrice);
    });

    it("shouldn't be able to propose a new price if user doesn't have any eggs", async () => {
      const newPrice = eggPrice.mul(2);
      await expect(cryptoAnts.connect(randomUser).proposeEggPrice(newPrice)).to.be.revertedWith('NotVotingPower()');
    });

    it("shouldn't be able to approve a proposal if user doesn't have any eggs", async () => {
      const newPrice = eggPrice.mul(2);
      await expect(cryptoAnts.connect(randomUser).approveProposal(newPrice)).to.be.revertedWith('NotVotingPower()');
    });

    it("shouldn't be able to approve an inexistent (or closed) proposal", async () => {
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice.mul(2) });

      const newProposedPrice = eggPrice.div(2);
      await cryptoAnts.connect(randomUser).proposeEggPrice(newProposedPrice);

      const proposedPrices = await cryptoAnts.getProposalPrices();

      let proposalId = 0;
      for (let i = 0; i < proposedPrices.length; i++) {
        if (proposedPrices[i] == newProposedPrice) {
          proposalId = i;
        }
      }

      await cryptoAnts.connect(randomUser).approveProposal(proposalId);
      const proposalPeriod = await cryptoAnts.proposalPeriod();
      await advanceTimeAndBlock(proposalPeriod.toNumber());

      await cryptoAnts.connect(randomUser).executeProposal(proposalId);
      const newEggPrice = await cryptoAnts.eggPrice();

      // closed proposal
      await expect(cryptoAnts.connect(randomUser).approveProposal(proposalId)).to.be.revertedWith('ProposalNotFound()');
      // inexistent proposal
      await expect(cryptoAnts.connect(randomUser).approveProposal(proposalId + 10)).to.be.revertedWith('ProposalNotFound()');
    });

    it("shouldn't be able to execute an inexistent (or closed) proposal", async () => {
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice.mul(2) });

      const newProposedPrice = eggPrice.div(2);
      await cryptoAnts.connect(randomUser).proposeEggPrice(newProposedPrice);

      const proposedPrices = await cryptoAnts.getProposalPrices();

      let proposalId = 0;
      for (let i = 0; i < proposedPrices.length; i++) {
        if (proposedPrices[i] == newProposedPrice) {
          proposalId = i;
        }
      }

      await cryptoAnts.connect(randomUser).approveProposal(proposalId);
      const proposalPeriod = await cryptoAnts.proposalPeriod();
      await advanceTimeAndBlock(proposalPeriod.toNumber());

      await cryptoAnts.connect(randomUser).executeProposal(proposalId);
      const newEggPrice = await cryptoAnts.eggPrice();

      // closed proposal
      await expect(cryptoAnts.connect(randomUser).approveProposal(proposalId)).to.be.revertedWith('ProposalNotFound()');
      // inexistent proposal
      await expect(cryptoAnts.connect(randomUser).approveProposal(proposalId + 10)).to.be.revertedWith('ProposalNotFound()');
    });

    it("shouldn't be able to execute a proposal that didn't passed the proposal period", async () => {
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice.mul(2) });

      const newProposedPrice = eggPrice.div(2);
      await cryptoAnts.connect(randomUser).proposeEggPrice(newProposedPrice);

      const proposedPrices = await cryptoAnts.getProposalPrices();

      let proposalId = 0;
      for (let i = 0; i < proposedPrices.length; i++) {
        if (proposedPrices[i] == newProposedPrice) {
          proposalId = i;
        }
      }

      await cryptoAnts.connect(randomUser).approveProposal(proposalId);

      await expect(cryptoAnts.connect(randomUser).executeProposal(proposalId)).to.be.revertedWith('UnfinishedPeriod()');
    });
  });
});
