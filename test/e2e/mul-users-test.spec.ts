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

    // getting multiple signers with ETH
    [, deployer, userZero, userOne] = await ethers.getSigners();

    // deploying VRF V2 Mock contract
    vrfCoordinatorV2Mock = (await deployVRFv2Mock()) as VRFCoordinatorV2Mock;

    // set proposal period for DAO proposals
    const proposalPeriod = 60 * 60 * 24 * 2; // 2 days

    // deploying CryptoAnts and Egg contracts
    eggFactory = (await ethers.getContractFactory('Egg')) as Egg__factory;
    egg = await eggFactory.connect(deployer).deploy();

    // get and deploy cryptoAnts contract
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
    await evm.snapshot.revert(snapshotId);
  });

  describe('crypto ants e2e with more than one user', () => {
    it('2 users should execute all the functions related to buy/lay/sell ants and eggs correctly', async () => {
      // buy an egg with both users
      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });
      await cryptoAnts.connect(userOne).buyEggs({ value: eggPrice });

      // create an ant with both users
      await cryptoAnts.connect(userZero).createAnt();
      await cryptoAnts.connect(userOne).createAnt();

      // get first ant id of both users id's arrays
      const [zeroUserAntId] = await cryptoAnts.getOwnerAntIds(userZero.address);
      const [oneUserAntId] = await cryptoAnts.getOwnerAntIds(userOne.address);

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

      // get users info
      let antInfoZero = await cryptoAnts.getAntInfo(zeroUserAntId);
      let antInfoOne = await cryptoAnts.getAntInfo(oneUserAntId);
      const txZero = await cryptoAnts.connect(userZero).sellAnt(zeroUserAntId);

      antInfoZero = await cryptoAnts.getAntInfo(zeroUserAntId);
      antInfoOne = await cryptoAnts.getAntInfo(oneUserAntId);
      const txOne = await cryptoAnts.connect(userOne).sellAnt(oneUserAntId);

      // if the events are emitted, all is ok
      expect(txZero).to.emit(cryptoAnts, 'AntSold()');
      expect(txOne).to.emit(cryptoAnts, 'AntSold()');
    });

    it('both users should have 100 eggs starting with only 1 initial egg', async () => {
      // define variables
      const oneHundred = BigNumber.from(100);
      const layEggsPeriod = await cryptoAnts.MIN_LAY_PERIOD();

      // get ants balances
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

      // get balances after
      const zeroAntsBalanceAf = await cryptoAnts.balanceOf(userZero.address);
      const oneAntsBalanceAf = await cryptoAnts.balanceOf(userOne.address);

      // make assertions
      expect(zeroAntsBalanceAf).to.be.equal(oneHundred);
      expect(oneAntsBalanceAf).to.be.equal(oneHundred);
    });

    it('should update the ant state correctly after an ant trasnfer between users', async () => {
      // buy egg
      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });

      // create ant
      await cryptoAnts.connect(userZero).createAnt();
      const [antId] = await cryptoAnts.getOwnerAntIds(userZero.address);

      // transfer ant by its ant id
      const tx = await cryptoAnts.connect(userZero).transferFrom(userZero.address, userOne.address, antId);

      // get users info
      const [userZeroId] = await cryptoAnts.getOwnerAntIds(userZero.address);

      const userOneIds = await cryptoAnts.getOwnerAntIds(userOne.address);

      const [antOwner, antIdx] = await cryptoAnts.getAntInfo(antId);

      // make assertions checking the state is correctly updated
      expect(userZeroId).to.be.equal(0);
      expect(userOneIds.length).to.be.equal(1);
      expect(userOneIds[0]).to.be.equal(antId);
      expect(antOwner).to.be.equal(userOne.address);
      expect(antIdx).to.be.equal(0);
    });

    it('2 users should be able to propose, approve and reject dao proposals', async () => {
      // define proposal status enum
      enum Status {
        Pristine,
        Pending,
        Current,
      }

      // buy an egg from 2 users
      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });
      await cryptoAnts.connect(userOne).buyEggs({ value: eggPrice });

      // propose new price user zero
      const zeroProposedPrice = eggPrice.mul(2);
      await cryptoAnts.connect(userZero).proposeEggPrice(zeroProposedPrice);

      // get proposed prices array
      let proposedPrices = await cryptoAnts.getProposalPrices();

      // get last price proposed from the array
      let proposalPrice = proposedPrices[proposedPrices.length - 1];

      // user zero approves his proposal
      await cryptoAnts.connect(userZero).approveProposal(proposalPrice);

      // advance time for finishing the proposal period
      const proposalPeriod = await cryptoAnts.proposalPeriod();
      await advanceTimeAndBlock(proposalPeriod.toNumber() + 1);

      // but user one doesn't approves, so the proposal won't pass since the voting power is divided 50/50 between them
      await cryptoAnts.connect(userZero).executeProposal(proposalPrice);

      // price should be the same since nothing changed
      const eggPriceContract = await cryptoAnts.eggPrice();
      expect(eggPriceContract).to.be.equal(eggPrice);

      // user one proposed another price
      const oneProposedPrice = eggPrice.div(2);
      await cryptoAnts.connect(userOne).proposeEggPrice(oneProposedPrice);

      // get proposed prices array
      proposedPrices = await cryptoAnts.getProposalPrices();

      // find proposed price idx in the proposed prices array
      proposalPrice = proposedPrices[proposedPrices.length - 1];

      // and both users approve it
      await cryptoAnts.connect(userZero).approveProposal(proposalPrice);
      await cryptoAnts.connect(userOne).approveProposal(proposalPrice);

      // advance time for finishing the proposal period
      await advanceTimeAndBlock(proposalPeriod.toNumber() + 1);

      // execute proposal, price should be updated since proposal is totally aproved
      await cryptoAnts.connect(userZero).executeProposal(proposalPrice);

      // get new price and proposal info
      const newEggPrice = await cryptoAnts.eggPrice();
      const [, , proposalStatus] = await cryptoAnts.getProposalInfo(proposalPrice);

      // make assertions
      expect(newEggPrice).to.be.equal(oneProposedPrice);
      expect(proposalStatus).to.be.equal(Status.Pristine);
    });

    it('should lay 2 eggs correctly when the 2 request were executed before the first randomness exec', async () => {
      const one = BigNumber.from(1);

      // buy an egg with both users
      await cryptoAnts.connect(userZero).buyEggs({ value: eggPrice });
      await cryptoAnts.connect(userOne).buyEggs({ value: eggPrice });

      // create an ant with both users
      await cryptoAnts.connect(userZero).createAnt();
      await cryptoAnts.connect(userOne).createAnt();

      // get first ant id of both users id's arrays
      const [zeroUserAntId] = await cryptoAnts.getOwnerAntIds(userZero.address);
      const [oneUserAntId] = await cryptoAnts.getOwnerAntIds(userOne.address);

      // lay eggs user zero
      let tx = await cryptoAnts.connect(userZero).layEggs(zeroUserAntId);
      const txReceiptZero = await tx.wait();

      // lay eggs user one
      tx = await cryptoAnts.connect(userOne).layEggs(oneUserAntId);
      const txReceiptOne = await tx.wait();

      // we execute the mock randomness
      if (!txReceiptZero.events || !txReceiptZero.events[1].args) {
        throw new Error('Bad reading of events');
      }
      let requestId = txReceiptZero.events[1].args.requestId;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

      // we execute the mock randomness
      if (!txReceiptOne.events || !txReceiptOne.events[1].args) {
        throw new Error('Bad reading of events');
      }
      requestId = txReceiptOne.events[1].args.requestId;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

      const eggsUserZero = await egg.balanceOf(userZero.address);
      const eggsUserOne = await egg.balanceOf(userOne.address);

      logger.info('aa');
      expect(eggsUserZero).to.be.gte(one);
      logger.info('bb');
      expect(eggsUserOne).to.be.gte(one);
      logger.info('cc');

      // get users info
      // let antInfoZero = await cryptoAnts.getAntInfo(zeroUserAntId);
      // let antInfoOne = await cryptoAnts.getAntInfo(oneUserAntId);
      // const txZero = await cryptoAnts.connect(userZero).sellAnt(zeroUserAntId);

      // antInfoZero = await cryptoAnts.getAntInfo(zeroUserAntId);
      // antInfoOne = await cryptoAnts.getAntInfo(oneUserAntId);
      // const txOne = await cryptoAnts.connect(userOne).sellAnt(oneUserAntId);
    });
  });
});
