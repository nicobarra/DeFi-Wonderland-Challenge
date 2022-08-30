//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './interfaces/IEgg.sol';

contract Egg is ERC20, IEgg {
  address private _ants;

  modifier onyAnts() {
    if (msg.sender != _ants) revert OnlyAnts(_ants, msg.sender);
    _;
  }

  constructor(address __ants) ERC20('EGG', 'EGG') {
    _ants = __ants;
  }

  function mint(address _to, uint256 _amount) external override onyAnts {
    _mint(_to, _amount);
  }

  function burn(address eggOwner, uint256 eggsToBurn) external override onyAnts {
    // only an ant can be created with a single egg per time
    _burn(eggOwner, eggsToBurn);
  }

  function decimals() public view virtual override returns (uint8) {
    return 0;
  }
}
