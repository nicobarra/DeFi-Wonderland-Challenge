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

describe('CryptoAnts-AntsDAO', function () {
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

    // define proposal period for DAO proposals
    const proposalPeriod = 60 * 60 * 24 * 2; // 2 days

    // deploying CryptoAnts and Egg contracts
    eggFactory = (await ethers.getContractFactory('Egg')) as Egg__factory;
    egg = await eggFactory.connect(deployer).deploy();

    // get and deploy CryptoAnts contract
    cryptoAntsFactory = (await ethers.getContractFactory('CryptoAnts')) as CryptoAnts__factory;
    cryptoAnts = await cryptoAntsFactory.deploy(
      egg.address,
      vrfCoordinatorV2Mock.address,
      KEY_HASH,
      subscriptionId,
      CALLBACK_GAS_LIMIT,
      proposalPeriod
    );

    // transfer ownership off egg from deployer to cryptoAnts contracts
    await egg.transferOwnership(cryptoAnts.address);

    // get egg price
    eggPrice = await cryptoAnts.eggPrice();

    // snapshot
    snapshotId = await evm.snapshot.take();

    // get egg owner and egg address from ant contrac
    const eggOwner = await egg.owner();
    const eggFromAntsContract = await cryptoAnts.eggs();
    // assert they are correct
    expect(eggOwner).to.be.equal(cryptoAnts.address);
    expect(eggFromAntsContract).to.be.equal(egg.address);
  });

  beforeEach(async () => {
    // for reverting the block state before any test
    await evm.snapshot.revert(snapshotId);
  });

  describe('DAO related tests', () => {
    it('should propose, approve and execute the proposal correctly', async () => {
      // buy 2 eggs
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice.mul(2) });

      // propose new price for a half of the current one
      const newProposedPrice = eggPrice.div(2);
      await cryptoAnts.connect(randomUser).proposeEggPrice(newProposedPrice);

      // get proposed prices array
      const proposedPrices = await cryptoAnts.getProposalPrices();

      // get last price proposed from the array
      const proposalPrice = proposedPrices[proposedPrices.length - 1];

      // approve that proposal with the 'proposalPrice'
      await cryptoAnts.connect(randomUser).approveProposal(proposalPrice);
      const proposalPeriod = await cryptoAnts.proposalPeriod();

      // advance time for passing the proposal period
      await advanceTimeAndBlock(proposalPeriod.toNumber());

      // execute proposal
      await cryptoAnts.connect(randomUser).executeProposal(proposalPrice);
      const newEggPrice = await cryptoAnts.eggPrice();

      // should update the egg price it has 100% of the voting power approving it
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
      // buy 2 eggs
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice.mul(2) });

      // propose new price for a half of the current one
      const newProposedPrice = eggPrice.div(2);
      await cryptoAnts.connect(randomUser).proposeEggPrice(newProposedPrice);

      // get proposed prices array
      const proposedPrices = await cryptoAnts.getProposalPrices();

      // get last price proposed from the array
      const proposalPrice = proposedPrices[proposedPrices.length - 1];

      // approve that proposal with the 'proposalPrice'
      await cryptoAnts.connect(randomUser).approveProposal(proposalPrice);
      const proposalPeriod = await cryptoAnts.proposalPeriod();

      // advance time for passing the proposal period
      await advanceTimeAndBlock(proposalPeriod.toNumber());

      // execute proposal
      await cryptoAnts.connect(randomUser).executeProposal(proposalPrice);

      // closed proposal
      await expect(cryptoAnts.connect(randomUser).approveProposal(proposalPrice)).to.be.revertedWith('ProposalNotFound()');
      // inexistent proposal
      await expect(cryptoAnts.connect(randomUser).approveProposal(proposalPrice.add(10))).to.be.revertedWith('ProposalNotFound()');
    });

    it("shouldn't be able to execute a proposal that didn't passed the proposal period", async () => {
      // buy 2 eggs
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice.mul(2) });

      // propose new price for the double of the current one
      const newProposedPrice = eggPrice.mul(2);
      await cryptoAnts.connect(randomUser).proposeEggPrice(newProposedPrice);

      // get proposed prices array
      const proposedPrices = await cryptoAnts.getProposalPrices();

      // get last price proposed from the array
      const proposalPrice = proposedPrices[proposedPrices.length - 1];

      // aprove proposal
      await cryptoAnts.connect(randomUser).approveProposal(proposalPrice);

      // should fail since period hasn;t finished yet
      await expect(cryptoAnts.connect(randomUser).executeProposal(proposalPrice)).to.be.revertedWith('UnfinishedPeriod()');
    });

    it("shouln't be able to propose 2 times the same price", async () => {
      const newPrice = ethers.utils.parseEther('0.001');
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).proposeEggPrice(newPrice);
      const proposedPrices = await cryptoAnts.getProposalPrices();
      logger.info(`proposedPrices.length: ${proposedPrices.length}`);
      const lastPriceProposed = proposedPrices[proposedPrices.length - 1];
      logger.info(`lastPriceProposed: ${lastPriceProposed}`);
      const priceinfo = await cryptoAnts.getProposalInfo(lastPriceProposed);
      logger.info(`priceinfo: ${priceinfo}`);

      await expect(cryptoAnts.connect(randomUser).proposeEggPrice(newPrice)).to.be.revertedWith('PriceAlreadyExists()');
    });
  });
});
