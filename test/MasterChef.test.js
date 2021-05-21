const { ethers } = require("hardhat");
const { expect } = require("chai");
const { mine } = require("./helpers/evm");
const { tokenAmount } = require("./helpers/ethers");
const { pow2, pow10 } = require("./helpers/numbers");
const { BigNumber } = require("@ethersproject/bignumber");

const START_BLOCK = 32;
const ERA_INTERVAL = 32;
const AMOUNT_PER_BLOCK = tokenAmount(480);
const PRECISION = pow10(20);

const setupTest = async () => {
    const signers = await ethers.getSigners();
    const [deployer, alice, bob, carol] = signers;

    const ServiceReceiver = await ethers.getContractFactory("ServiceReceiver");
    const serviceReceiver = await ServiceReceiver.deploy();

    const UnlimitedBEP20 = await ethers.getContractFactory("UnlimitedBEP20");
    const token = await UnlimitedBEP20.deploy("Predicto", "PREDICT", 18, 0, serviceReceiver.address);

    const pair0 = await UnlimitedBEP20.deploy(
        "PREDICT-BNB",
        "PREDICT-BNB",
        18,
        tokenAmount(21000000),
        serviceReceiver.address
    );

    const pair1 = await UnlimitedBEP20.deploy(
        "PREDICT-BUSD",
        "PREDICT-BUSD",
        18,
        tokenAmount(21000000),
        serviceReceiver.address
    );

    const pair2 = await UnlimitedBEP20.deploy(
        "BNB-BUSD",
        "BNB-BUSD",
        18,
        tokenAmount(21000000),
        serviceReceiver.address
    );

    const PredictoStaking = await ethers.getContractFactory("PredictoStaking");
    const staking = await PredictoStaking.deploy(token.address);

    const MasterChef = await ethers.getContractFactory("MasterChef");
    const chef = await MasterChef.deploy(token.address, staking.address, ERA_INTERVAL, START_BLOCK);
    await mine();

    await token.transferOwnership(chef.address);

    await pair0.transfer(alice.address, tokenAmount(1000));
    await pair0.transfer(bob.address, tokenAmount(1000));
    await pair0.transfer(carol.address, tokenAmount(1000));
    await pair1.transfer(alice.address, tokenAmount(1000));
    await pair1.transfer(bob.address, tokenAmount(1000));
    await pair1.transfer(carol.address, tokenAmount(1000));
    await pair2.transfer(alice.address, tokenAmount(1000));
    await pair2.transfer(bob.address, tokenAmount(1000));
    await pair2.transfer(carol.address, tokenAmount(1000));

    await pair0.connect(alice).approve(chef.address, tokenAmount(100000));
    await pair0.connect(bob).approve(chef.address, tokenAmount(100000));
    await pair0.connect(carol).approve(chef.address, tokenAmount(100000));
    await pair1.connect(alice).approve(chef.address, tokenAmount(100000));
    await pair1.connect(bob).approve(chef.address, tokenAmount(100000));
    await pair1.connect(carol).approve(chef.address, tokenAmount(100000));
    await pair2.connect(alice).approve(chef.address, tokenAmount(100000));
    await pair2.connect(bob).approve(chef.address, tokenAmount(100000));
    await pair2.connect(carol).approve(chef.address, tokenAmount(100000));
    await mine();

    return {
        deployer,
        alice,
        bob,
        carol,
        token,
        pair0,
        pair1,
        pair2,
        chef,
        staking,
    };
};

const endEra = async () => {
    const block = await ethers.provider.getBlockNumber();
    await mine(ERA_INTERVAL - (block % ERA_INTERVAL) - 1);
};

const mineToStartBlock = async () => {
    await mine(START_BLOCK - (await ethers.provider.getBlockNumber()) - 1);
};

const deductFee = amount => {
    return amount.sub(amount.div(10));
};

const feeToStaking = amount => {
    return amount.div(10);
};

describe("MasterChef", function () {
    beforeEach(async function () {
        await ethers.provider.send("hardhat_reset", []);
    });

    it("should allow emergency withdraw", async function () {
        const { alice, token, pair0, chef } = await setupTest();

        await chef.add(100, pair0.address, true);
        await mineToStartBlock();

        await chef.connect(alice).deposit(0, tokenAmount(100));
        await mine();
        expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(900));

        await chef.connect(alice).emergencyWithdraw(0);
        await mine();

        expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(1000));
        expect(await token.balanceOf(alice.address)).to.equal(0);
    });

    it("should reward alice in 1 era with 1 pool", async function () {
        const { alice, token, pair0, chef } = await setupTest();

        await chef.add(100, pair0.address, true);
        await mineToStartBlock();

        await chef.connect(alice).deposit(0, tokenAmount(100));
        await mine();
        let lastBalance = await token.balanceOf(alice.address);
        expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(900));
        expect(lastBalance).to.equal(0);

        for (let i = await ethers.provider.getBlockNumber(); i < ERA_INTERVAL; i++) {
            await chef.connect(alice).withdraw(0, tokenAmount(100));
            await chef.connect(alice).deposit(0, tokenAmount(100));
            await mine();
            const balance = await token.balanceOf(alice.address);
            expect(balance.sub(lastBalance)).to.equal(deductFee(AMOUNT_PER_BLOCK));
            lastBalance = balance;
        }
    });

    it("should reward alice in eras with 1 pool", async function () {
        const { alice, token, pair0, chef } = await setupTest();

        await chef.add(100, pair0.address, true);
        await mineToStartBlock();
        await mine();

        await chef.connect(alice).deposit(0, tokenAmount(100));
        await mine();
        let lastBalance = await token.balanceOf(alice.address);
        expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(900));
        expect(lastBalance).to.equal(0);

        for (let i = 1; i <= 68; i++) {
            await endEra();
            await chef.connect(alice).withdraw(0, tokenAmount(100));
            await mine();
            const balance = await token.balanceOf(alice.address);
            expect(await chef.currentEra()).to.equal(i);
            expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(1000));
            const reward = deductFee(AMOUNT_PER_BLOCK.div(pow2(i)).mul(ERA_INTERVAL - 1));
            expect(balance.sub(lastBalance)).to.equal(reward);
            await chef.connect(alice).deposit(0, tokenAmount(100));
            await mine();
            lastBalance = balance;
        }

        await endEra();
        await chef.connect(alice).withdraw(0, tokenAmount(100));
        await mine();
        expect((await token.balanceOf(alice.address)).sub(lastBalance)).to.equal(0);
    });

    it("should reward alice, bob and carol in eras with 1 pool", async function () {
        const { alice, bob, carol, token, pair0, chef } = await setupTest();

        await chef.add(100, pair0.address, true);
        await mineToStartBlock();
        await mine();

        await chef.connect(alice).deposit(0, tokenAmount(100));
        await chef.connect(bob).deposit(0, tokenAmount(100));
        await chef.connect(carol).deposit(0, tokenAmount(100));
        await mine();
        let lastAliceBalance = await token.balanceOf(alice.address);
        let lastBobBalance = await token.balanceOf(bob.address);
        let lastCarolBalance = await token.balanceOf(carol.address);
        expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(900));
        expect(await pair0.balanceOf(bob.address)).to.equal(tokenAmount(900));
        expect(await pair0.balanceOf(carol.address)).to.equal(tokenAmount(900));
        expect(lastAliceBalance).to.equal(0);
        expect(lastBobBalance).to.equal(0);
        expect(lastCarolBalance).to.equal(0);

        for (let i = 1; i <= 68; i++) {
            await endEra();
            await chef.connect(alice).withdraw(0, tokenAmount(100));
            await chef.connect(bob).withdraw(0, tokenAmount(100));
            await chef.connect(carol).withdraw(0, tokenAmount(100));
            await mine();
            const aliceBalance = await token.balanceOf(alice.address);
            const bobBalance = await token.balanceOf(bob.address);
            const carolBalance = await token.balanceOf(carol.address);
            expect(await chef.currentEra()).to.equal(i);
            expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(1000));
            expect(await pair0.balanceOf(bob.address)).to.equal(tokenAmount(1000));
            expect(await pair0.balanceOf(carol.address)).to.equal(tokenAmount(1000));
            const reward = deductFee(AMOUNT_PER_BLOCK.div(pow2(i)).mul(ERA_INTERVAL - 1)).div(3);
            expect(aliceBalance.sub(lastAliceBalance)).to.equal(reward);
            expect(bobBalance.sub(lastBobBalance)).to.equal(reward);
            expect(carolBalance.sub(lastCarolBalance)).to.equal(reward);
            await chef.connect(alice).deposit(0, tokenAmount(100));
            await chef.connect(bob).deposit(0, tokenAmount(100));
            await chef.connect(carol).deposit(0, tokenAmount(100));
            lastAliceBalance = aliceBalance;
            lastBobBalance = bobBalance;
            lastCarolBalance = carolBalance;
        }

        await endEra();
        await chef.connect(alice).withdraw(0, tokenAmount(100));
        await chef.connect(bob).withdraw(0, tokenAmount(100));
        await chef.connect(carol).withdraw(0, tokenAmount(100));
        expect((await token.balanceOf(alice.address)).sub(lastAliceBalance)).to.equal(0);
        expect((await token.balanceOf(bob.address)).sub(lastBobBalance)).to.equal(0);
        expect((await token.balanceOf(carol.address)).sub(lastCarolBalance)).to.equal(0);
    });

    it("should reward alice, bob and carol in eras with 3 pool", async function () {
        const { alice, bob, carol, token, pair0, pair1, pair2, chef } = await setupTest();

        await chef.add(300, pair0.address, true);
        await chef.add(200, pair1.address, true);
        await chef.add(100, pair2.address, true);
        await mineToStartBlock();
        await mine();

        await chef.connect(alice).deposit(0, tokenAmount(100));
        await chef.connect(alice).deposit(1, tokenAmount(100));
        await chef.connect(alice).deposit(2, tokenAmount(100));
        await chef.connect(bob).deposit(1, tokenAmount(100));
        await chef.connect(bob).deposit(2, tokenAmount(100));
        await chef.connect(carol).deposit(2, tokenAmount(100));
        await mine();
        let lastAliceBalance = await token.balanceOf(alice.address);
        let lastBobBalance = await token.balanceOf(bob.address);
        let lastCarolBalance = await token.balanceOf(carol.address);
        expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(900));
        expect(await pair1.balanceOf(alice.address)).to.equal(tokenAmount(900));
        expect(await pair2.balanceOf(alice.address)).to.equal(tokenAmount(900));
        expect(await pair1.balanceOf(bob.address)).to.equal(tokenAmount(900));
        expect(await pair2.balanceOf(bob.address)).to.equal(tokenAmount(900));
        expect(await pair2.balanceOf(carol.address)).to.equal(tokenAmount(900));
        expect(lastAliceBalance).to.equal(0);
        expect(lastBobBalance).to.equal(0);
        expect(lastCarolBalance).to.equal(0);

        for (let i = 1; i <= 68; i++) {
            await endEra();
            await chef.connect(alice).withdraw(0, tokenAmount(100));
            await chef.connect(alice).withdraw(1, tokenAmount(100));
            await chef.connect(alice).withdraw(2, tokenAmount(100));
            await chef.connect(bob).withdraw(1, tokenAmount(100));
            await chef.connect(bob).withdraw(2, tokenAmount(100));
            await chef.connect(carol).withdraw(2, tokenAmount(100));
            await mine();
            const aliceBalance = await token.balanceOf(alice.address);
            const bobBalance = await token.balanceOf(bob.address);
            const carolBalance = await token.balanceOf(carol.address);
            expect(await chef.currentEra()).to.equal(i);
            expect(await pair0.balanceOf(alice.address)).to.equal(tokenAmount(1000));
            expect(await pair1.balanceOf(alice.address)).to.equal(tokenAmount(1000));
            expect(await pair2.balanceOf(alice.address)).to.equal(tokenAmount(1000));
            expect(await pair1.balanceOf(bob.address)).to.equal(tokenAmount(1000));
            expect(await pair2.balanceOf(bob.address)).to.equal(tokenAmount(1000));
            expect(await pair2.balanceOf(carol.address)).to.equal(tokenAmount(1000));
            const reward0 = deductFee(
                AMOUNT_PER_BLOCK.div(pow2(i))
                    .mul(ERA_INTERVAL - 1)
                    .mul(300) // pair0's allocPoint = 300
                    .div(600) // totalAllocPoint = 600
            );
            const reward1 = deductFee(
                AMOUNT_PER_BLOCK.div(pow2(i))
                    .mul(ERA_INTERVAL - 1)
                    .mul(200) // pair1's allocPoint = 200
                    .div(600) // totalAllocPoint = 600
            ).div(2); // alice & bob are rewarded equally
            const reward2 = deductFee(
                AMOUNT_PER_BLOCK.div(pow2(i))
                    .mul(ERA_INTERVAL - 1)
                    .mul(100) // pair2's allocPoint = 100
                    .div(600) // totalAllocPoint = 600
            ).div(3); // alice, bob & carol are rewarded equally
            expect(aliceBalance.sub(lastAliceBalance)).to.equal(reward0.add(reward1).add(reward2));
            expect(bobBalance.sub(lastBobBalance)).to.equal(reward1.add(reward2));
            expect(carolBalance.sub(lastCarolBalance)).to.equal(reward2);
            await chef.connect(alice).deposit(0, tokenAmount(100));
            await chef.connect(alice).deposit(1, tokenAmount(100));
            await chef.connect(alice).deposit(2, tokenAmount(100));
            await chef.connect(bob).deposit(1, tokenAmount(100));
            await chef.connect(bob).deposit(2, tokenAmount(100));
            await chef.connect(carol).deposit(2, tokenAmount(100));
            lastAliceBalance = aliceBalance;
            lastBobBalance = bobBalance;
            lastCarolBalance = carolBalance;
        }

        await endEra();
        await chef.connect(alice).withdraw(0, tokenAmount(100));
        await chef.connect(alice).withdraw(1, tokenAmount(100));
        await chef.connect(alice).withdraw(2, tokenAmount(100));
        await chef.connect(bob).withdraw(1, tokenAmount(100));
        await chef.connect(bob).withdraw(2, tokenAmount(100));
        await chef.connect(carol).withdraw(2, tokenAmount(100));
        expect((await token.balanceOf(alice.address)).sub(lastAliceBalance)).to.equal(0);
        expect((await token.balanceOf(bob.address)).sub(lastBobBalance)).to.equal(0);
        expect((await token.balanceOf(carol.address)).sub(lastCarolBalance)).to.equal(0);
    });

    it("should reward alice in crossing eras with 1 pool and PredictoStaking correctly", async function () {
        const { alice, token, pair0, chef, staking } = await setupTest();

        await chef.add(100, pair0.address, true);
        await chef.connect(alice).deposit(0, tokenAmount(100)); //deposit before StartBlock
        expect(await token.balanceOf(alice.address)).to.equal(0);
        expect(await token.balanceOf(staking.address)).to.equal(0);

        await mineToStartBlock();

        await chef.connect(alice).deposit(0, 0); //doesn't harvest
        await mine();

        expect(await token.balanceOf(alice.address)).to.equal(0);
        await chef.connect(alice).deposit(0, 0); //harvest
        await mine();
        expect(await token.balanceOf(alice.address)).to.equal(deductFee(AMOUNT_PER_BLOCK));
        expect(await token.balanceOf(staking.address)).to.equal(feeToStaking(AMOUNT_PER_BLOCK));

        while (BigNumber.from(await ethers.provider.getBlockNumber()).lt(START_BLOCK + ERA_INTERVAL * 68)) {
            const jump = Math.floor(Math.random() * 30) + 2;
            const balanceBefore = await token.balanceOf(alice.address);
            const stakingBalanceBefore = await token.balanceOf(staking.address);

            await mine(jump - 1); //+ 1~30 blocks
            await chef.connect(alice).deposit(0, 0);
            await mine();
            const predictoPerBlock = await chef.predictoPerBlock();
            const balanceAfter = await token.balanceOf(alice.address);
            const stakingBalanceAfter = await token.balanceOf(staking.address);

            expect(balanceAfter.sub(balanceBefore)).to.equal(deductFee(predictoPerBlock.mul(jump)));
            expect(stakingBalanceAfter.sub(stakingBalanceBefore)).to.equal(feeToStaking(predictoPerBlock.mul(jump)));
        }
        expect(await chef.currentEra()).to.equal(68);
        const balanceIn68Era = await token.balanceOf(alice.address);
        await mine(31);

        if ((await chef.currentEra()).eq(68)) {
            await mine();
        }

        expect(await chef.currentEra()).to.equal(69);
        await chef.connect(alice).deposit(0, 0);
        await mine();

        const balanceIn69Era = await token.balanceOf(alice.address);
        expect(balanceIn68Era).to.equal(balanceIn69Era); //after 68 era, emission per block is 0.
    });

    it("should update pool correctly", async function () {
        const { alice, pair0, chef } = await setupTest();

        const checkPoolInfo = async (block, share) => {
            const lastRewardBlock = (await chef.poolInfo(0))[2];
            const accPredictoPerShare = (await chef.poolInfo(0))[3];
            expect(lastRewardBlock).to.be.equal(block);
            expect(accPredictoPerShare).to.be.equal(share);
        };

        await chef.add(100, pair0.address, true);
        await mine();
        await checkPoolInfo(START_BLOCK, 0);

        await chef.updatePool(0);
        await mine();
        await checkPoolInfo(START_BLOCK, 0);

        await mineToStartBlock(); //31
        await mine(2); //33
        await chef.updatePool(0); //in 34 blocks
        await mine(); //34
        await checkPoolInfo(34, 0);

        await mine(5); //39
        await chef.connect(alice).deposit(0, tokenAmount(100)); //40 & deposit func internally call updatePool func
        await mine(); //40
        await checkPoolInfo(40, 0);

        await mine(7); //47
        await chef.updatePool(0); //48
        await mine(); //48

        let predictoPerBlock = await chef.predictoPerBlock();
        let predictoReward = deductFee(predictoPerBlock.mul(8));
        let accPredictoPerShare = predictoReward.mul(PRECISION).div(tokenAmount(100));
        await checkPoolInfo(48, accPredictoPerShare);

        await mine(30); //78
        await chef.updatePool(0); //79
        await mine(); //79

        predictoPerBlock = await chef.predictoPerBlock();
        predictoReward = deductFee(predictoPerBlock.mul(31));
        accPredictoPerShare = accPredictoPerShare.add(predictoReward.mul(PRECISION).div(tokenAmount(100)));
        await checkPoolInfo(79, accPredictoPerShare);
    });

    it("should calculate reward correctly as pendingPredicto func", async function () {
        const { alice, pair0, pair1, chef } = await setupTest();

        await chef.add(100, pair0.address, true);
        await mine();
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(0);

        await mineToStartBlock(); //31
        await mine(3); //34
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(0); //34

        await mine(5); //39
        await chef.connect(alice).deposit(0, tokenAmount(100)); //40 update
        await mine(); //40
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(0); //40

        await mine(); //41
        let predictoPerBlock = await chef.predictoPerBlock();
        let pendingPredicto = deductFee(predictoPerBlock.mul(1));
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(pendingPredicto); //41

        await mine(16); //57
        predictoPerBlock = await chef.predictoPerBlock();
        pendingPredicto = deductFee(predictoPerBlock.mul(17));
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(pendingPredicto); //57

        await chef.updatePool(0); //58 update
        await mine(); //58
        expect(await chef.currentEra()).to.be.equal(0); //58
        let predictoPerBlockBeforeEra = await chef.predictoPerBlock(); //58
        await mine(10); //68
        expect(await chef.currentEra()).to.be.equal(1); //68
        predictoPerBlock = await chef.predictoPerBlock();
        pendingPredicto = deductFee(predictoPerBlockBeforeEra.mul(18).add(predictoPerBlock.mul(10)));
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(pendingPredicto); //68

        await chef.connect(alice).deposit(0, 0); //69 update & harvest
        await chef.add(400, pair1.address, true); //69 mass update
        await mine(); //69
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(0); //69

        await chef.connect(alice).deposit(1, tokenAmount(100)); //70 update (pid 1)
        await mine(2); //71

        predictoPerBlock = await chef.predictoPerBlock();
        pendingPredicto = deductFee(predictoPerBlock.mul(2).div(5));
        expect(await chef.pendingPredicto(0, alice.address)).to.be.equal(pendingPredicto); //71
    });
});
