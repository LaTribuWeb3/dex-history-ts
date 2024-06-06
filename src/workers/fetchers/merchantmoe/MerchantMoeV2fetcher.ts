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
import retry from '../../../utils/Utils';

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
      latestData = await this.fetchInitializeData(pairWithFeesAndPool.poolAddress, merchantMoeV2PairContract);
      latestData.poolAddress = pairWithFeesAndPool.poolAddress;
    }

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
        console.log(events[0]);
        // this.processEvents(
        //   univ3PairContract,
        //   events,
        //   latestData,
        //   pairWithFeesAndPool,
        //   latestDataFilePath,
        //   dataFileName,
        //   minStartBlock
        // );

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
  async fetchInitializeData(
    poolAddress: string,
    merchantMoeV2PairContract: MerchantMoeLBPair
  ): Promise<MerchantMoeV2PoolData> {
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
          merchantMoeV2FactoryContract.filters['LBPairCreated(address,address,uint256,address,uint256)'],
          fromBlock,
          toBlock
        ),
      []
    );

    if (initEvents.length > 0) {
      if (initEvents.length > 1) {
        throw new Error(`[${this.monitoringName}] | More than 1 Initialize event found???`);
      }

      ///// CHECK TO SEE IF IT IS THE RIGHT EVENT FOR THE POOL VIA THE TOKENS
      /////////// TO DO
      ///////////// TO DOOOOOOOOOOOOOOOO
      ///////////

      console.log(`[${this.monitoringName}] | found Initialize event at block ${initEvents[0].blockNumber}`);

      const binStep = await retry(() => merchantMoeV2PairContract.getBinStep(), []);

      console.log(Number(binStep));

      return {
        currentBin: 0,
        blockNumber: initEvents[0].blockNumber - 1, // set to blocknumber -1 to be sure to fetch mint/burn events on same block as initialize,
        binSteps: Number(binStep),
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
}

async function debug() {
  const fetcher = new MerchantMoeV2Fetcher(60, 'mantle');
  await fetcher.run();
}

debug();
