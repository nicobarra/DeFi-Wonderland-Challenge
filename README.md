# DeFi Wonderland Challenge

This repo is the solution which I came up for the DeFi Wonderland `CryptoAnts` challenge. Here you have the table of contents with my solution, and the statement of the challenge.

### Table of Contents

- [DeFi Wonderland Challenge](#defi-wonderland-challenge)
  - [Table of Contents](#table-of-contents)
  - [Solution](#solution)
  - [Challenges](#challenges)
  - [Running the repo](#running-the-repo)
  - [Deploying the contracts](#deploying-the-contracts)
  - [Verification](#verification)
- [DeFi Wonderland Challenge Statement](#defi-wonderland-challenge-statement)
  - [Assignment](#assignment)
  - [Extra points](#extra-points)
  - [Running the repo](#running-the-repo-1)
  - [Running the tests](#running-the-tests)
  - [Deploying the contracts](#deploying-the-contracts-1)

### Solution

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

![first-diagram](https://user-images.githubusercontent.com/71539596/188253430-31efcc66-0569-4c13-b925-ffa6975c68a5.png)

The `CryptoAnts` DAO related funcitons and logic:

![second-diagram](https://user-images.githubusercontent.com/71539596/188253419-706db382-713a-458a-9e9b-dad6467d5ac0.png)

### Challenges

The most difficult to me at the moment of completing this challenge, was to manage the logic with VRF V2 of Chainlink.

Because you have to ask for randomness to the VRF and it returns the random number to a function. So I could not execute directly the function for laying an egg and getting if the ant dies or not.

I wanted to keep the most decentralized and trustless as possible, so I did not use an off-chain that get the randomness and executes the function.
So, I had to use a 2 incremental state variables in both `layEgss()` and `_layEggs()` funcs with a mapping linking each incremental number with its `antId`. The purpose of this is for always respecting the order in which the ants where requested to lay, independently of the delay on randomness execution. (because the VRF executes `fulfillRandomWords` function only with the random number but you cannot pass params).

Also mocking the VRF and then testing in `goerli` testnet took a lot of time. If you Robert are reading this, when you comeback from ~~Ibiza~~ your Mom's home, we could discuss if is possible to create another system for getting randomness easier ... ;) .

### Running the repo

Here's a brief guide as to how run this repo.

- First, you can fork the repo, or clone it:

```
git clone git@github.com:NicoBarragan/DeFi-Wonderland-Challenge.git
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

### Verification

Both contracts are already verified in `goerli` network:

- `CryptoAnts`: https://goerli.etherscan.io/address/0x395425a5425bB727F52D28A19da2C2e76c5cE72C#code

- `Egg`: https://goerli.etherscan.io/address/0x703e6006C6e3EDBc665b2B0b7dc7CC29fb47E7f5#code

---

# DeFi Wonderland Challenge Statement

Ooooh no! Robert, our lead developer had an urgent flight and left us with an unfinished game.

Hey you, yes **YOU**, are you a developer?! Do you know some Solidity? Could you please help us finish this game?

This is the note he left us:

> Hey guys, sorry but I had an urgent thing to attend to with some ~~friends~~ family.
> The game is **almost** there but I didn't have time to test or organize the code properly. I also didn't have time to read the logic twice to see if I missed something.
>
> Oh, here's the status of the thingies we've discussed:
>
> - [x] EGGs should be ERC20 tokens
> - [x] EGGs should be indivisable
> - [x] ANTs should be ERC721 tokens (**NFTs**)
> - [x] Users can buy EGGs with ETH
> - [x] EGGs should cost 0.01 ETH
> - [x] An EGG can be used to create an ANT
> - [x] An ANT can be sold for less ETH than the EGG price
> - [ ] Governance should be able to change the price of an egg
> - [ ] Finish the e2e tests
>
> The following features we said they would be nice to have, but were not required, so i guess they're out of the equation for now...
>
> - [ ] Ants should be able to create/lay eggs once every 10 minutes
> - [ ] Ants should be able to randomly create multiple eggs at a time. The range of how many should be reasonable (0-20?)
> - [ ] Ants have a % chance of dying when creating eggs
>
> I feel very proud of it, I can't wait to come back from ~~Ibiza~~ Mom's to play it!
> Good news is that Robert implemented at least some of this before leaving:

ANT `ERC721` https://ropsten.etherscan.io/address/0x647Fdb71eEA4f9A94E14964C40027718C931bEe5#writeContract
EGG `ERC20`
https://ropsten.etherscan.io/address/0xFE17174Bca5168a5179AE8Df8f865DbF9c771776#code

### Assignment

We would need your help in finishing what Robert started. We hardly think he's going to come back soon, so we should start thinking on hiring somebody to cover his place.

Please fork or clone [Robert's Repo](https://github.com/Billy-103/ants-challenge) and as soon as you have gone through the code and implemented the changes you thought were appropiate along with the features, send it to us.

You will find a short guide with instructions to run this repo in the `README.md` file. If you have **any** question, please don't hesitate to contact us , we are here for that and we encourage it!

Just in case, Robert seemed a bit distracted when working on the game, it may be a good idea to take a close look at what he did. **There are more than 20 audited issues in the code he's made**, we would appreciate if you can spot them and deploy an improved version of it.

Best of lucks, and get ready to go fully anon and deep **down the rabbit hole**!

#

### Extra points

Oh! And send us as much ANTs as you can to 0x7D4BF49D39374BdDeB2aa70511c2b772a0Bcf91e, we are building an army!

#

### Running the repo

Here's a brief guide as to how run this repo.

- First, you can fork the repo, or clone it:

```
git clone https://github.com/Billy-103/ants-challenge
cd ants-challenge
yarn install
```

That should install all we need. What we need now is an API key from an RPC provider, so create an account in https://www.alchemy.com/ and grab generate an API key. Then you should create a `.env` file and complete it using the `.env.example` file we provide as as a guide.

We highly discourage using accounts that may hold ETH in mainnet, to avoid any unnecessary errors. So even if you have an ETH account, we recommend creating a new one in https://vanity-eth.tk/ for having an badass name like: 0xBadA55ebb20DCf99F56988d2A087C4D2077fa62d.

If you don't hold ETH in Ropsten, don't worry! People are very generous there, you can head to a faucet: https://faucet.ropsten.be/ and just ask for some! Crazy huh?

After you have your `.env` all set up, you're ready to go.

### Running the tests

```
yarn test
```

### Deploying the contracts

To deploy and verify the contracts, you can run:

```jsx
npx hardhat deploy --network <network_name>
```

We highly recommend passing in ropsten as the test network, like this:

```jsx
npx hardhat deploy --network ropsten
```

The verification of the contracts may take a couple of minutes, so be aware of that if it seems that your terminal got stuck.
