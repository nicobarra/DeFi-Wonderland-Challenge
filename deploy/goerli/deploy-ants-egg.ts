import { ethers, network } from 'hardhat';
import { BigNumber } from 'ethers';
import { CryptoAnts__factory, Egg__factory } from '@typechained';
const logger = require('pino')();

if (network.name !== 'goerli') {
  throw new Error('Script works only in goerli network');
}

const { VRF_CCORDINATORV2_GOERLI, KEY_HASH_GOERLI, SUBSCRIPTION_ID_GOERLI, CALLBACK_GAS_LIMIT, PROPOSAL_PERIOD } = process.env;

if (!VRF_CCORDINATORV2_GOERLI || !KEY_HASH_GOERLI || !SUBSCRIPTION_ID_GOERLI || !CALLBACK_GAS_LIMIT) {
  throw new Error('Missing information');
}
const deploy = async (proposalPeriod: string) => {
  const [user] = await ethers.getSigners();

  const cryptoAntsFactory = (await ethers.getContractFactory('CryptoAnts')) as CryptoAnts__factory;
  const eggFactory = (await ethers.getContractFactory('Egg')) as Egg__factory;

  const egg = await eggFactory.deploy();
  await egg.deployed();
  logger.info(`egg address: ${egg.address}`);

  const cryptoAnts = await cryptoAntsFactory.deploy(
    egg.address,
    VRF_CCORDINATORV2_GOERLI,
    KEY_HASH_GOERLI,
    SUBSCRIPTION_ID_GOERLI,
    BigNumber.from(CALLBACK_GAS_LIMIT),
    BigNumber.from(proposalPeriod)
  );
  await cryptoAnts.deployed();
  logger.info(`cryptoAnts address: ${cryptoAnts.address}`);

  logger.info(`egg owner before: ${await egg.owner()}`);
  logger.info('Transferring ownership ...');
  const tx = await egg.transferOwnership(cryptoAnts.address);
  await tx.wait();
  logger.info(`Ownership Transferred, the new owner is: ${await egg.owner()}`);
};

(async () => {
  let proposalPeriod = PROPOSAL_PERIOD;
  if (!proposalPeriod) {
    proposalPeriod = '60'; //60 secs
  }

  await deploy(proposalPeriod);
})();
