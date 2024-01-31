import { BaseWorker } from '../../BaseWorker';
import {
  CurvePairConfiguration,
  CurveWorkerConfiguration,
  generateCurvePoolFetcherResult,
  generateCurvePoolSummaryFullName,
  generateRawCSVFilePathForCurvePool
} from '../../configuration/WorkerConfiguration';
import * as ethers from 'ethers';
import * as Web3Utils from '../../../utils/Web3Utils';
import { getConfTokenBySymbol, sleep } from '../../../utils/Utils';
import { readLastLine } from '../../configuration/Helper';
import { getBlocknumberForTimestamp } from '../../../utils/Web3Utils';
import * as fs from 'fs';
import {
  CryptoV2,
  CryptoV2__factory,
  CurvePool,
  CurvePool__factory,
  ERC20,
  ERC20__factory,
  StableSwap,
  StableSwapFactory,
  StableSwapFactory__factory,
  StableSwap__factory,
  SusDCurve,
  SusDCurve__factory,
  TriCryptoFactory,
  TriCryptoFactory__factory,
  TriCryptoV2,
  TriCryptoV2__factory
} from '../../../contracts/types';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { normalize } from '../../../utils/Utils';
import { TokenWithReserve } from '../../configuration/TokenData';
import { TypedContractMethod } from 'ethers-multicall-provider/lib/types/common';

interface Swap extends ethers.BaseContract {
  A: TypedContractMethod<[], [bigint], 'view'>;
  gamma?: TypedContractMethod<[], [bigint], 'view'>;
  D?: TypedContractMethod<[], [bigint], 'view'>;
  balances?: TypedContractMethod<[arg0: ethers.BigNumberish], [bigint], 'view'>;
  price_scale?:
    | TypedContractMethod<[k?: ethers.BigNumberish], [bigint], 'view'>
    | TypedContractMethod<[], [bigint], 'view'>;
}

export class CurveFetcher extends BaseWorker<CurveWorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('curve', 'Curve Fetcher', runEveryMinutes);
  }

  SAVE_BLOCK_STEP = 50;

  async runSpecific(): Promise<void> {
    const web3Provider: ethers.JsonRpcProvider = Web3Utils.getJsonRPCProvider();

    const currentBlock = (await web3Provider.getBlockNumber()) - 10;
    const fetchPromises: Promise<TokenWithReserve>[] = [];
    for (const fetchConfig of this.workerConfiguration.pairs) {
      fetchPromises.push(this.FetchHistory(fetchConfig, currentBlock, web3Provider));
      sleep(2000);
    }

    const lastDataResults: TokenWithReserve[] = await Promise.all(fetchPromises);

    const poolsData = [];
    let cpt = 0;

    const lastResults: { [poolName: string]: TokenWithReserve } = {};
    for (const fetchConfig of this.workerConfiguration.pairs) {
      const lastData = lastDataResults[cpt];
      lastResults[`${fetchConfig.poolName}`] = lastData;
      const emptyTokens: string[] = [];
      const poolData = {
        tokens: emptyTokens,
        address: fetchConfig.poolAddress,
        label: fetchConfig.poolName
      };
      for (const token of fetchConfig.tokens) {
        poolData.tokens.push(token.symbol);
      }

      poolsData.push(poolData);
      cpt++;
    }

    const poolSummaryFullname: string = generateCurvePoolSummaryFullName(this.workerName);
    fs.writeFileSync(poolSummaryFullname, JSON.stringify(lastResults, null, 2));

    const fetcherResult = {
      dataSourceName: 'curve',
      lastBlockFetched: currentBlock,
      lastRunTimestampMs: Date.now(),
      poolsFetched: poolsData
    };

    const fetcherResultFullname: string = generateCurvePoolFetcherResult(this.workerName);
    fs.writeFileSync(fetcherResultFullname, JSON.stringify(fetcherResult, null, 2));

    throw new Error('Method not implemented.');
  }

  //    ___ ___ _____ ___ _  _   ___ _   _ _  _  ___ _____ ___ ___  _  _ ___
  //   | __| __|_   _/ __| || | | __| | | | \| |/ __|_   _|_ _/ _ \| \| / __|
  //   | _|| _|  | || (__| __ | | _|| |_| | .` | (__  | |  | | (_) | .` \__ \
  //   |_| |___| |_| \___|_||_| |_|  \___/|_|\_|\___| |_| |___\___/|_|\_|___/
  //

  /**
   * Takes a fetchConfig from curve.config.js and outputs liquidity file in /data
   * @param {{poolAddress: string, poolName: string, version: number, abi: string, ampFactor: number, additionnalTransferEvents: {[symbol: string]: string[]}}} fetchConfig
   * @param {number} currentBlock
   * @param {StaticJsonRpcProvider} web3Provider
   */
  async FetchHistory(
    fetchConfig: CurvePairConfiguration,
    currentBlock: number,
    web3Provider: ethers.JsonRpcProvider
  ): Promise<TokenWithReserve> {
    console.log(`[${fetchConfig.poolName}]: Start fetching history`);
    const historyFileName = generateRawCSVFilePathForCurvePool(this.workerName, fetchConfig.poolName);
    let startBlock = 0;

    if (fs.existsSync(historyFileName)) {
      const lastLine = await readLastLine(historyFileName);
      startBlock = Number(lastLine.split(',')[0]) + 1;
    } else {
      // by default, fetch for the last 380 days (a bit more than 1 year)
      const startDate = Math.round(Date.now() / 1000) - 380 * 24 * 60 * 60;
      startBlock = await getBlocknumberForTimestamp(startDate);
    }

    // this is done for the tricryptoUSDC pool because the first liquidity values are too low for
    // the liquidity algorithm to work. Dunno why
    if (fetchConfig.minBlock && startBlock < fetchConfig.minBlock) {
      startBlock = fetchConfig.minBlock;
    }

    // fetch all blocks where an event occured since startBlock
    const curveContract: Swap = this.getCurveContract(fetchConfig, web3Provider);
    const curveTopics = await Promise.all(this.getCurveTopics(curveContract, fetchConfig));
    const topics: ethers.ethers.TopicFilter = curveTopics.map((curveTopicList) => curveTopicList[0]);

    const allBlocksWithEvents: number[] = await this.getAllBlocksWithEventsForContractAndTopics(
      fetchConfig,
      startBlock,
      currentBlock,
      curveContract,
      topics
    );
    console.log(
      `[${fetchConfig.poolName}]: found ${allBlocksWithEvents.length} blocks with events since ${startBlock}`
    );

    if (fetchConfig.isCryptoV2) {
      await this.fetchReservesDataCryptoV2(fetchConfig, historyFileName, startBlock, web3Provider, allBlocksWithEvents);
    } else {
      await this.fetchReservesData(fetchConfig, historyFileName, startBlock, web3Provider, allBlocksWithEvents);
    }

    // read the lalst line of the file to return lastData
    const lastLine = await readLastLine(historyFileName);
    const lastData: TokenWithReserve = {};
    for (let i = 0; i < fetchConfig.tokens.length; i++) {
      const symbolAndReserve = extractFetchConfigAndNormalize(fetchConfig, i, lastLine);
      lastData[symbolAndReserve.tokenSymbol] = symbolAndReserve.tokenReserve;
    }

    console.log(`[${fetchConfig.poolName}]: ending mode curve v${fetchConfig.isCryptoV2 ? '2' : '1'}`);
    return lastData;
  }

  getCurveContract(
    fetchConfig: CurvePairConfiguration,
    web3Provider: ethers.JsonRpcProvider
  ): StableSwap | StableSwapFactory | CurvePool | SusDCurve | TriCryptoV2 | TriCryptoFactory | CryptoV2 {
    switch (fetchConfig.abi.toLowerCase()) {
      case 'stableswap':
        return StableSwap__factory.connect(fetchConfig.poolAddress, web3Provider);
      case 'stableswapfactory':
        return StableSwapFactory__factory.connect(fetchConfig.poolAddress, web3Provider);
      case 'curvepool':
        return CurvePool__factory.connect(fetchConfig.poolAddress, web3Provider);
      case 'susdpool':
        return SusDCurve__factory.connect(fetchConfig.poolAddress, web3Provider);
      case 'tricryptov2':
        return TriCryptoV2__factory.connect(fetchConfig.poolAddress, web3Provider);
      case 'tricryptov2factory':
        return TriCryptoFactory__factory.connect(fetchConfig.poolAddress, web3Provider);
      case 'cryptov2':
        return CryptoV2__factory.connect(fetchConfig.poolAddress, web3Provider);
      default:
        throw new Error(`Unknown abi: ${fetchConfig.abi}`);
    }
  }

  getCurveTopics(
    curveContract: ethers.BaseContract,
    fetchConfig: CurvePairConfiguration
  ): Promise<ethers.ethers.TopicFilter>[] {
    switch (fetchConfig.abi.toLowerCase()) {
      case 'stableswap':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.TokenExchangeUnderlying().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.RampA().getTopicFilter(),
          curveContract.filters.StopRampA().getTopicFilter()
        ];
      case 'stableswapfactory':
        return [
          curveContract.filters.Transfer().getTopicFilter(),
          curveContract.filters.Approval().getTopicFilter(),
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.RampA().getTopicFilter()
        ];
      case 'curvepool':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.RampA().getTopicFilter(),
          curveContract.filters.StopRampA().getTopicFilter()
        ];
      case 'susdpool':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.TokenExchangeUnderlying().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter()
        ];
      case 'tricryptov2':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter(),
          curveContract.filters.RampAgamma().getTopicFilter()
        ];

      case 'tricryptov2factory':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter(),
          curveContract.filters.RampAgamma().getTopicFilter()
        ];
      case 'cryptov2':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter(),
          curveContract.filters.RampAgamma().getTopicFilter()
        ];
      default:
        throw new Error(`Unknown abi: ${fetchConfig.abi}`);
    }
  }

  async getAllBlocksWithEventsForContractAndTopics(
    fetchConfig: CurvePairConfiguration,
    startBlock: number,
    endBlock: number,
    curveContract: ethers.BaseContract,
    topics: ethers.ethers.TopicFilter
  ) {
    const blockSet: Set<number> = new Set();

    let fromBlock = startBlock;
    let blockStep = 100000;
    while (fromBlock <= endBlock) {
      let toBlock = Math.min(endBlock, fromBlock + blockStep - 1);

      try {
        const events = await curveContract.queryFilter(topics, fromBlock, toBlock);

        /* Problem: The previous call now authorize only 4 parameters. TODO fix this */

        console.log(
          `${this.workerName}[${fetchConfig.poolName}-${fetchConfig.lpTokenName}]: [${fromBlock} - ${toBlock}] found ${
            events.length
          } events (fetched ${toBlock - fromBlock + 1} blocks)`
        );

        if (events.length != 0) {
          for (const e of events) {
            blockSet.add(e.blockNumber);
          }

          const newBlockStep = Math.min(1_000_000, Math.round((blockStep * 8000) / events.length));
          if (newBlockStep > blockStep * 2) {
            blockStep = blockStep * 2;
          } else {
            blockStep = newBlockStep;
          }
        } else {
          // if 0 events, multiply blockstep by 2
          blockStep = blockStep * 2;
        }

        fromBlock = toBlock + 1;
      } catch (e) {
        console.log('query filter error:', e);
        blockStep = Math.round(blockStep / 2);
        if (blockStep < 1000) {
          blockStep = 1000;
        }
        toBlock = 0;
        await sleep(2000);
        continue;
      }
    }

    return Array.from(blockSet);
  }

  async fetchReservesData(
    fetchConfig: CurvePairConfiguration,
    historyFileName: string,
    lastBlock: number,
    web3Provider: ethers.ethers.JsonRpcProvider,
    allBlocksWithEvents: number[]
  ) {
    let lastBlockCurrent = lastBlock;
    const multicallProvider = MulticallWrapper.wrap(web3Provider);
    const lpTokenContract = ERC20__factory.connect(fetchConfig.lpTokenAddress, multicallProvider);
    const poolContract = this.getCurveContract(fetchConfig, multicallProvider);

    if (!fs.existsSync(historyFileName)) {
      const tokensStr = [];
      for (const token of fetchConfig.tokens) {
        tokensStr.push(`reserve_${token.symbol}_${token.address}`);
      }

      fs.writeFileSync(
        historyFileName,
        `blocknumber,ampFactor,lp_supply_${fetchConfig.lpTokenAddress},${tokensStr.join(',')}\n`
      );
    }

    for (const blockNum of allBlocksWithEvents) {
      if (blockNum - this.SAVE_BLOCK_STEP < lastBlockCurrent) {
        console.log(`fetchReservesData[${fetchConfig.poolName}]: ignoring block ${blockNum}`);
        continue;
      }

      const lineToWrite = await this.fetchCurveData(fetchConfig, blockNum, poolContract, lpTokenContract);
      fs.appendFileSync(historyFileName, `${blockNum},${lineToWrite}\n`);
      lastBlockCurrent = blockNum;
    }
  }

  async fetchReservesDataCryptoV2(
    fetchConfig: CurvePairConfiguration,
    historyFileName: string,
    lastBlock: number,
    web3Provider: ethers.ethers.JsonRpcProvider,
    allBlocksWithEvents: number[]
  ) {
    let lastBlockCurrent = lastBlock;
    const multicallProvider = MulticallWrapper.wrap(web3Provider);
    const lpTokenContract = ERC20__factory.connect(fetchConfig.lpTokenAddress, multicallProvider);
    const poolContract = this.getCurveContract(fetchConfig, multicallProvider);

    if (!this.instanceOfCryptoV2(poolContract)) {
      throw new Error(`Pool Contract for ${fetchConfig.lpTokenName} is not a Crypto V2`);
    }

    lastBlockCurrent = await this.fetchReservesDataCryptoV2ForPossibleTypes(
      historyFileName,
      fetchConfig,
      allBlocksWithEvents,
      lastBlockCurrent,
      poolContract,
      lpTokenContract
    );
  }

  instanceOfCryptoV2(object: any): object is TriCryptoV2 | TriCryptoFactory | CryptoV2 {
    return true;
  }

  async fetchReservesDataCryptoV2ForPossibleTypes(
    historyFileName: string,
    fetchConfig: CurvePairConfiguration,
    allBlocksWithEvents: number[],
    lastBlockCurrent: number,
    poolContract: TriCryptoV2 | TriCryptoFactory | CryptoV2,
    lpTokenContract: ERC20
  ) {
    if (!fs.existsSync(historyFileName)) {
      const tokensStr = [];
      for (const token of fetchConfig.tokens) {
        tokensStr.push(`reserve_${token.symbol}`);
      }

      const priceScaleStr = [];
      for (let i = 1; i < fetchConfig.tokens.length; i++) {
        priceScaleStr.push(`price_scale_${fetchConfig.tokens[i].symbol}`);
      }

      fs.writeFileSync(
        historyFileName,
        `blocknumber,ampFactor,gamma,D,lp_supply,${tokensStr.join(',')},${priceScaleStr.join(',')}\n`
      );
    }

    for (const blockNum of allBlocksWithEvents) {
      if (blockNum - this.SAVE_BLOCK_STEP < lastBlockCurrent) {
        console.log(`fetchReservesData[${fetchConfig.poolName}]: ignoring block ${blockNum}`);
        continue;
      }

      const lineToWrite = await this.fetchCurveDataCryptoV2(fetchConfig, blockNum, poolContract, lpTokenContract);
      fs.appendFileSync(historyFileName, `${blockNum},${lineToWrite}\n`);
      lastBlockCurrent = blockNum;
    }
    return lastBlockCurrent;
  }

  async fetchCurveData(
    fetchConfig: CurvePairConfiguration,
    blockNum: number,
    poolContract: Swap,
    lpTokenContract: ERC20
  ) {
    console.log(`fetchReservesData[${fetchConfig.poolName}]: Working on block ${blockNum}`);

    const promises = [];
    promises.push(poolContract.A({ blockTag: blockNum }));
    promises.push(lpTokenContract.totalSupply({ blockTag: blockNum }));
    for (let i = 0; i < fetchConfig.tokens.length; i++) {
      if (poolContract.balances != undefined) promises.push(poolContract.balances(i, { blockTag: blockNum }));
    }

    const promiseResults = await Promise.all(promises);
    const lineToWrite = promiseResults.map((_) => _.toString()).join(',');
    return lineToWrite;
  }

  async fetchCurveDataCryptoV2(
    fetchConfig: CurvePairConfiguration,
    blockNum: number,
    poolContract: TriCryptoV2 | TriCryptoFactory | CryptoV2,
    lpTokenContract: ERC20
  ) {
    console.log(`fetchReservesData[${fetchConfig.poolName}]: Working on block ${blockNum}`);

    const promises = [];
    promises.push(poolContract.A({ blockTag: blockNum }));
    promises.push(poolContract.gamma({ blockTag: blockNum }));
    promises.push(poolContract.D({ blockTag: blockNum }));
    promises.push(lpTokenContract.totalSupply({ blockTag: blockNum }));
    for (let i = 0; i < fetchConfig.tokens.length; i++) {
      promises.push(poolContract.balances(i, { blockTag: blockNum }));
    }

    // when only two crypto, price_scale is not an array, it's a normal field...
    if (fetchConfig.tokens.length == 2) {
      promises.push(poolContract.price_scale(blockNum));
    } else {
      for (let i = 0; i < fetchConfig.tokens.length - 1; i++) {
        promises.push(poolContract.price_scale(i, blockNum));
      }
    }

    const promiseResults = await Promise.all(promises);

    const lineToWrite = promiseResults.map((_) => _.toString()).join(',');
    return lineToWrite;
  }
}

function extractFetchConfigAndNormalize(
  fetchConfig: CurvePairConfiguration,
  i: number,
  lastLine: string
): { tokenSymbol: string; tokenReserve: number } {
  const tokenSymbol = fetchConfig.tokens[i].symbol;
  const confToken = getConfTokenBySymbol(tokenSymbol);
  const tokenReserve = normalize(lastLine.split(',')[i + 5], confToken.decimals);
  return {
    tokenSymbol: tokenSymbol,
    tokenReserve: tokenReserve
  };
}
