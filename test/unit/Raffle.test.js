const { network, getNamedAccounts, deployments, ethers } = require("hardhat");
const {
  developmentChains,
  networkConfig,
} = require("../../helper-hardhat-config");
const { assert, expect } = require("chai");

!developmentChains.includes(network.name)
  ? describe.skip
  : describe("Raffle Unit Tests", function () {
      let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
      const chainId = network.config.chainId;

      beforeEach(async function () {
        deployer = (await getNamedAccounts()).deployer;
        await deployments.fixture(["all"]);
        raffle = await ethers.getContract("Raffle", deployer);
        vrfCoordinatorV2Mock = await ethers.getContract(
          "VRFCoordinatorV2Mock",
          deployer
        );
        raffleEntranceFee = await raffle.getEntranceFee();
        interval = await raffle.getInterval();
      });
      describe("constructor", function () {
        it("Initalizes the raffle correctly", async function () {
          // Idealno bi bilo da imamo samo 1 assert po "it"
          const raffleState = await raffle.getRaffleState();
          assert.equal(raffleState.toString(), "0");
          assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
        });
      });
      describe("enterRaffle", async function () {
        it("Reverts when you don't pay enough", async function () {
          await expect(raffle.enterRaffle()).to.be.revertedWithCustomError(
            raffle,
            "Raffle__NotEnoughETHEntered"
          );
        });
        it("Records players when they enter", async function () {
          // treba nam raffleEntranceFee
          await raffle.enterRaffle({ value: raffleEntranceFee });
          // proveravamo da li je player iz nas contract zapravo
          const playerFromContract = await raffle.getPlayer(0);
          assert.equal(playerFromContract, deployer);
        });
        it("emits event on enter", async function () {
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.emit(raffle, "RaffleEnter");
        });
        it("Doesn't allow entrance when raffle is calculating", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            Number(interval) + 1,
          ]);
          await network.provider.send("evm_mine", []);
          // pretvaramo se da smo Chainlink Keeper
          await raffle.performUpkeep("0x");
          await expect(
            raffle.enterRaffle({ value: raffleEntranceFee })
          ).to.be.revertedWithCustomError(raffle, "Raffle__NotOpen");
        });
      });
      describe("checkUpkeep", function () {
        it("Returns false if people haven't sent any ETH", async function () {
          await network.provider.send("evm_increaseTime", [
            Number(interval) + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");
          // callStatic simulira poziv umesto pravog poziva da bi testirali tj videli sta cemo da dobijemo kad napravimo pravi poziv
          assert(!upkeepNeeded);
        });
        it("Returns false if raffle isn't open", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            Number(interval) + 1,
          ]);
          await network.provider.send("evm_mine", []);
          await raffle.performUpkeep("0x");
          const raffleState = await raffle.getRaffleState();
          const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");
          assert.equal(raffleState.toString(), "1");
          assert.equal(upkeepNeeded, false);
        });
        it("Returns false if enough time hasn't passed", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            Number(interval) - 3,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");
          assert(!upkeepNeeded);
        });
        it("Returns true if enough time has passed, has players, ETH, and is open", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            Number(interval) + 1,
          ]);
          await network.provider.request({ method: "evm_mine", params: [] });
          const { upkeepNeeded } = await raffle.checkUpkeep.staticCall("0x");
          assert(upkeepNeeded);
        });
      });
      describe("performUpkeep", function () {
        it("It can only run if checkUpkeep is true", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            Number(interval) + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const tx = await raffle.performUpkeep("0x");
          assert(tx);
        });
        it("Reverts when checkUpkeep is false", async function () {
          await expect(
            raffle.performUpkeep("0x")
          ).to.be.revertedWithCustomError(raffle, "Raffle__UpkeepNotNeeded");
        });
        it("Updates the raffle state, emits and event, and calls the vrf coordinator", async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            Number(interval) + 1,
          ]);
          await network.provider.send("evm_mine", []);
          const txResponse = await raffle.performUpkeep("0x");
          const txReceipt = await txResponse.wait(1);
          const requestId = txReceipt.logs[1].args.requestId; // stavljamo 1 zato sto pre nego da se taj event emituje u raffle ima event ispred njega koji ce se emituje tija uint256 requestId
          const raffleState = await raffle.getRaffleState();
          assert(Number(requestId) > 0);
          assert(raffleState.toString() == "1");
        });
      });
      describe("fulfillRandomWords", function () {
        beforeEach(async function () {
          await raffle.enterRaffle({ value: raffleEntranceFee });
          await network.provider.send("evm_increaseTime", [
            Number(interval) + 1,
          ]);
          await network.provider.send("evm_mine", []);
        });
        it("Can only be called after performUpkeep", async function () {
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.target)
          ).to.be.revertedWith("nonexistent request");
          await expect(
            vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.target)
          ).to.be.revertedWith("nonexistent request");
        });
        // Najveci testo do sad koji ce obuhvata prakticno sve
        it("Picks a winner, resets the lottery and sends money", async function () {
          // za ovaj test ce dodajemo jos fake akaunta da bi lepo testirali
          const additionalEntrants = 3;
          const startingAccountIndex = 1; // zato sto je onija sto kreira 0 tj deployer = 0
          const accounts = await ethers.getSigners();

          /* dodajemo for loop koja proverava dal je broj taj koji smo stavili da jeste tj da neje povise tako sto i vrednost ne treba da bude
          veca od zbira broja igraca(additionalEntrants) i indexa igraca koji krece od 1 */
          for (
            let i = startingAccountIndex;
            i < startingAccountIndex + additionalEntrants;
            i++
          ) {
            const accountConnectedRaffle = raffle.connect(accounts[i]); // iznad smo definisali accounts
            await accountConnectedRaffle.enterRaffle({
              value: raffleEntranceFee,
            });
          }

          const startingTimeStamp = await raffle.getLatestTimeStamp();

          /* sta cemo sad sve da uradimo i sta nam treba:
          1. performUpkeep(pretvara se da je chainlink keepers)
          2. zatim to treba da trigeruje fulfillRandomWords(tako sto se pretvara da je Chainlink VRF)
          na pravi testnet bi cekali da se fulfillRandomWords trigeruje ali posto smo na lokalnu mrezu onda nemoramo jer moze nam se i brze je
          i zato cemo da simuliramo da ispadne kao da smo cekali i zato kreiramo promise*/
          await new Promise(async (resolve, reject) => {
            // prvo simuliramo winner picked event (iako treba prvo stavke pod br 1 i 2 jer ocemo kad se pokrene
            // promise da se winner event pokrene i da ceka da se ove stavke prvo ispune pre nego sto se trigeruje)
            // stavljamo resolve da ako se ne trigeruje za 200s(sto smo odredili u hardhat.config.js) da se pojavi greska da nebi cekali celu vecnost
            raffle.once("WinnerPicker", async () => {
              console.log("Found the event!");
              resolve();

              try {
                const recentWinner = await raffle.getRecentWinner();
                const raffleState = await raffle.getRaffleState();
                const endingTimeStamp = await raffle.getLatestTimeStamp();
                const numPlayers = await raffle.getNumberOfPlayers();
                const winnerEndingBalance = await accounts[1].getBalance();
                assert.equal(numPlayers.toString(), "0"); // proveravamo dal se br playera resetovao ako je jednak 0 onda jeste
                assert.equal(raffleState.toString(), "0"); // proveravamo dal je state ponovo open
                assert(endingTimeStamp > startingTimeStamp);
                assert.equal(
                  winnerEndingBalance.toString(),
                  winnerStartingBalance.add(
                    raffleEntranceFee
                      .mul(additionalEntrants)
                      .add(raffleEntranceFee)
                      .toString()
                  )
                );
              } catch (error) {
                reject(e);
              }
            });
            // sad kreiramo i ostale stavke i one se treba nalaze u promise ali van winnerpicker

            // Setting up the listener
            // ispod ce okidamo event(umesto event komandu koristimo logs da se ne zbunis) i listener ce ga registruje i resolvuje
            const tx = await raffle.performUpkeep([]);
            const txReceipt = await tx.wait(1);
            const winnerStartingBalance = await accounts[1].getBalance();
            await vrfCoordinatorV2Mock.fulfillRandomWords(
              txReceipt.events[1].args.requestId,
              raffle.address
            );
          });
        });
      });
    });
