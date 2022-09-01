//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import './interfaces/IEgg.sol';

contract Egg is Ownable, ERC20, IEgg {
  // solhint-disable-next-line
  constructor() ERC20('EGG', 'EGG') {}

  modifier notZeroAddress(address tokenAddr) {
    if (tokenAddr == address(0)) revert NoZeroAddress();
    _;
  }

  function mint(address _to, uint256 _amount) external override onlyOwner {
    _mint(_to, _amount);
  }

  function burn(address _from, uint256 _amount) external override onlyOwner {
    // only an ant can be created with a single egg per time
    _burn(_from, _amount);
  }

  function decimals() public view virtual override returns (uint8) {
    return 0;
  }
}
