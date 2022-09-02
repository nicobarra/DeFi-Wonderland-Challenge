import { expect, use } from 'chai';
import { ethers, network } from 'hardhat';
import { BigNumber, ContractTransaction, utils } from 'ethers';
import { waffleChai } from '@ethereum-waffle/chai';
import { CryptoAnts, Egg } from '@typechained';
import { delay } from '../../helpers/delay';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
const logger = require('pino')();
use(waffleChai);

const { CRYPTO_ANTS_ADDRESS, EGG_ADDRESS } = process.env;
const CHALLENGE_ADDRESS = '0x7D4BF49D39374BdDeB2aa70511c2b772a0Bcf91e';
const GAS_LIMIT = BigNumber.from(2040700);

if (network.name === 'hardhat') {
  describe.skip;
} else {
  describe('Stagging CryptoAnts', () => {
    // signers
    let user: SignerWithAddress;

    // contracts
    let cryptoAnts: CryptoAnts;
    let egg: Egg;

    // contract variables
    let eggPrice: BigNumber;

    before(async () => {
      [user] = await ethers.getSigners();

      cryptoAnts = (await ethers.getContractAt('CryptoAnts', CRYPTO_ANTS_ADDRESS!)) as CryptoAnts;
      egg = await ethers.getContractAt('Egg', EGG_ADDRESS!);

      eggPrice = await cryptoAnts.eggPrice();

      const eggOwner = await egg.owner();
      const eggFromAntsContract = await cryptoAnts.eggs();

      expect(eggOwner).to.be.equal(cryptoAnts.address);
      expect(eggFromAntsContract).to.be.equal(egg.address);
    });

    it('should execute e2e methods', async () => {
      const zero = BigNumber.from(0);
      const one = BigNumber.from(1);
      let tx: ContractTransaction;

      logger.info(`buying egg ...`);
      tx = await cryptoAnts.connect(user).buyEggs({ value: eggPrice, gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`egg boought!`);

      logger.info(`creating ant with the egg ...`);
      tx = await cryptoAnts.connect(user).createAnt({ gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`Ant created!`);

      const [antId] = await cryptoAnts.getOwnerAntIds(user.address);
      logger.info(`antId: ${antId}`);

      logger.info(`laying egg from ant ...`);
      tx = await cryptoAnts.connect(user).layEggs(antId, { gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`egg layed!`);

      // This for watiing the VRF to exec fulfillrandomness()
      logger.info(`delaying 120 secs ..`);
      await delay(60000 * 2);
      logger.info(`120 secs delayed!`);

      // creeate send some ants to the challenge address
      const antsToCreate = BigNumber.from(3);
      const ethBalance = await ethers.provider.getBalance(user.address);
      const amount = ethBalance.mul(antsToCreate);

      let antsBalance = await cryptoAnts.balanceOf(user.address);
      if (ethBalance > amount) {
        await cryptoAnts.connect(user).buyEggs({ value: antsToCreate });

        while (antsBalance.lt(antsToCreate)) {
          await cryptoAnts.connect(user).createAnt({ gasLimit: GAS_LIMIT });
        }
      }

      const eggsBalance = await egg.balanceOf(user.address);
      logger.info(`eggsBalance: ${eggsBalance}`);
      logger.info(`antsBalance: ${antsBalance}`);

      await cryptoAnts.connect(user).transferFrom(user.address, CHALLENGE_ADDRESS, antsBalance);
      const challengeAntsBalance = await cryptoAnts.balanceOf(CHALLENGE_ADDRESS);
      const challengeEggsBalance = await egg.balanceOf(CHALLENGE_ADDRESS);

      expect(antsBalance).to.be.equal(zero);
      expect(challengeEggsBalance).to.be.equal(zero);
      expect(challengeAntsBalance).to.be.equal(antsToCreate);
    });
  });
}
