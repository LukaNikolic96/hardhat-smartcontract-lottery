const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Unit Tests", function () {
      let raffle, raffleEntranceFee, deployer;

      beforeEach(async function () {
        deployer = (await getNamedAccounts()).deployer;
        raffle = await ethers.getContract("Raffle", deployer);
        raffleEntranceFee = await raffle.getEntranceFee();
      });

      describe("fulfillRandomWords", function () {
        it("Works with live Chailink Keepers and Chainlink VRF, we gett a random winner", async function () {
          // enter the raffle
          const startingTimeStamp = await raffle.getLatestTimeStamp();
          const accounts = await ethers.getSigners()

          // postavljamo listener pre nego da udjemo u raffle(pre nego da krenemo da okusamo srecu)
          // za slucaj da se blokchain krece veoma brzo
          await new Promise(async (resolve, reject) => {
            raffle.once("WinnerPicked", async () => {
              console.log("WinnerPicked event fired!");
              resolve();
              try {
              } catch (error) {
                console.log(error);
                reject(e);
              }
            });
            // ulazimo u raffle
            // ovaj kod se nema izvrsi dok listeneri nisu zavrsili s slusanjem
            await raffle.enterRaffle({ value: raffleEntranceFee });
          });
        });
      });
    });
