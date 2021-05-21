// SPDX-License-Identifier: MIT

pragma solidity 0.7.6;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IPredicto is IERC20 {
    function mint(address to, uint256 amount) external;
}

// MasterChef is the master of Predicto. He can make Predicto and he is a fair guy.
//
// Note that it's ownable and the owner wields tremendous power. The ownership
// will be transferred to a governance smart contract once PREDICT is sufficiently
// distributed and the community can show to govern itself.
//
// Have fun reading it. Hopefully it's bug-free. God bless.
contract MasterChef is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of PREDICTs
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accPredictoPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accPredictoPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
    }
    // Info of each pool.
    struct PoolInfo {
        IERC20 lpToken; // Address of LP token contract.
        uint256 allocPoint; // How many allocation points assigned to this pool. PREDICTs to distribute per block.
        uint256 lastRewardBlock; // Last block number that PREDICTs distribution occurs.
        uint256 accPredictoPerShare; // Accumulated PREDICTs per share, times PRECISION. See below.
    }
    // PREDICT token
    IPredicto public immutable predicto;
    // Fee receiver address.
    address public immutable feeTo;
    uint256 public immutable eraInterval;
    uint256 public immutable startBlock;
    // Block number when bonus PREDICT period ends.
    uint256 public constant BONUS_END_BLOCK = 0;
    // Bonus muliplier for early predicto makers.
    uint256 public constant BONUS_MULTIPLIER = 10;
    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;
    // Total allocation poitns. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;

    // PREDICT tokens created per block.
    uint256 private constant PREDICTO_PER_BLOCK = 480e18;
    // Precision to calculate predictoPerBlock().
    uint256 private constant PRECISION = 1e20;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);

    constructor(
        IPredicto _predicto,
        address _feeTo,
        uint256 _eraInterval,
        uint256 _startBlock
    ) {
        predicto = _predicto;
        feeTo = _feeTo;
        eraInterval = _eraInterval;
        startBlock = _startBlock;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    function currentEra() public view returns (uint256) {
        return block.number.sub(startBlock).div(eraInterval);
    }

    function predictoPerBlock() public view returns (uint256) {
        return PREDICTO_PER_BLOCK.div(2**currentEra());
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // XXX DO NOT add the same LP token more than once. Rewards will be messed up if you do.
    function add(
        uint256 _allocPoint,
        IERC20 _lpToken,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(
            PoolInfo({
                lpToken: _lpToken,
                allocPoint: _allocPoint,
                lastRewardBlock: lastRewardBlock,
                accPredictoPerShare: 0
            })
        );
    }

    // Update the given pool's PREDICT allocation point. Can only be called by the owner.
    function set(
        uint256 _pid,
        uint256 _allocPoint,
        bool _withUpdate
    ) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;
    }

    // Return reward multiplier over the given _from to _to block.
    function getMultiplier(uint256 _from, uint256 _to) public pure returns (uint256) {
        if (_to <= BONUS_END_BLOCK) {
            return _to.sub(_from).mul(BONUS_MULTIPLIER);
        } else if (_from >= BONUS_END_BLOCK) {
            return _to.sub(_from);
        } else {
            return BONUS_END_BLOCK.sub(_from).mul(BONUS_MULTIPLIER).add(_to.sub(BONUS_END_BLOCK));
        }
    }

    // View function to see pending PREDICTs on frontend.
    function pendingPredicto(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accPredictoPerShare = pool.accPredictoPerShare;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
            uint256 predictoReward = multiplier.mul(predictoPerBlock()).mul(pool.allocPoint).div(totalAllocPoint);
            predictoReward = predictoReward.sub(predictoReward.div(10));
            accPredictoPerShare = accPredictoPerShare.add(predictoReward.mul(PRECISION).div(lpSupply));
        }
        return user.amount.mul(accPredictoPerShare).div(PRECISION).sub(user.rewardDebt);
    }

    // Update reward vairables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 multiplier = getMultiplier(pool.lastRewardBlock, block.number);
        uint256 predictoReward = multiplier.mul(predictoPerBlock()).mul(pool.allocPoint).div(totalAllocPoint);
        predicto.mint(feeTo, predictoReward.div(10));
        predictoReward = predictoReward.sub(predictoReward.div(10));
        predicto.mint(address(this), predictoReward);
        pool.accPredictoPerShare = pool.accPredictoPerShare.add(predictoReward.mul(PRECISION).div(lpSupply));
        pool.lastRewardBlock = block.number;
    }

    // Deposit LP tokens to MasterChef for PREDICT allocation.
    function deposit(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = user.amount.mul(pool.accPredictoPerShare).div(PRECISION).sub(user.rewardDebt);
            safePredictoTransfer(msg.sender, pending);
        }
        pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
        user.amount = user.amount.add(_amount);
        user.rewardDebt = user.amount.mul(pool.accPredictoPerShare).div(PRECISION);
        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens from MasterChef.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        uint256 pending = user.amount.mul(pool.accPredictoPerShare).div(PRECISION).sub(user.rewardDebt);
        safePredictoTransfer(msg.sender, pending);
        user.amount = user.amount.sub(_amount);
        user.rewardDebt = user.amount.mul(pool.accPredictoPerShare).div(PRECISION);
        pool.lpToken.safeTransfer(address(msg.sender), _amount);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        pool.lpToken.safeTransfer(address(msg.sender), user.amount);
        emit EmergencyWithdraw(msg.sender, _pid, user.amount);
        user.amount = 0;
        user.rewardDebt = 0;
    }

    // Safe predicto transfer function, just in case if rounding error causes pool to not have enough PREDICTs.
    function safePredictoTransfer(address _to, uint256 _amount) internal {
        uint256 predictoBal = predicto.balanceOf(address(this));
        if (_amount > predictoBal) {
            predicto.transfer(_to, predictoBal);
        } else {
            predicto.transfer(_to, _amount);
        }
    }
}
