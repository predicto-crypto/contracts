module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;

    await deploy("Timelock", {
        from: deployer,
        args: [deployer, 172800],
        log: true,
    });
};