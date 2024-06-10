import {
  MerchantMoeV2PairWithFeesAndPool,
  MerchantMoeV2WorkerConfiguration,
  getMerchantMoeV2PairDataPath,
  getMerchantMoeV2PairLatestDataPath
} from '../../configuration/WorkerConfiguration';
import { BaseFetcher } from '../BaseFetcher';
import * as Web3Utils from '../../../utils/Web3Utils';
import { MerchantMoeV2Constants } from './MerchantMoeV2Constants';
import * as ethers from 'ethers';
import * as fs from 'fs';
import { MerchantMoeFactory__factory, MerchantMoeLBPair, MerchantMoeLBPair__factory } from '../../../contracts/types';
import { translateTopicFilters } from '../uniswapv3/UniswapV3Utils';
import { MerchantMoeV2PoolData } from '../../../models/datainterface/BlockData';
import retry, { normalize } from '../../../utils/Utils';
import { MerchantMoeV2Library } from '../../../library/MerchantMoeV2Library';
import BigNumber from 'bignumber.js';
import { TokenData } from '../../configuration/TokenData';

export class MerchantMoeV2Fetcher extends BaseFetcher<MerchantMoeV2WorkerConfiguration> {
  constructor(runEveryMinutes: number, configVersion: string) {
    super('merchantmoev2', 'Merchant Moe V2 Fetcher', runEveryMinutes, configVersion);
  }

  async runSpecific(): Promise<void> {
    this.createDataDirForWorker();

    console.log(
      `[${this.monitoringName}] | block interval constants: ${MerchantMoeV2Constants.CONSTANT_BLOCK_INTERVAL}`
    );

    const poolsData = [];
    const currentBlock = await Web3Utils.getCurrentBlock();

    // this is used to only keep 380 days of data, but still need to fetch trade data since the pool initialize block
    // computing the data is CPU heavy so this avoid computing too old data that we don't use
    // fetching events is not
    const minStartDate = Math.round(Date.now() / 1000) - 200 * 24 * 60 * 60; // min start block is 200 days ago
    const minStartBlock: number = await Web3Utils.getBlocknumberForTimestamp(minStartDate);
    console.log(`[${this.monitoringName}] | minStartBlock is ${minStartBlock}`);

    console.log(`[${this.monitoringName}] | Getting pools to fetch`);

    const poolsToFetch: MerchantMoeV2PairWithFeesAndPool[] = [
      {
        pairToFetch: { token0: 'USDe', token1: 'USDT', placeholder: 'USDe-USDT' },
        fee: 2,
        poolAddress: '0x7ccD8a769d466340Fff36c6e10fFA8cf9077D988'
      }
    ];

    const promise = await this.FetchMerchantMoeV2HistoryForPair(poolsToFetch[0], currentBlock, minStartBlock);
  }

  async FetchMerchantMoeV2HistoryForPair(
    pairWithFeesAndPool: MerchantMoeV2PairWithFeesAndPool,
    currentBlock: number,
    minStartBlock: number
  ) {
    const pairConfig = pairWithFeesAndPool.pairToFetch;

    const logLabel = `[${this.monitoringName}] | [${pairConfig.token0}-${pairConfig.token1}-${pairWithFeesAndPool.fee}] |`;
    console.log(
      `${logLabel} Start for pair ${pairConfig.token0}-${pairConfig.token1} and fees: ${pairWithFeesAndPool.fee}`
    );

    // try to find the json file representation of the pool latest value already fetched
    const latestDataFilePath = getMerchantMoeV2PairLatestDataPath(pairWithFeesAndPool, this.workerName);

    const merchantMoeV2PairContract = MerchantMoeLBPair__factory.connect(
      pairWithFeesAndPool.poolAddress,
      this.web3Provider
    );

    let latestData: MerchantMoeV2PoolData;
    const token0 = this.tokens[pairWithFeesAndPool.pairToFetch.token0];
    const token1 = this.tokens[pairWithFeesAndPool.pairToFetch.token1];

    if (fs.existsSync(latestDataFilePath)) {
      // if the file exists, set its value to latestData
      latestData = JSON.parse(fs.readFileSync(latestDataFilePath, { encoding: 'utf-8' }));
      console.log(`${logLabel} Data file found ${latestDataFilePath}, last block fetched: ${latestData.blockNumber}`);
    } else {
      console.log(`${logLabel} Data file not found, starting from scratch`);

      // verify that the token0 in config is the token0 of the pool
      const poolToken0 = await merchantMoeV2PairContract.getTokenX();
      if (poolToken0.toLowerCase() != token0.address.toLowerCase()) {
        throw new Error(
          `${logLabel} pool token0 ${poolToken0} != config token0 ${token0.address}. config must match pool order`
        );
      }

      // same for token1
      const poolToken1 = await merchantMoeV2PairContract.getTokenY();
      if (poolToken1.toLowerCase() != token1.address.toLowerCase()) {
        throw new Error(
          `${logLabel} pool token0 ${poolToken1} != config token0 ${token1.address}. config must match pool order`
        );
      }

      console.log(
        `${logLabel} Pool address found: ${pairWithFeesAndPool.poolAddress} with pair ${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}`
      );
      latestData = await this.fetchInitializeData(pairWithFeesAndPool.poolAddress, poolToken0, poolToken1);
      latestData.poolAddress = pairWithFeesAndPool.poolAddress;
    }

    const binStepFromContract = await merchantMoeV2PairContract.getBinStep();
    console.log({ binStepFromContract });
    const dataFileName = getMerchantMoeV2PairDataPath(pairWithFeesAndPool, this.workerName);
    if (!fs.existsSync(dataFileName)) {
      fs.writeFileSync(dataFileName, 'blocknumber,data\n');
    }

    const initBlockStep = this.getConfiguration().fixedBlockStep || 50_000;
    let blockStep = initBlockStep;
    let fromBlock = 61786274;
    let toBlock = 0;
    let cptError = 0;
    while (toBlock < currentBlock) {
      toBlock = fromBlock + blockStep - 1;
      if (toBlock > currentBlock) {
        toBlock = currentBlock;
      }

      let events = undefined;

      const topics: ethers.TopicFilter = await translateTopicFilters([
        merchantMoeV2PairContract.filters.DepositedToBins().getTopicFilter(),
        merchantMoeV2PairContract.filters.WithdrawnFromBins().getTopicFilter(),
        merchantMoeV2PairContract.filters.Swap().getTopicFilter()
      ]);

      try {
        events = await (merchantMoeV2PairContract as ethers.BaseContract).queryFilter(topics, fromBlock, toBlock);
      } catch (e) {
        // console.log(`query filter error: ${e.toString()}`);
        blockStep = Math.round(blockStep / 2);
        if (blockStep < 1000) {
          blockStep = 1000;
        }
        toBlock = 0;
        cptError++;
        continue;
      }

      cptError = 0;

      console.log(
        `${logLabel} [${fromBlock} - ${toBlock}] found ${
          events.length
        } DepositedToBins/WithdrawnFromBins/Swap events after ${cptError} errors (fetched ${
          toBlock - fromBlock + 1
        } blocks)`
      );

      if (events.length != 0) {
        this.processEvents(
          merchantMoeV2PairContract,
          events,
          latestData,
          pairWithFeesAndPool,
          latestDataFilePath,
          dataFileName,
          minStartBlock
        );

        // try to find the blockstep to reach 9000 events per call as the RPC limit is 10 000,
        // this try to change the blockstep by increasing it when the pool is not very used
        // or decreasing it when the pool is very used
        blockStep = Math.min(1_000_000, Math.round((blockStep * 8000) / events.length));
        cptError = 0;
      } else {
        // if 0 events, multiply blockstep by 4
        blockStep = blockStep * 4;
      }
      fromBlock = toBlock + 1;
      const fixedBlockStep = this.getConfiguration().fixedBlockStep;
      if (fixedBlockStep) {
        blockStep = fixedBlockStep;
      }
    }

    // // in the end, always save latest data
    // latestData.blockNumber = currentBlock;
    // fs.writeFileSync(latestDataFilePath, JSON.stringify(latestData));

    // return latestData.poolAddress;
  }
  async fetchInitializeData(poolAddress: string, tokenX: string, tokenY: string): Promise<MerchantMoeV2PoolData> {
    // if the file does not exists, it means we start from the beginning
    // fetch the deployed block number for the pool
    const deployedBlock = await Web3Utils.GetContractCreationBlockNumber(poolAddress, this.workerName);
    let fromBlock = deployedBlock;
    let toBlock = deployedBlock + (this.getConfiguration().fixedBlockStep || 100_000);

    console.log(`[${this.monitoringName}] | Searching Initialize event between blocks [${fromBlock} - ${toBlock}]`);

    const merchantMoeV2FactoryContract = MerchantMoeFactory__factory.connect(
      MerchantMoeV2Constants.CONSTANT_FACTORY_ADDRESS,
      this.web3Provider
    );

    const initEvents = await retry(
      () =>
        merchantMoeV2FactoryContract.queryFilter(
          merchantMoeV2FactoryContract.filters.LBPairCreated(tokenX, tokenY),
          fromBlock,
          toBlock
        ),
      []
    );

    let foundEvent;
    if (initEvents.length > 0) {
      for (const e of initEvents) {
        if (e.args.LBPair.toLowerCase() == poolAddress.toLowerCase()) {
          foundEvent = e;
        }
      }
    }

    if (foundEvent) {
      console.log(`[${this.monitoringName}] | found Initialize event at block ${foundEvent.blockNumber}`);

      const binStep = foundEvent.args.binStep;

      console.log(Number(binStep));

      return {
        currentBin: undefined,
        blockNumber: foundEvent.blockNumber - 1, // set to blocknumber -1 to be sure to fetch mint/burn events on same block as initialize,
        binStep: Number(binStep),
        lastCheckpoint: 0, // set to 0 to save liquidity check point at the begining
        lastDataSave: 0, // set to 0 to save data at the beginning
        bins: {},
        poolAddress: poolAddress
      };
    } else {
      console.log(`[${this.monitoringName}] | Initialize event not found between blocks [${fromBlock} - ${toBlock}]`);
      fromBlock = toBlock + 1;
      toBlock = fromBlock + (this.getConfiguration().fixedBlockStep || 100_000);
    }

    throw new Error(`[${this.monitoringName}] | No Initialize event found`);
  }

  async processEvents(
    contract: ethers.BaseContract,
    events: (ethers.ethers.EventLog | ethers.ethers.Log)[],
    latestData: MerchantMoeV2PoolData,
    pairWithFeesAndPool: MerchantMoeV2PairWithFeesAndPool,
    latestDataFilePath: string,
    dataFileName: string,
    minStartBlock: number
  ) {
    const tokenX = this.tokens[pairWithFeesAndPool.pairToFetch.token0];
    const tokenY = this.tokens[pairWithFeesAndPool.pairToFetch.token1];

    const dtStart = Date.now();
    const saveData = [];
    // const priceData = [];
    // const checkpointData = [];
    let lastBlock = events[0].blockNumber;
    for (const event of events) {
      const parsedEvent: ethers.ethers.LogDescription | null = contract.interface.parseLog(event);
      if (!parsedEvent) {
        throw new Error(`Could not parse event ${JSON.stringify(event)}`);
      }

      // this checks that we are crossing a new block, so we will save the price and maybe checkpoint data
      if (
        lastBlock != event.blockNumber &&
        lastBlock >= latestData.lastDataSave + MerchantMoeV2Constants.CONSTANT_BLOCK_INTERVAL &&
        event.blockNumber >= minStartBlock &&
        latestData.currentBin != undefined
      ) {
        const newSaveData = MerchantMoeV2Library.getSaveDataFromLatestData(
          tokenX,
          tokenY,
          latestData,
          pairWithFeesAndPool.pairToFetch.token0,
          pairWithFeesAndPool.pairToFetch.token1
        );
        saveData.push(newSaveData);
      }

      switch (parsedEvent.name.toLowerCase()) {
        case 'depositedtobins':
          // event DepositedToBins(address indexed sender,
          // address indexed to,
          //  uint256[] ids,
          //   bytes32[] amounts);

          for (let i = 0; i < parsedEvent.args.ids.length; i++) {
            const binId = Number(parsedEvent.args.ids[i]);
            const amounts = parsedEvent.args.amounts[i] as string;
            const { tokenXNormalized, tokenYNormalized } = MerchantMoeV2Library.decodeAmounts(amounts, tokenX, tokenY);
            if (!latestData.bins[binId]) {
              latestData.bins[binId] = {
                tokenX: 0,
                tokenY: 0
              };
            }

            latestData.bins[binId].tokenX += tokenXNormalized;
            latestData.bins[binId].tokenY += tokenYNormalized;

            // console.log(
            //   `On bin ${binId}, deposited ${tokenXNormalized} ${tokenX.symbol} and ${tokenYNormalized} ${tokenY.symbol}`
            // );
          }
          latestData.blockNumber = event.blockNumber;

          break;
        case 'withdrawnfrombins':
          // event WithdrawnFromBins(address indexed sender, address indexed to, uint256[] ids, bytes32[] amounts);
          for (let i = 0; i < parsedEvent.args.ids.length; i++) {
            const binId = Number(parsedEvent.args.ids[i]);
            const amounts = parsedEvent.args.amounts[i] as string;
            const { tokenXNormalized, tokenYNormalized } = MerchantMoeV2Library.decodeAmounts(amounts, tokenX, tokenY);
            if (!latestData.bins[binId]) {
              latestData.bins[binId] = {
                tokenX: 0,
                tokenY: 0
              };
            }

            latestData.bins[binId].tokenX -= tokenXNormalized;
            latestData.bins[binId].tokenY -= tokenYNormalized;

            // console.log(
            //   `On bin ${binId}, withdrawn ${tokenXNormalized} ${tokenX.symbol} and ${tokenYNormalized} ${tokenY.symbol}`
            // );
          }

          latestData.blockNumber = event.blockNumber;
          break;
        case 'swap':
          //   event Swap(
          //     address indexed sender,
          //     address indexed to,
          //     uint24 id,
          //     bytes32 amountsIn,
          //     bytes32 amountsOut,
          //     uint24 volatilityAccumulator,
          //     bytes32 totalFees,
          //     bytes32 protocolFees
          // );
          {
            const tokensIn = MerchantMoeV2Library.decodeAmounts(parsedEvent.args.amountsIn, tokenX, tokenY);
            const tokensOut = MerchantMoeV2Library.decodeAmounts(parsedEvent.args.amountsOut, tokenX, tokenY);
            latestData.currentBin = Number(parsedEvent.args.id);
            if (!latestData.bins[latestData.currentBin]) {
              latestData.bins[latestData.currentBin] = {
                tokenX: 0,
                tokenY: 0
              };
            }

            // if (tokensIn.tokenXNormalized > 0) {
            //   console.log(
            //     `On bin ${latestData.currentBin}, swapped ${tokensIn.tokenXNormalized} ${tokenX.symbol} for ${tokensOut.tokenYNormalized} ${tokenY.symbol}`
            //   );
            // } else {
            //   console.log(
            //     `On bin ${latestData.currentBin}, swapped ${tokensIn.tokenYNormalized} ${tokenY.symbol} for ${tokensOut.tokenXNormalized} ${tokenX.symbol}`
            //   );
            // }

            latestData.bins[latestData.currentBin].tokenX += tokensIn.tokenXNormalized;
            latestData.bins[latestData.currentBin].tokenY += tokensIn.tokenYNormalized;
            latestData.bins[latestData.currentBin].tokenX -= tokensOut.tokenXNormalized;
            latestData.bins[latestData.currentBin].tokenY -= tokensOut.tokenYNormalized;
            latestData.blockNumber = event.blockNumber;
          }
          break;
      }

      lastBlock = event.blockNumber;
    }

    if (
      latestData.blockNumber != latestData.lastDataSave &&
      latestData.blockNumber >= latestData.lastDataSave + MerchantMoeV2Constants.CONSTANT_BLOCK_INTERVAL &&
      latestData.blockNumber >= minStartBlock &&
      latestData.currentBin != undefined
    ) {
      const newSaveData = MerchantMoeV2Library.getSaveDataFromLatestData(
        tokenX,
        tokenY,
        latestData,
        pairWithFeesAndPool.pairToFetch.token0,
        pairWithFeesAndPool.pairToFetch.token1
      );
      saveData.push(newSaveData);
    }

    if (saveData.length > 0) {
      fs.appendFileSync(dataFileName, saveData.join(''));
    }

    fs.writeFileSync(latestDataFilePath, JSON.stringify(latestData));
    this.logFnDuration('processEvents', dtStart, events.length, 'event');
  }
}

async function debug() {
  const fetcher = new MerchantMoeV2Fetcher(60, 'mantle');
  await fetcher.run();

  // const filename = './data/merchantmoev2/USDe-USDT-2-latestdata.json';
  // const latestData: MerchantMoeV2PoolData = JSON.parse(fs.readFileSync(filename, 'utf-8'));
  // let totalX = 0;
  // let totalY = 0;
  // for (const bin of Object.keys(latestData.bins)) {
  //   const binData = latestData.bins[Number(bin)];
  //   totalX += binData.tokenX;
  //   totalY += binData.tokenY;
  // }

  // console.log(`pool contains ${totalX} USDe and ${totalY} USDT`);
}

debug();
