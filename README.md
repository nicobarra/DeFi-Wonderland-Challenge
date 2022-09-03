# DeFi Wonderland Challenge

Hey! don't worry about Robert, I think I have a solution that could work...

I came up with a `CryptoAnts` contract that ables users to buy eggs, create ants, lay eggs from ants and sell ants.

This contract accomplishes all the requested features, including the optional ones:

- Governance can change the egg price
- Is fully tested, with 25 tests successfully passed (including those asked and 1 e2e test in a testnet)
- Ants have a waiting period for each time they lay an egg (is set in the constructor, is not a 10 minutes contstant because I needed it to be shorter while testing on a testnet)
- The ants have 50% probabilities of randomly create 2 eggs.
- Ants can die when they lay an egg. Their health is 100, if a random number (1-30) multiplied by the half amount of the eggs layed is greater than their health, they will die.
- **Bonus**: I have already sent to the address `0x7D4BF49D39374BdDeB2aa70511c2b772a0Bcf91e` some ants like you requested :)

These are the Sequences diagrams that I create in order to show better thw contract functions:

The `CryptoAnts` contract eggs and ants logic:

![CryptoAnts-ants-and-eggs-logic](images/first-diagram.png)

The `CryptoAnts` DAO related funcitons and logic:

![CryptoAnts-dao-logic](images/second-diagram.png)

### Challenges

The most difficult to me at the moment of completing this challenge, was to manage the logic with VRF V2 of Chainlink.

Because you have to ask for randomness to the VRF and it returns the random number to a function. So I could not execute directly the function for laying an egg and getting if the ant dies or not.

I wanted to keep the most decentralized and trustless as possible, so I did not use an off-chain that get the randomness and executes the function.
So, I had to use a 'queue' array with the ants id's for laying an egg, in for the function `_layEggs()` to be able to read the state from storage and know which ant is supposed to lay an egg (because the VRF executes `fulfillRandomWords` function only with the random number but you cannot pass params.

Also mocking the VRF and then testing in `goerli` testnet took a lot of time. If you Robert are reading this, when you comeback from ~~Ibiza~~ your Mom's home, we could discuss if is possible to create another system for getting randomness easier ... ;) .

### Running the repo

Here's a brief guide as to how run this repo.

- First, you can fork the repo, or clone it:

```
git clone https://github.com/Billy-103/ants-challenge
cd ants-challenge
yarn install
```

That should install all we need.

For running local tests (24 tests divided in 4 different files) you have to have an `RPC_GOERLI` provider https key in your `.env` file, and execute the followiing command for running all:
`yarn test`

This is my result when running the command:

All 23 tests are passing, it took 17 seconds in my local for completing all.

For running the stagging test, you have to have all the `.env` variables completed (in exception with `ETHERSCAN_API_KEY` that is optional),
and execute the followiing command for running all:
`yarn hardhat test/stagging/crypto-ants-stag.test.ts --network <network_name>`

This is my result when running the command:

The staggin test passed too, be prepared with `MOCHA_TIMEOUT` variable if you want to run it because it took 4 minutes when I executed.

### Deploying the contracts

To deploy and verify the contracts, you can run:

```jsx
npx hardhat deploy --network <network_name>
```

or you also can execute the `deploy-ants-egg`. I prepared it for `goerli` with the `.env` files, you can execute it in this network by running:

`yarn hardhat run deploy/goerli/deploy-ants-egg.ts --network goerli`

### Verification:

Both contracts are already verified in `goerli` network:

- `CryptoAnts`: https://goerli.etherscan.io/address/0x503643ce980296975206DF47F38eade190b72515#code

- `Egg`: https://goerli.etherscan.io/address/0xbce679904C90C65b5decd9a00460Ec049b0C78cD#code
