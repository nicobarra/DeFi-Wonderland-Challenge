import { ethers, network } from 'hardhat';
import { BigNumber } from 'ethers';
import { VRFCoordinatorV2Mock, VRFCoordinatorV2Mock__factory } from '@typechained';
const logger = require('pino')();

// define constants
const CALLBACK_GAS_LIMIT = BigNumber.from('2500000');
const KEY_HASH = '0x79d3d8832d904592c0bf9818b621522c988bb8b0c05cdc3b15aea1b6e8db0c15';

// const for deploying the vrf2 coordinator
const BASE_FEE = ethers.utils.parseEther('0.25'); // 0.25 is the premium. It costs 0.25 LINK per request
const GAS_PRICE_LINK = 1e9;
let subscriptionId: BigNumber;

// script for deploy
const deployVRFv2Mock = async (): Promise<VRFCoordinatorV2Mock> => {
  if (network.name !== ('hardhat' || 'localhost')) {
    logger.warn('This script is for a local network only');
    process.exitCode = 1;
  }

  // deploy and get mock contract
  const vrfCoordinatorV2Mock = (await ethers.getContractFactory('VRFCoordinatorV2Mock')) as VRFCoordinatorV2Mock__factory;
  const vrfCoordinatorV2contract = (await vrfCoordinatorV2Mock.deploy(BASE_FEE, GAS_PRICE_LINK)) as VRFCoordinatorV2Mock;
  await vrfCoordinatorV2contract.deployed();

  // create subscription
  const tx = await vrfCoordinatorV2contract.createSubscription();
  const txReceipt = await tx.wait(1); // This receives the events emitted in the tx

  const events = txReceipt.events;
  if (events && events[0].args) {
    subscriptionId = events[0].args.subId;
    logger.info(`subscriptionId: ${subscriptionId}`);
  }

  // Fund subscription
  const subFundAmount = ethers.utils.parseEther('2000');
  await vrfCoordinatorV2contract.fundSubscription(subscriptionId, subFundAmount);

  return vrfCoordinatorV2contract;
};

// for the e2e test in a forked chain purposals
export { deployVRFv2Mock, KEY_HASH, CALLBACK_GAS_LIMIT, subscriptionId };
