//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import './interfaces/IEgg.sol';

contract Egg is ERC20, IEgg {
  address private _ants;

  constructor(address __ants) ERC20('EGG', 'EGG') {
    _ants = __ants;
  }

  function mint(address _to, uint256 _amount) external override {
    //solhint-disable-next-line
    require(msg.sender == _ants, 'Only the ants contract can call this function, please refer to the ants contract');
    _mint(_to, _amount);
  }

  function decimals() public view virtual override returns (uint8) {
    return 0;
  }
}
