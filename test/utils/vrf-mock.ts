import { ethers, network } from 'hardhat';
import { BigNumber } from 'ethers';
import { VRFCoordinatorV2Mock, VRFCoordinatorV2Mock__factory } from '@typechained';
const logger = require('pino')();

// define constants
const CALLBACK_GAS_LIMIT = BigNumber.from('500000');
const KEY_HASH = '0xd89b2bf150e3b9e13446986e571fb9cab24b13cea0a43ea20a6049a85cc807cc';

// const for deploying the vrf2 coordinator
const BASE_FEE = ethers.utils.parseEther('0.25'); // 0.25 is the premium. It costs 0.25 LINK per request
const GAS_PRICE_LINK = 1e9;

// script for deploy
const deployVRFv2Mock = async () => {
  if (network.name !== ('hardhat' || 'localhost')) {
    logger.warn('This script is for a local network only');
    process.exitCode = 1;
  }

  // deploy and get mock contract
  const vrfCoordinatorV2Mock = (await ethers.getContractFactory('VRFCoordinatorV2Mock')) as VRFCoordinatorV2Mock__factory;
  const vrfCoordinatorV2contract = (await vrfCoordinatorV2Mock.deploy(BASE_FEE, GAS_PRICE_LINK)) as VRFCoordinatorV2Mock;
  await vrfCoordinatorV2contract.deployed();

  // create subscription
  let subscriptionId;
  const tx = await vrfCoordinatorV2contract.createSubscription();
  const txReceipt = await tx.wait(1); // This receives the events emitted in the tx

  const events = txReceipt.events;
  if (events && events[0].args) {
    subscriptionId = events[0].args.subId;
  }

  // Fund subscription
  const subFundAmount = ethers.utils.parseEther('2');
  await vrfCoordinatorV2contract.fundSubscription(subscriptionId, subFundAmount);

  const vrfMockAddress = vrfCoordinatorV2contract.address;
  return { vrfMockAddress, subscriptionId };
};

// for the e2e test in a forked chain purposals
export { deployVRFv2Mock, KEY_HASH, CALLBACK_GAS_LIMIT };
