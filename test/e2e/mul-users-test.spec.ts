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

describe('CryptoAnts-Multiple Users', function () {
  // signers
  let deployer: SignerWithAddress;
  let userZero: SignerWithAddress;
  let userOne: SignerWithAddress;

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
    [, deployer, userZero, userOne] = await ethers.getSigners();

    // deploying VRF V2 Mock contract
    vrfCoordinatorV2Mock = (await deployVRFv2Mock()) as VRFCoordinatorV2Mock;
    logger.info(`yes: ${await vrfCoordinatorV2Mock.getSubscription(subscriptionId)}`);

    const tx = await vrfCoordinatorV2Mock.connect(userZero).getRequestConfig();
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

  describe('crypto ants e2e with more than one user', () => {
    it('2 users should execute all the functions related to buy/lay/sell ants and eggs correctly', async () => {
      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });
      await cryptoAnts.connect(userOne).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(userZero).createAnt();
      await cryptoAnts.connect(userOne).createAnt();

      const [zeroUserAntId] = await cryptoAnts.getOwnerAntIds(userZero.address);
      const [oneUserAntId] = await cryptoAnts.getOwnerAntIds(userOne.address);

      logger.info(`zeroUserAntId: ${zeroUserAntId}`);
      logger.info(`oneUserAntId: ${oneUserAntId}`);

      // lay eggs user zero
      let tx = await cryptoAnts.connect(userZero).layEggs(zeroUserAntId);
      let txReceipt = await tx.wait();

      // we execute the mock randomness
      if (!txReceipt.events || !txReceipt.events[1].args) {
        throw new Error('Bad reading of events');
      }
      let requestId = txReceipt.events[1].args.requestId;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

      // lay eggs user one
      tx = await cryptoAnts.connect(userOne).layEggs(oneUserAntId);
      txReceipt = await tx.wait();

      // we execute the mock randomness
      if (!txReceipt.events || !txReceipt.events[1].args) {
        throw new Error('Bad reading of events');
      }
      requestId = txReceipt.events[1].args.requestId;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

      let antInfoZero = await cryptoAnts.getAntInfo(zeroUserAntId);
      logger.info(`antInfo: ${antInfoZero}`);
      let antInfoOne = await cryptoAnts.getAntInfo(oneUserAntId);
      logger.info(`antInfo: ${antInfoOne}`);
      logger.info('here');
      const txZero = await cryptoAnts.connect(userZero).sellAnt(zeroUserAntId);

      logger.info('here 2');
      antInfoZero = await cryptoAnts.getAntInfo(zeroUserAntId);
      logger.info(`antInfo: ${antInfoZero}`);
      antInfoOne = await cryptoAnts.getAntInfo(oneUserAntId);
      logger.info(`antInfo: ${antInfoOne}`);
      const txOne = await cryptoAnts.connect(userOne).sellAnt(oneUserAntId);

      expect(txZero).to.emit(cryptoAnts, 'AntSold()');
      expect(txOne).to.emit(cryptoAnts, 'AntSold()');
    });

    it('both users should have 100 eggs starting with only 1 initial egg', async () => {
      const oneHundred = BigNumber.from(100);
      const layEggsPeriod = await cryptoAnts.MIN_LAY_PERIOD();
      let zeroAntsBalance = await cryptoAnts.balanceOf(userZero.address);
      let oneAntsBalance = await cryptoAnts.balanceOf(userOne.address);

      // buy an egg
      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });
      await cryptoAnts.connect(userOne).buyEggs({ value: eggPrice });

      let i;
      for (i = 0; zeroAntsBalance.lt(100) && oneAntsBalance.lt(100); i++) {
        logger.info(`i: ${i}`);
        // create ant
        await cryptoAnts.connect(userZero).createAnt();
        await cryptoAnts.connect(userOne).createAnt();

        // get last ant id of user zero
        const zeroUserAntsId = await cryptoAnts.getOwnerAntIds(userZero.address);
        const zeroAntId = zeroUserAntsId[zeroUserAntsId.length - 1]; // always gets the  last for assuring is not dead

        /// lay egg from ant of user zero
        let tx = await cryptoAnts.connect(userZero).layEggs(zeroAntId);
        let txReceipt = await tx.wait();

        // request randomness
        if (!txReceipt.events || !txReceipt.events[1].args) {
          throw new Error('Bad reading of events');
        }
        let requestId = txReceipt.events[1].args.requestId;
        await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

        // get last ant id of user one
        const oneUserAntsId = await cryptoAnts.getOwnerAntIds(userOne.address);
        const oneAntId = oneUserAntsId[oneUserAntsId.length - 1]; // always gets the last for assuring is not dead

        /// lay egg from ant of user one
        tx = await cryptoAnts.connect(userOne).layEggs(oneAntId);
        txReceipt = await tx.wait();

        // request randomness
        if (!txReceipt.events || !txReceipt.events[1].args) {
          throw new Error('Bad reading of events');
        }
        requestId = txReceipt.events[1].args.requestId;
        await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

        // advance time period that the ant needs for lay an egg again
        await advanceTimeAndBlock(layEggsPeriod.toNumber() + 1);

        zeroAntsBalance = await cryptoAnts.balanceOf(userZero.address);
        oneAntsBalance = await cryptoAnts.balanceOf(userOne.address);
      }

      const zeroAntsBalanceAf = await cryptoAnts.balanceOf(userZero.address);
      const oneAntsBalanceAf = await cryptoAnts.balanceOf(userOne.address);

      expect(zeroAntsBalanceAf).to.be.equal(oneHundred);
      expect(oneAntsBalanceAf).to.be.equal(oneHundred);
    });

    it('should update the ant state correctly after an ant trasnfer between users', async () => {
      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(userZero).createAnt();
      const [antId] = await cryptoAnts.getOwnerAntIds(userZero.address);

      const tx = await cryptoAnts.connect(userZero).transferFrom(userZero.address, userOne.address, antId);

      const [userZeroId] = await cryptoAnts.getOwnerAntIds(userZero.address);
      logger.info(`userZeroId: ${userZeroId}`);

      const userOneIds = await cryptoAnts.getOwnerAntIds(userOne.address);
      logger.info(`userOneIds: ${userOneIds}`);

      const [antOwner, antIdx] = await cryptoAnts.getAntInfo(antId);
      logger.info(`[antOwner, antIdx]: ${[antOwner, antIdx]}`);

      expect(tx).to.changeTokenBalance(cryptoAnts, userOne, 77);
      expect(userZeroId).to.be.equal(0);
      expect(userOneIds.length).to.be.equal(1);
      expect(userOneIds[0]).to.be.equal(antId);
      expect(antOwner).to.be.equal(userOne.address);
      expect(antIdx).to.be.equal(0);
    });

    it('2 users should be able to propose, approve and reject dao proposals', async () => {
      enum Status {
        Pristine,
        Pending,
        Current,
        Closed,
      }

      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });
      await cryptoAnts.connect(userOne).buyEggs({ value: eggPrice });

      const zeroProposedPrice = eggPrice.mul(2);
      await cryptoAnts.connect(userZero).proposeEggPrice(zeroProposedPrice);

      let proposedPrices = await cryptoAnts.getProposalPrices();
      logger.info(`proposedPrices: ${proposedPrices}`);

      logger.info('Searching...');
      let proposalId = 0;
      for (let i = 0; i < proposedPrices.length; i++) {
        logger.info(`proposedPrices[i]: ${proposedPrices[i]}`);
        logger.info(`zeroProposedPrice: ${zeroProposedPrice}`);

        logger.info(`(proposedPrices[i] === zeroProposedPrice): ${proposedPrices[i] === zeroProposedPrice}`);
        if (proposedPrices[i].toString() === zeroProposedPrice.toString()) {
          logger.info(true);
          proposalId = i;
        }
      }
      logger.info('Searced...');
      // user zero approves his proposal
      await cryptoAnts.connect(userZero).approveProposal(proposalId);

      const proposalPeriod = await cryptoAnts.proposalPeriod();
      await advanceTimeAndBlock(proposalPeriod.toNumber() + 1);

      // but user one doesn;t approves and the proposal won't pass since the voting power is divided 50/50
      await cryptoAnts.connect(userZero).executeProposal(proposalId);
      const eggPriceContract = await cryptoAnts.eggPrice();
      expect(eggPriceContract).to.be.equal(eggPrice);

      // user one proposed another price
      const oneProposedPrice = eggPrice.div(2);
      logger.info(`oneProposedPrice: ${oneProposedPrice}`);
      await cryptoAnts.connect(userOne).proposeEggPrice(oneProposedPrice);

      proposedPrices = await cryptoAnts.getProposalPrices();
      logger.info(`proposedPrices: ${proposedPrices}`);
      logger.info('Searching...');
      proposalId = 0;
      for (let i = 0; i < proposedPrices.length; i++) {
        logger.info(`proposedPrices[i]: ${proposedPrices[i]}`);
        logger.info(`oneProposedPrice: ${oneProposedPrice}`);

        logger.info(`(proposedPrices[i] === oneProposedPrice): ${proposedPrices[i] === oneProposedPrice}`);
        if (proposedPrices[i].toString() === oneProposedPrice.toString()) {
          logger.info(true);
          proposalId = i;
        }
      }
      logger.info('Searched...');
      logger.info(`proposalId: ${proposalId}`);

      // and both users approve it
      await cryptoAnts.connect(userZero).approveProposal(proposalId);
      logger.info(0);
      await cryptoAnts.connect(userOne).approveProposal(proposalId);
      logger.info(1);

      await advanceTimeAndBlock(proposalPeriod.toNumber() + 1);
      // so price should be updated since proposal is totally aproved
      logger.info(2);
      await cryptoAnts.connect(userZero).executeProposal(proposalId);
      logger.info(3);

      const newEggPrice = await cryptoAnts.eggPrice();
      const [, , proposalStatus] = await cryptoAnts.getProposalInfo(proposalId);

      expect(newEggPrice).to.be.equal(oneProposedPrice);
      expect(proposalStatus).to.be.equal(Status.Current);
    });
  });
});
