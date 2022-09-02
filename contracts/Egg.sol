//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import './interfaces/IEgg.sol';

contract Egg is Ownable, ERC20, IEgg {
  // solhint-disable-next-line
  constructor() ERC20('EGG', 'EGG') {}

  // method for miting an egg 'amount' to '_to'. Restricted to the contract owner
  function mint(address _to, uint256 _amount) external override onlyOwner {
    _mint(_to, _amount);
  }

  // method for burning an egg 'amount' from '_from'. Restricted to the contract owner
  function burn(address _from, uint256 _amount) external override onlyOwner {
    _burn(_from, _amount);
  }

  // method for view the egg token decimals
  function decimals() public view virtual override returns (uint8) {
    // the egg token is indivisible so it returns 0
    return 0;
  }
}
