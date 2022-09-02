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

    it('2 users should have 50 eggs starting with only 1', async () => {});

    it('should update the ant state correctly after an ant trasnfer between users', async () => {});

    it('2 users should be able to propose, approve and reject dao proposals', async () => {});
  });
});
