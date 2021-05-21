module.exports = async ({ getNamedAccounts, deployments }) => {
    const { deployer } = await getNamedAccounts();
    const { deploy, get } = deployments;

    const token = await get("PredictoToken");
    await deploy("PredictoStaking", {
        from: deployer,
        args: [token.address],
        log: true,
    });
};
