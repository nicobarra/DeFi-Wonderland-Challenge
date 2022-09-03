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

  /**  @notice
   * chai matchers for token or ether balance changes were not implemented since they do not work correctly
   * 'calledOn' matchers were not implemented since the provider does not support
   */

  describe('Robert e2e test proposed', () => {
    it('should only allow the CryptoAnts contract to mint eggs', async () => {
      // buy an egg (cryptoAnts contract executes mint method in egg contract)
      const antTx = await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      // if emits the event, the tx was successful
      expect(antTx).to.emit(cryptoAnts, 'EggsBought');

      // assert executing directly egg from user fails
      await expect(egg.connect(randomUser).mint(randomUser.address, eggPrice)).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('should buy an egg and create a new ant with it', async () => {
      const one = BigNumber.from(1);

      // buy an egg
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });
      const antsBalanceBef = await cryptoAnts.balanceOf(randomUser.address);

      // create an ant
      await cryptoAnts.connect(randomUser).createAnt();
      const antsBalanceAf = await cryptoAnts.balanceOf(randomUser.address);

      // assert the balances were updated correctly
      expect(antsBalanceAf.sub(antsBalanceBef)).to.be.equal(one);
    });

    it('should send funds to the user who sells an ant', async () => {
      // buy an egg
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      // create an ant
      await cryptoAnts.connect(randomUser).createAnt();
      // get first user ant id from array
      const [userAntId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      // get user gas balance
      const userEthBalanceBef = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceBef: ${userEthBalanceBef}`);

      // sell an ant
      const sellTx = await cryptoAnts.connect(randomUser).sellAnt(userAntId);
      const receiptTx = await sellTx.wait();

      // get gas used for post calculations
      const gasUsed = receiptTx.gasUsed;
      logger.info(`gasUsed: ${gasUsed}`);

      // get user gas balance before executing all tx's
      const userEthBalanceAf = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceAf : ${userEthBalanceAf}`);

      // assert the user received the ETH amount for the sold ant
      expect(userEthBalanceAf.add(gasUsed)).to.be.gt(userEthBalanceBef);
    });

    it('should burn the ant after the user sells it', async () => {
      // define variables
      const zero = BigNumber.from(0);

      // buy an egg
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      // create an ant
      await cryptoAnts.connect(randomUser).createAnt();
      // get first user ant id from array
      const [userAntId] = await cryptoAnts.getOwnerAntIds(randomUser.address);

      // get user gas balance
      const userEthBalanceBef = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceBef: ${userEthBalanceBef}`);

      // sell ant
      const sellTx = await cryptoAnts.connect(randomUser).sellAnt(userAntId);
      const receiptTx = await sellTx.wait();

      // get gas used
      const gasUsed = receiptTx.gasUsed;
      logger.info(`gasUsed: ${gasUsed}`);

      // get gas balance after executing all tx's
      const userEthBalanceAf = await ethers.provider.getBalance(randomUser.address);
      logger.info(`userEthBalanceAf : ${userEthBalanceAf}`);
      const antsBalanceAf = await cryptoAnts.balanceOf(randomUser.address);
      // get ant is alive info (should be zero since doesn't exist anymore)
      const [, , antIsAlive] = await cryptoAnts.getAntInfo(userAntId);

      expect(antsBalanceAf).to.be.equal(zero);
      expect(antIsAlive).to.be.false;
    });
    /*
    This is a completely optional test.
    Hint: you may need advanceTimeAndBlock (from utils) to handle the egg creation cooldown
  */
    it('should be able to create a 100 ants with only one initial egg', async () => {
      // define variables
      const oneHundred = BigNumber.from(100);
      const layEggsPeriod = await cryptoAnts.MIN_LAY_PERIOD();
      let antsBalance = await cryptoAnts.balanceOf(randomUser.address);

      // buy an egg
      await cryptoAnts.connect(randomUser).buyEggs({ value: eggPrice });

      // start loop for getting 100 ants from the egg bought
      let i;
      for (i = 0; antsBalance.lt(100); i++) {
        logger.info(i);
        // create ant
        await cryptoAnts.connect(randomUser).createAnt();

        // get last ant id
        const userAntsId = await cryptoAnts.getOwnerAntIds(randomUser.address);
        const antId = userAntsId[userAntsId.length - 1]; // always gets the last for assuring is not dead

        // lay egg from ant
        const tx = await cryptoAnts.connect(randomUser).layEggs(antId);
        const txReceipt = await tx.wait();

        // get request id for VRF exec
        if (!txReceipt.events || !txReceipt.events[1].args) {
          throw new Error('Bad reading of events');
        }
        const requestId = txReceipt.events[1].args.requestId;
        // mock VRF for randomness with the requestId
        await vrfCoordinatorV2Mock.fulfillRandomWords(requestId, cryptoAnts.address);

        // update ants balance
        antsBalance = await cryptoAnts.balanceOf(randomUser.address);

        // advance time period that the ant needs for lay an egg again
        await advanceTimeAndBlock(layEggsPeriod.toNumber() + 1);
      }

      // expect ants balance to be one hundred
      expect(antsBalance).to.be.equal(oneHundred);
    });
  });
});
