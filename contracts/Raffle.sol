// Raffle

// Enter the lottery (paying some amount)
// Pick a random winner (verifiably random)
// Winner to be selected every x minutes -> da bude automatski

// Chainlink Oracle -> Randomness, Automated Execution (Chainlink Keepers)

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/vrf/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/automation/interfaces/AutomationCompatibleInterface.sol";
import "hardhat/console.sol";

error Raffle__NotEnoughETHEntered();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(
    uint256 currentBalance,
    uint256 numPlayers,
    uint256 raffleState
);

/**
 * @title A sample Raffle Contract
 * @author Luka Nikolic
 * @notice This implements Chainlink VRF v2 and Chainlink Keepers
 */

contract Raffle is VRFConsumerBaseV2, AutomationCompatibleInterface {
    /* Type declarations */
    /* u sustini ovde sta radimo stavljamo da je pozicija 0 open a 1 calculating
    ovako u prevodu uint256 0 = OPEN, 1 = CALCULATING */
    enum RaffleState {
        OPEN,
        CALCULATING
    }
    /* State Variables */
    //uint256 private immutable i_entranceFee;
    //address payable[] private s_players;
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane;
    uint64 private immutable i_subscriptionId;
    uint32 private immutable i_callbackGasLimit;
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private constant NUM_WORDS = 1;

    // Lottery Variables
    uint256 private immutable i_interval;
    uint256 private immutable i_entranceFee;
    uint256 private s_lastTimeStamp;
    address private s_recentWinner;
    address payable[] private s_players;
    RaffleState private s_raffleState;

    /* Events */
    event RaffleEnter(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed player);

    /* Functions */
    constructor(
        address vrfCoordinatorV2, // ovo je contract
        uint256 entranceFee,
        bytes32 gasLane,
        uint64 subscriptionId,
        uint32 callbackGasLimit,
        uint256 interval
    ) VRFConsumerBaseV2(vrfCoordinatorV2) {
        i_entranceFee = entranceFee;
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinatorV2);
        i_gasLane = gasLane;
        i_subscriptionId = subscriptionId;
        i_callbackGasLimit = callbackGasLimit;
        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        i_interval = interval;
    }

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert Raffle__NotEnoughETHEntered();
        }
        if (s_raffleState != RaffleState.OPEN) {
            revert Raffle__NotOpen();
        }
        s_players.push(payable(msg.sender));

        // Events - emit an event when we update a dynamic array or mapping
        // uglavnom se imenuju obrnuto od funkcije u koju se nalaze
        // enterRaffle -> RaffleEnter
        emit RaffleEnter(msg.sender);
    }

    /**
     * @dev This is the function that the Chainlink Keeper nodes call
     * they look for the `upkeepNeeded` to return true zato sto je bool
     * da bi bilo true sledece stavke treba da se ispune(da se vrate true - return true):
     * 1. Our time interval should have passed - kad ga napravimo
     * 2. The lottery should have at least 1 player, and have some ETH
     * 3. Our subscription is funded with LINK
     * 4. the lottery should be in an "open" state. - dok cekamo da izvuce pobednika da se ne ukljuce jos igraci
     */
    function checkUpkeep(
        bytes memory /*checkData*/
    )
        public
        view
        override
        returns (bool upkeepNeeded, bytes memory /* performData */)
    {
        bool isOpen = (RaffleState.OPEN == s_raffleState);
        bool timePassed = ((block.timestamp - s_lastTimeStamp) > i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
        // posto gore pise bool upkeepNeeded nemoramo i ovde dole
        return (upkeepNeeded, "0x0");
    }

    function performUpkeep(bytes calldata /* performData */) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        // Osiguravamo ovim (CALCULATING) da se ne prikljuce dodadni igraci
        s_raffleState = RaffleState.CALCULATING;
        /* Trebaju nam 2 stvari da izaberemo pobednika, 
        nasumican broj i da nesto uradimo s njim kad ga dobijemo */
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane, //dodajemo mu GasLane i menjamo keyHash -> i_gasLane
            i_subscriptionId, // menjamo iz s_subscriptionId -> i_subscriptionId
            REQUEST_CONFIRMATIONS, // menjamo requestConfirmations u REQUEST_CONFIRMATIONS
            i_callbackGasLimit, // callbackGasLimit -> i_callbackGasLimit
            NUM_WORDS // numwords -> NUM_WORDS
        );
        // tehnicki je nepotrebno jer to vec se emituje u vrfcoordinator al ce ga ostavimo
        emit RequestedRaffleWinner(requestId);
    }

    /* kazemo mu da ocekuje da override fulfillRandomWords koji 
sadrzi parametre koji su u zagradi */
    function fulfillRandomWords(
        uint256 /*requestId*/,
        uint256[] memory randomWords
    ) internal override {
        uint256 indexOfWinner = randomWords[0] % s_players.length;
        address payable recentWinner = s_players[indexOfWinner];
        s_recentWinner = recentWinner;
        // resetujemo igrace kad se zavrsi i pocne novo kolo

        s_players = new address payable[](0);

        // otvaramo opet za igru
        s_raffleState = RaffleState.OPEN;
        s_lastTimeStamp = block.timestamp;
        // saljemo mu novac
        (bool success, ) = recentWinner.call{value: address(this).balance}("");
        if (!success) {
            revert Raffle__TransferFailed();
        }
        emit WinnerPicked(recentWinner);
    }

    /* View / Pure functions */
    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 index) public view returns (address) {
        return s_players[index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getNumWords() public pure returns (uint256) {
        // stavljamo pure zato sto smo gore hardkodovali tj stavili da bude to smo br 1, tj jedan broj
        return NUM_WORDS;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLatestTimeStamp() public view returns (uint256) {
        return s_lastTimeStamp;
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }
    
}
