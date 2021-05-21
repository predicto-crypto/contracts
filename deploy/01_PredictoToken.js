const { ethers, network } = require("hardhat");

module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;

    if (network.name !== "mainnet") {
        const result = await deploy("ServiceReceiver", {
            from: deployer,
            log: true,
        });
        await deploy("PredictoToken", {
            contract: "UnlimitedBEP20",
            from: deployer,
            args: ["Predicto", "PREDICT", 18, ethers.BigNumber.from(10).pow(18).mul(1530000000), result.address],
            log: true,
        });
    }
};
