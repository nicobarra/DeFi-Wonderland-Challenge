import { expect, use } from 'chai';
import { ethers } from 'hardhat';
import { BigNumber, utils } from 'ethers';
import { waffleChai } from '@ethereum-waffle/chai';
import { CryptoAnts, CryptoAnts__factory, Egg, Egg__factory, VRFCoordinatorV2Mock } from '@typechained';
import { evm } from '@utils';
import { delay } from '../../helpers/delay';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { deployVRFv2Mock, KEY_HASH, CALLBACK_GAS_LIMIT, subscriptionId } from '../utils/vrf-mock';
import { advanceTimeAndBlock } from '@utils/evm';
const logger = require('pino')();
use(waffleChai);

const FORK_BLOCK_NUMBER = 7506810;

describe('CryptoAnts', function () {
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

  describe('Robert e2e test proposed', () => {
    it('should only allow the CryptoAnts contract to mint eggs', async () => {
      const antTx = await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      // if emits the event, the tx was successful
      expect(antTx).to.emit(cryptoAnts, 'EggsBought');
      // I didn't implemented 'calledOn' matchers because provider doesn;t support call history

      await expect(egg.connect(randomUser).mint(randomUser.address, eggPrice)).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should buy an egg and create a new ant with it', async () => {
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });
      const one = BigNumber.from(1);
      const antsBalanceBef = await cryptoAnts.balanceOf(randomUser.address);

      const antTx = await cryptoAnts.connect(randomUser).createAnt();
      const antsBalanceAf = await cryptoAnts.balanceOf(randomUser.address);

      expect(antsBalanceAf.sub(antsBalanceBef)).to.be.equal(one);
      // I didn't use this method because is bad. For example, this assertion would pass
      // expect(antTx).to.changeTokenBalance(cryptoAnts, randomUser, 7);
    });

    it('should send funds to the user who sells an ant', async () => {
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).createAnt();
      const userAntsIds = await cryptoAnts.getOwnerAntIds(randomUser.address);

      const userEthBalanceBef = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceBef: ${userEthBalanceBef}`);

      const sellTx = await cryptoAnts.connect(randomUser).sellAnt(userAntsIds[0]);
      const receiptTx = await sellTx.wait();

      const gasUsed = receiptTx.gasUsed;
      logger.info(`gasUsed: ${gasUsed}`);

      const userEthBalanceAf = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceAf : ${userEthBalanceAf}`);
      const antsBalanceAf = await cryptoAnts.balanceOf(randomUser.address);

      expect(userEthBalanceAf.add(gasUsed)).to.be.gt(userEthBalanceBef);
      // expect(sellTx).to.changeEtherBalance(randomUser, antsPrice);
    });

    it('should burn the ant after the user sells it', async () => {
      const zero = BigNumber.from(0);

      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).createAnt();

      const [userAntsId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      const userEthBalanceBef = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceBef: ${userEthBalanceBef}`);

      const sellTx = await cryptoAnts.connect(randomUser).sellAnt(userAntsId);
      const receiptTx = await sellTx.wait();

      const gasUsed = receiptTx.gasUsed;
      logger.info(`gasUsed: ${gasUsed}`);

      const userEthBalanceAf = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceAf : ${userEthBalanceAf}`);
      const antsBalanceAf = await cryptoAnts.balanceOf(randomUser.address);

      const [antIsAlive] = await cryptoAnts.getAntById(randomUser.address, userAntsId);

      expect(antsBalanceAf).to.be.equal(zero);
      expect(antIsAlive).to.be.false;
    });
    /*
    This is a completely optional test.
    Hint: you may need advanceTimeAndBlock (from utils) to handle the egg creation cooldown
  */
    it('should be able to create a 100 ants with only one initial egg', async () => {
      const oneHundred = BigNumber.from(100);
      const layEggsPeriod = await cryptoAnts.MIN_LAY_PERIOD();
      let antsBalance = await cryptoAnts.balanceOf(randomUser.address);

      // buy an egg
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      let i;
      for (i = 0; antsBalance.lt(100); i++) {
        // create ant
        await cryptoAnts.connect(randomUser).createAnt();

        // get last ant id
        const userAntsId = await cryptoAnts.getOwnerAntIds(randomUser.address);
        const antId = userAntsId[userAntsId.length - 1]; // always gets the last for assuring is not dead
        // lay egg from ant
        const tx = await cryptoAnts.connect(randomUser).layEggs(antId);
        const txReceipt = await tx.wait();

        if (!txReceipt.events || !txReceipt.events[1].args) {
          throw new Error('Bad reading of events');
        }

        const requestId = txReceipt.events[1].args.requestId;
        await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

        antsBalance = await cryptoAnts.balanceOf(randomUser.address);

        // advance time period that the ant needs for lay an egg again
        await advanceTimeAndBlock(layEggsPeriod.toNumber() + 1);
      }

      const antsBalanceAf = await cryptoAnts.balanceOf(randomUser.address);
      expect(antsBalanceAf).to.be.equal(oneHundred);
    });
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
