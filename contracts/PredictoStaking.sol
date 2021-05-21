// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// PredictoStaking is the coolest bar in town. You come in with some PREDICT, and leave with more! The longer you stay, the more PREDICT you get.
//
// This contract handles swapping to and from xPREDICT, predicto's staking token.
contract PredictoStaking is ERC20("Predicto Staking", "xPREDICT") {
    using SafeMath for uint256;
    IERC20 public predicto;

    // Define the PREDICT token contract
    constructor(IERC20 _predicto) {
        predicto = _predicto;
    }

    // Enter the bar. Pay some PREDICTs. Earn some shares.
    // Locks PREDICT and mints xPREDICT
    function enter(uint256 _amount) public {
        // Gets the amount of PREDICT locked in the contract
        uint256 totalPredict = predicto.balanceOf(address(this));
        // Gets the amount of xPREDICT in existence
        uint256 totalShares = totalSupply();
        // If no xPREDICT exists, mint it 1:1 to the amount put in
        if (totalShares == 0 || totalPredict == 0) {
            _mint(msg.sender, _amount);
        }
        // Calculate and mint the amount of xPREDICT the PREDICT is worth. The ratio will change overtime, as xPREDICT is burned/minted and PREDICT deposited + gained from fees / withdrawn.
        else {
            uint256 what = _amount.mul(totalShares).div(totalPredict);
            _mint(msg.sender, what);
        }
        // Lock the PREDICT in the contract
        predicto.transferFrom(msg.sender, address(this), _amount);
    }

    // Leave the bar. Claim back your PREDICTs.
    // Unlocks the staked + gained PREDICT and burns xPREDICT
    function leave(uint256 _share) public {
        // Gets the amount of xPREDICT in existence
        uint256 totalShares = totalSupply();
        // Calculates the amount of PREDICT the xPREDICT is worth
        uint256 what = _share.mul(predicto.balanceOf(address(this))).div(totalShares);
        _burn(msg.sender, _share);
        predicto.transfer(msg.sender, what);
    }
}
