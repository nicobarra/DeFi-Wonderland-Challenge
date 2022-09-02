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

describe('CryptoAnts-Errors', function () {
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

  describe('errors tests', () => {
    it('buyEggs should revert with NoEggs() error', async () => {
      await expect(cryptoAnts.connect(randomUser).buyEggs({ value: 0 })).to.be.revertedWith('NoEggs()');
    });

    it('createAnt should revert with NoEggs() error when there eggs balance is 0', async () => {
      await expect(cryptoAnts.connect(randomUser).createAnt()).to.be.revertedWith('NoEggs()');
    });

    it('sellAnt should revert with NotAntOwner() error when ant exists but is from other owner', async () => {
      const [, userTwo] = await ethers.getSigners();

      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).createAnt();
      const [randomUserAntId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      await expect(cryptoAnts.connect(userTwo).sellAnt(randomUserAntId)).to.be.revertedWith('NotAntOwner()');
    });

    it('sellAnt should revert with NotAntOwner() error when ant doesnt exist', async () => {
      const inexistenAntId = 10;
      await expect(cryptoAnts.connect(randomUser).sellAnt(inexistenAntId)).to.be.revertedWith('NotAntOwner()');
    });

    it('layEggs should revert with NotAntOwner() error when ant exists but is from other owner', async () => {
      const [, userTwo] = await ethers.getSigners();

      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).createAnt();
      const [randomUserAntId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      await expect(cryptoAnts.connect(userTwo).layEggs(randomUserAntId)).to.be.revertedWith('NotAntOwner()');
    });

    it('layEggs should revert with NotAntOwner() error when ant doesnt exist', async () => {
      const inexistenAntId = 10;
      await expect(cryptoAnts.connect(randomUser).layEggs(inexistenAntId)).to.be.revertedWith('NotAntOwner()');
    });

    it('sellAnt should revert with NoAnt() error when ant is dead', async () => {
      const minLayPeriod = await cryptoAnts.MIN_LAY_PERIOD();
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).createAnt();
      const [antId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      let { isAlive } = await cryptoAnts.getAntInfo(antId);
      let antIsAlive = isAlive;
      logger.info(`antIsAlive: ${antIsAlive}`);
      while (antIsAlive) {
        const tx = await cryptoAnts.connect(randomUser).layEggs(antId);
        const txReceipt = await tx.wait();

        // we execute the mock randomness
        if (!txReceipt.events || !txReceipt.events[1].args) {
          throw new Error('Bad reading of events');
        }
        const requestId = txReceipt.events[1].args.requestId;
        await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

        advanceTimeAndBlock(minLayPeriod.toNumber() + 1);

        let { isAlive } = await cryptoAnts.getAntInfo(antId);
        antIsAlive = isAlive;
        logger.info(`antIsAlive: ${antIsAlive}`);
      }

      await expect(cryptoAnts.connect(randomUser).sellAnt(antId)).to.be.revertedWith('NoAnt()');
    });

    it('layEggs should revert with NoAnt() error when ant is dead', async () => {
      const minLayPeriod = await cryptoAnts.MIN_LAY_PERIOD();

      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).createAnt();
      const [antId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      let { isAlive } = await cryptoAnts.getAntInfo(antId);
      let antIsAlive = isAlive;
      logger.info(`antIsAlive: ${antIsAlive}`);
      while (antIsAlive) {
        const tx = await cryptoAnts.connect(randomUser).layEggs(antId);
        const txReceipt = await tx.wait();

        // we execute the mock randomness
        if (!txReceipt.events || !txReceipt.events[1].args) {
          throw new Error('Bad reading of events');
        }
        const requestId = txReceipt.events[1].args.requestId;
        await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

        advanceTimeAndBlock(minLayPeriod.toNumber() + 1);

        let { isAlive } = await cryptoAnts.getAntInfo(antId);
        antIsAlive = isAlive;
        logger.info(`antIsAlive: ${antIsAlive}`);
      }

      await expect(cryptoAnts.connect(randomUser).layEggs(antId)).to.be.revertedWith('NoAnt()');
    });

    it('should revert with NotEnoughTimePassed() error', async () => {
      const layPeriod = await cryptoAnts.MIN_LAY_PERIOD();
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      await cryptoAnts.connect(randomUser).createAnt();
      const [AntId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      const tx = await cryptoAnts.connect(randomUser).layEggs(AntId);
      const txReceipt = await tx.wait();

      // we execute the mock randomness
      if (!txReceipt.events || !txReceipt.events[1].args) {
        throw new Error('Bad reading of events');
      }
      const requestId = txReceipt.events[1].args.requestId;
      await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

      await expect(cryptoAnts.connect(randomUser).layEggs(AntId)).to.be.revertedWith('NotEnoughTimePassed()');
    });
  });
});
