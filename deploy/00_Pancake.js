const { network } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;

    if (network.name !== "mainnet") {
        const wbnb = await deploy("WBNB", {
            from: deployer,
            args: [],
            log: true,
        });
        const factory = await deploy("PancakeFactory", {
            from: deployer,
            args: [deployer],
            log: true,
        });
        await deploy("PancakeRouter", {
            from: deployer,
            args: [factory.address, wbnb.address],
            log: true,
        });
    }
};
