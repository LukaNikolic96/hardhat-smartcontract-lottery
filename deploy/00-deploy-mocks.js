const { network, ethers } = require("hardhat");
const { developmentChains } = require("../helper-hardhat-config");

const BASE_FEE = ethers.parseEther("0.25"); // 0.25 is the premium. It cost 0.25 LINK per request
const GAS_PRICE_LINK = 1e9; //(1000000000) // kalkulisana vrednos koja se bazira prema ceni gasa na chainu (u ovom primeru ce si mi sami odredimo cenu)

module.exports = async function ({ getNamedAccounts, deployments }) {
  const { deploy, log } = deployments;
  const { deployer } = await getNamedAccounts();
  const chainId = network.config.chainId;
  const args = [BASE_FEE, GAS_PRICE_LINK];

  if (developmentChains.includes(network.name)) {
    log("Local network detected! Deploying mocks...");
    // deploy a mock vrfcoordinator... (TO JE ONO STO SE NALAZI U CONTRACTS -> TEST i kompajlujes da vidis ispravno li si uradeo)
    await deploy("VRFCoordinatorV2Mock", {
      from: deployer,
      log: true,
      args: args,
    });
    log("Mocks Deployed!");
    log("---------------------------------------");
  }
};

module.exports.tags = ["all", "mocks"];
