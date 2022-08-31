import { expect, use } from 'chai';
import { ethers } from 'hardhat';
import { ContractTransaction, utils } from 'ethers';
import { waffleChai } from '@ethereum-waffle/chai';
import { CryptoAnts, CryptoAnts__factory, Egg, Egg__factory } from '@typechained';
import { evm } from '@utils';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
import { deployVRFv2Mock, KEY_HASH, CALLBACK_GAS_LIMIT } from '../utils/vrf-mock';
const logger = require('pino')();
use(waffleChai);

const FORK_BLOCK_NUMBER = 11298165;

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

  // misc
  let eggPrecalculatedAddress: string;
  let snapshotId: string;

  before(async () => {
    // forking mainnet
    await evm.reset({
      jsonRpcUrl: process.env.RPC_ROPSTEN,
      blockNumber: FORK_BLOCK_NUMBER,
    });

    // getting signers with ETH
    [, deployer, randomUser] = await ethers.getSigners();

    // precalculating egg's contract address as both cryptoAnts' contract and Eggs' contract depend on
    // one another
    const currentNonce = await ethers.provider.getTransactionCount(deployer.address);
    eggPrecalculatedAddress = utils.getContractAddress({ from: deployer.address, nonce: currentNonce });

    // deploying VRF V2 Mock contract
    const { vrfMockAddress, subscriptionId } = await deployVRFv2Mock();

    // deploying CryptoAnts and Egg contracts
    cryptoAntsFactory = (await ethers.getContractFactory('CryptoAnts')) as CryptoAnts__factory;
    cryptoAnts = await cryptoAntsFactory.deploy(eggPrecalculatedAddress, vrfMockAddress, KEY_HASH, subscriptionId, CALLBACK_GAS_LIMIT);

    eggFactory = (await ethers.getContractFactory('Egg')) as Egg__factory;
    egg = await eggFactory.connect(deployer).deploy(cryptoAnts.address);

    // snapshot
    snapshotId = await evm.snapshot.take();
  });

  beforeEach(async () => {
    await evm.snapshot.revert(snapshotId);
  });

  describe('Robert e2e test proposed', () => {
    it('should only allow the CryptoAnts contract to mint eggs', async () => {
      const eggValue = await cryptoAnts.eggPrice();
      const antTx = await cryptoAnts.connect(randomUser).buyEggs({ value: eggValue });

      // if emits the event, the tx was successful
      expect(antTx).to.emit(cryptoAnts, 'EggsBought');
      // I didn't implemented 'calledOn' matchers because provider doesn;t support call history

      await expect(egg.connect(randomUser).mint(randomUser.address, eggValue)).to.be.revertedWith(
        `OnlyAnts("${cryptoAnts.address}", "${randomUser.address}")`
      );
    });

    it('should buy an egg and create a new ant with it');

    it('should send funds to the user who sells an ant');

    it('should burn the ant after the user sells it');

    /*
    This is a completely optional test.
    Hint: you may need advanceTimeAndBlock (from utils) to handle the egg creation cooldown
  */
    it('should be able to create a 100 ants with only one initial egg');
  });

  describe('Other useful unit tests', () => {
    it('should have the correct eggs contract address', async () => {
      const eggsFromAntsContract = await cryptoAnts.eggs();

      expect(eggsFromAntsContract).to.be.equal(egg.address);
    });
  });
});
