import { expect, use } from 'chai';
import { ethers, network } from 'hardhat';
import { BigNumber, ContractTransaction } from 'ethers';
import { waffleChai } from '@ethereum-waffle/chai';
import { CryptoAnts, Egg } from '@typechained';
import { delay } from '../../helpers/delay';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signers';
const logger = require('pino')();
use(waffleChai);

// get constants
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
      // get signer
      [user] = await ethers.getSigners();

      // get egg and cryptoAnts contracts
      cryptoAnts = (await ethers.getContractAt('CryptoAnts', CRYPTO_ANTS_ADDRESS!)) as CryptoAnts;
      egg = await ethers.getContractAt('Egg', EGG_ADDRESS!);

      // get egg price
      eggPrice = await cryptoAnts.eggPrice();

      // get egg owner and egg address from ant contrac
      const eggOwner = await egg.owner();
      const eggFromAntsContract = await cryptoAnts.eggs();
      // assert they are correct
      expect(eggOwner).to.be.equal(cryptoAnts.address);
      expect(eggFromAntsContract).to.be.equal(egg.address);
    });

    it('should execute e2e methods', async () => {
      // define variables
      const zero = BigNumber.from(0);
      let tx: ContractTransaction;

      logger.info(`buying egg ...`);
      tx = await cryptoAnts.connect(user).buyEggs({ value: eggPrice, gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`egg bought!`);

      // firstly we are giong to make price cheaper so gas is enough for buying multiple eggs
      const newPrice = ethers.utils.parseEther('0.0023');
      logger.info(`Proposing new price..`);
      tx = await cryptoAnts.connect(user).proposeEggPrice(newPrice, { gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`New price proposed`);

      const proposalsIdsArr = await cryptoAnts.getProposalPrices();
      logger.info(`proposalsIdsArr: ${proposalsIdsArr}`);
      const proposalId = proposalsIdsArr[proposalsIdsArr.length - 1];
      logger.info(`proposalId: ${proposalId}`);

      logger.info(`Approving new price..`);
      tx = await cryptoAnts.connect(user).approveProposal(proposalId, { gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`New price approved`);

      logger.info(`Delaying period ...`);
      const period = await cryptoAnts.MIN_LAY_PERIOD();
      logger.info(`Period: ${period.toString()}`);
      await delay(period.toNumber() + 1);
      logger.info(`Period finished`);

      const propInfo = await cryptoAnts.getProposalInfo(proposalId);
      logger.info(`propInfo: ${propInfo[0]}, ${propInfo[1]}, ${propInfo[2]}, ${propInfo[3]}`);

      logger.info('Executing proposal ...');
      tx = await cryptoAnts.connect(user).executeProposal(proposalId, { gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info('Proposal executed!');

      eggPrice = await cryptoAnts.eggPrice();
      expect(eggPrice).to.be.equal(newPrice);

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

      // This for waiting the VRF to exec fulfillrandomness()
      logger.info(`delaying 120 secs ..`);
      await delay(60 * 2);
      logger.info(`120 secs delayed!`);

      // create and send some ants to the challenge address
      const antsToTransfer = BigNumber.from(2);
      logger.info(`antsToTransfer: ${antsToTransfer}`);
      const ethBalance = await ethers.provider.getBalance(user.address);
      logger.info(`ethBalance: ${ethBalance}`);
      const amount = eggPrice.mul(antsToTransfer);
      logger.info(`amount: ${amount}`);

      // buy the necessary eggs
      await cryptoAnts.connect(user).buyEggs({ value: antsToTransfer, gasLimit: GAS_LIMIT });

      // loop por creating and transfer the ants amount
      // create ant
      logger.info(`creating ant...`);
      tx = await cryptoAnts.connect(user).createAnt({ gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`Ant created`);

      // get last ant id
      const antIds = await cryptoAnts.getOwnerAntIds(user.address);
      const userAntId = antIds[antIds.length - 1];
      logger.info(`antId: ${userAntId}`);

      // transfer ant
      logger.info(`Transferring ant...`);
      tx = await cryptoAnts.connect(user).transferFrom(user.address, CHALLENGE_ADDRESS, userAntId, { gasLimit: GAS_LIMIT });
      await tx.wait();
      logger.info(`Ant transferred!`);

      // get balances, print some logs and make assertions
      const userEggsBalance = await egg.balanceOf(user.address);
      const userAntsBalance = await cryptoAnts.balanceOf(user.address);
      logger.info(`userEggsBalance: ${userEggsBalance}`);
      logger.info(`userAntsBalance: ${userAntsBalance}`);

      const challengeAntsBalance = await cryptoAnts.balanceOf(CHALLENGE_ADDRESS);
      const challengeEggsBalance = await egg.balanceOf(CHALLENGE_ADDRESS);
      logger.info(`challengeAntsBalance: ${challengeAntsBalance}`);
      logger.info(`challengeEggsBalance: ${challengeEggsBalance}`);

      expect(challengeEggsBalance).to.be.equal(zero);
      expect(challengeAntsBalance).to.be.gt(zero);
    });
  });
}
