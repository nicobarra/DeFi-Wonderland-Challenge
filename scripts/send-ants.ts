import { ethers, network } from 'hardhat';
import { CryptoAnts } from '@typechained';
const logger = require('pino')();

const { CRYPTO_ANTS_ADDRESS } = process.env;
const CHALLENGE_ADDRESS = '0x7D4BF49D39374BdDeB2aa70511c2b772a0Bcf91e';

(async () => {
  const [user] = await ethers.getSigners();

  const cryptoAnts = (await ethers.getContractAt('CryptoAnts', CRYPTO_ANTS_ADDRESS!)) as CryptoAnts;
  const eggPrice = await cryptoAnts.eggPrice();

  let ethBalance = await ethers.provider.getBalance(user.address);
  logger.info(`ethBalance: ${ethBalance}`);

  const balanceLimit = ethBalance.div(3);
  logger.info(`balanceLimit: ${balanceLimit}`);
  while (ethBalance < balanceLimit) {
    logger.info(`Buying egg..`);
    let tx = await cryptoAnts.connect(user).buyEggs({ value: eggPrice });
    await tx.wait();
    logger.info(`Egg bought!`);

    logger.info(`Creating ant...`);
    tx = await cryptoAnts.connect(user).createAnt();
    await tx.wait();
    logger.info(`Ant created`);

    let antsIds = await cryptoAnts.connect(user).getOwnerAntIds(user.address);
    logger.info(`antsIds: ${antsIds}`);
    let lastAntId = antsIds[antsIds.length - 1];
    logger.info(`lastAntId: ${lastAntId}`);

    logger.info(`Transferring ant...`);
    tx = await cryptoAnts.connect(user).transferFrom(user.address, CHALLENGE_ADDRESS, lastAntId);
    await tx.wait();
    logger.info(`Ant transferred!`);

    ethBalance = await ethers.provider.getBalance(user.address);
    logger.info(`ethBalance: ${ethBalance}`);
  }
})();
