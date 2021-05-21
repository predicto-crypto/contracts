const { network } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deployer } = await getNamedAccounts();
    const { deploy, get, read, execute } = deployments;

    const token = await get("PredictoToken");
    const staking = await get("PredictoStaking");
    const masterChef = await deploy("MasterChef", {
        from: deployer,
        args: [token.address, staking.address, 1531250, 7679245],
        log: true,
    });

    if (network.name !== "mainnet") {
        const owner = await read("PredictoToken", {}, "owner");
        if (owner !== masterChef.address) {
            await execute("PredictoToken", { from: deployer }, "transferOwnership", masterChef.address);
        }
    }
};
