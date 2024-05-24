import { BaseFetcher } from '../BaseFetcher';
import {
  CurvePairConfiguration,
  CurveWorkerConfiguration,
  ensureCurvePrecomputedPresent,
  generateCurvePoolSummaryFullName,
  generateFetcherResultFilename,
  generateRawCSVFilePathForCurvePool,
  generateUnifiedCSVFilePath,
  getCurvePoolSummaryFile
} from '../../configuration/WorkerConfiguration';
import * as ethers from 'ethers';
import { sleep } from '../../../utils/Utils';
import { readLastLine } from '../../configuration/Helper';
import { getBlocknumberForTimestamp } from '../../../utils/Web3Utils';
import * as fs from 'fs';
import {
  CryptoV2,
  CurvePool,
  CurveStable,
  ERC20,
  ERC20__factory,
  StableSwap,
  StableSwapFactory,
  SusDCurve,
  TriCryptoFactory,
  TriCryptoV2
} from '../../../contracts/types';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { normalize } from '../../../utils/Utils';
import { TokenWithReserve } from '../../configuration/TokenData';
import {
  computePriceAndSlippageMapForReserveValue,
  computePriceAndSlippageMapForReserveValueCryptoV2
} from '../../../library/CurveLibrary';
import { CurveUtils, CurveContract } from './CurveContract';
import { FetcherResults, PoolData } from '../../../models/dashboard/FetcherResult';
import * as Web3Utils from '../../../utils/Web3Utils';

type BlockData = {
  ampFactor: bigint;
  gamma: bigint;
  D: bigint;
  lpSupply: string;
  priceScale: bigint[];
  tokens: {
    [token: string]: string;
  };
};

type CurveData = {
  isCryptoV2: boolean;
  poolTokens: string[];
  reserveValues: {
    [block: number]: BlockData;
  };
};

export class CurveFetcher extends BaseFetcher<CurveWorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('curve', 'Curve Fetcher', runEveryMinutes);
  }

  SAVE_BLOCK_STEP = 50;

  async runSpecific(): Promise<void> {
    const currentBlock = await Web3Utils.getCurrentBlock();
    const fetchPromises: Promise<TokenWithReserve>[] = [];
    for (const fetchConfig of this.getConfiguration().pairs) {
      fetchPromises.push(this.FetchHistory(fetchConfig, currentBlock));
      await Promise.all(fetchPromises);
      sleep(2000);
    }

    const lastDataResults: TokenWithReserve[] = await Promise.all(fetchPromises);

    const poolsData: PoolData[] = [];
    let cpt = 0;

    const lastResults: { [poolName: string]: TokenWithReserve } = {};
    for (const fetchConfig of this.getConfiguration().pairs) {
      const lastData = lastDataResults[cpt];
      lastResults[`${fetchConfig.poolName}`] = lastData;
      const poolData = {
        tokens: fetchConfig.tokens.map((_) => _.symbol),
        address: fetchConfig.poolAddress,
        label: fetchConfig.poolName
      };

      poolsData.push(poolData);
      cpt++;
    }

    const poolSummaryFullname: string = generateCurvePoolSummaryFullName(this.workerName);
    fs.writeFileSync(poolSummaryFullname, JSON.stringify(lastResults, null, 2));

    const fetcherResult: FetcherResults = {
      dataSourceName: 'curve',
      lastBlockFetched: currentBlock,
      lastRunTimestampMs: Date.now(),
      poolsFetched: poolsData
    };

    fs.writeFileSync(generateFetcherResultFilename(this.workerName), JSON.stringify(fetcherResult, null, 2));

    await this.generateUnifiedFileCurve(currentBlock);
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
   */
  async FetchHistory(fetchConfig: CurvePairConfiguration, currentBlock: number): Promise<TokenWithReserve> {
    console.log(`[${fetchConfig.poolName}]: Start fetching history`);
    const historyFileName = generateRawCSVFilePathForCurvePool(this.workerName, fetchConfig.poolName);
    let startBlock = 0;

    this.createDataDirForWorker();

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
    const curveContract: CurveContract = CurveUtils.getCurveContract(fetchConfig, this.web3Provider);
    const curveTopics: ethers.ethers.TopicFilter[] = await Promise.all(
      CurveUtils.getCurveTopics(curveContract, fetchConfig)
    );
    const topics: ethers.TopicFilter = [
      curveTopics
        .filter((curveTopicList) => curveTopicList.length != 0)
        .filter((curveTopicList) => curveTopicList[0] != null)
        .flatMap((curveTopicList) => {
          if (curveTopicList.length == 0) return [];
          if (curveTopicList[0] == null) return [];
          else return curveTopicList[0].toString();
        })
    ];

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
      await this.fetchReservesDataCryptoV2(fetchConfig, historyFileName, startBlock, allBlocksWithEvents);
    } else {
      await this.fetchReservesData(fetchConfig, historyFileName, startBlock, allBlocksWithEvents);
    }

    // read the lalst line of the file to return lastData
    const lastLine = await readLastLine(historyFileName);
    const lastData: TokenWithReserve = {};
    for (let i = 0; i < fetchConfig.tokens.length; i++) {
      const symbolAndReserve = await this.extractFetchConfigAndNormalize(
        fetchConfig,
        i,
        lastLine,
        fetchConfig.isCryptoV2 ? 5 : 3
      );
      lastData[symbolAndReserve.tokenSymbol] = symbolAndReserve.tokenReserve;
    }

    console.log(`[${fetchConfig.poolName}]: ending mode curve v${fetchConfig.isCryptoV2 ? '2' : '1'}`);
    return lastData;
  }

  async getAllBlocksWithEventsForContractAndTopics(
    fetchConfig: CurvePairConfiguration,
    startBlock: number,
    endBlock: number,
    curveContract: ethers.BaseContract,
    topics: ethers.TopicFilter
  ) {
    const blockSet: Set<number> = new Set();

    let fromBlock = startBlock;
    let blockStep = 100000;
    while (fromBlock <= endBlock) {
      let toBlock = Math.min(endBlock, fromBlock + blockStep - 1);

      try {
        const events = await curveContract.queryFilter(topics, fromBlock, toBlock);

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
    allBlocksWithEvents: number[]
  ) {
    let lastBlockCurrent = lastBlock;
    const multicallProvider = MulticallWrapper.wrap(this.web3Provider);
    const lpTokenContract = ERC20__factory.connect(fetchConfig.lpTokenAddress, multicallProvider);
    const poolContract = CurveUtils.getCurveContract(fetchConfig, multicallProvider);

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
    allBlocksWithEvents: number[]
  ) {
    const multicallProvider = MulticallWrapper.wrap(this.web3Provider);
    const lpTokenContract = ERC20__factory.connect(fetchConfig.lpTokenAddress, multicallProvider);
    const poolContract = CurveUtils.getCurveContract(fetchConfig, multicallProvider);

    if (!this.instanceOfCryptoV2(poolContract)) {
      throw new Error(`Pool Contract for ${fetchConfig.lpTokenName} is not a Crypto V2`);
    }

    await this.fetchReservesDataCryptoV2ForPossibleTypes(
      historyFileName,
      fetchConfig,
      allBlocksWithEvents,
      lastBlock,
      poolContract,
      lpTokenContract
    );
  }

  instanceOfCryptoV2(
    object:
      | StableSwap
      | StableSwapFactory
      | CurvePool
      | SusDCurve
      | CurveStable
      | TriCryptoV2
      | TriCryptoFactory
      | CryptoV2
  ): object is TriCryptoV2 | TriCryptoFactory | CryptoV2 {
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
  }

  async fetchCurveData(
    fetchConfig: CurvePairConfiguration,
    blockNum: number,
    poolContract: CurveContract,
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
      const c = poolContract as CryptoV2;
      promises.push(c.price_scale({ blockTag: blockNum }));
    } else {
      for (let i = 0; i < fetchConfig.tokens.length - 1; i++) {
        const c = poolContract as TriCryptoV2;
        promises.push(c.price_scale(i, { blockTag: blockNum }));
      }
    }

    const promiseResults = await Promise.all(promises);

    const lineToWrite = promiseResults.map((_) => _.toString()).join(',');
    return lineToWrite;
  }

  async extractFetchConfigAndNormalize(
    fetchConfig: CurvePairConfiguration,
    i: number,
    lastLine: string,
    indexOffset: number
  ): Promise<{ tokenSymbol: string; tokenReserve: number }> {
    const tokenSymbol = fetchConfig.tokens[i].symbol;
    const confToken = this.tokens[tokenSymbol];
    const tokenReserve = normalize(lastLine.split(',')[i + indexOffset], confToken.decimals);
    return {
      tokenSymbol: tokenSymbol,
      tokenReserve: tokenReserve
    };
  }

  async generateUnifiedFileCurve(currentBlock: number) {
    const available = this.getAvailableCurve();

    ensureCurvePrecomputedPresent();

    let totalNumberOfPairs = 0;

    for (const base of Object.keys(available)) {
      for (const quote of Object.keys(available[base])) {
        totalNumberOfPairs = totalNumberOfPairs + Object.keys(available[base][quote]).length;
      }
    }

    let currentPoolNumber = 1;

    for (const base of Object.keys(available)) {
      for (const quote of Object.keys(available[base])) {
        for (const pool of Object.keys(available[base][quote])) {
          await this.createUnifiedFileForPair(currentBlock, base, quote, pool, currentPoolNumber++, totalNumberOfPairs);
        }
      }
    }
  }

  getAvailableCurve() {
    const summary = JSON.parse(fs.readFileSync(getCurvePoolSummaryFile(), 'utf-8'));
    const available: { [tokenA: string]: { [tokenB: string]: { [pool: string]: { [token: string]: number } } } } = {};
    for (const poolName of Object.keys(summary)) {
      for (const [token, reserveValue] of Object.entries(summary[poolName])) {
        if (!available[token]) {
          available[token] = {};
        }

        for (const [tokenB, reserveValueB] of Object.entries(summary[poolName])) {
          if (tokenB === token) {
            continue;
          }

          available[token][tokenB] = available[token][tokenB] || {};
          available[token][tokenB][poolName] = available[token][tokenB][poolName] || {};
          available[token][tokenB][poolName][token] = reserveValue as number;
          available[token][tokenB][poolName][tokenB] = reserveValueB as number;
        }
      }
    }
    return available;
  }

  async createUnifiedFileForPair(
    endBlock: number,
    base: string,
    quote: string,
    poolName: string,
    currentPoolNumber: number,
    totalPoolCount: number
  ) {
    const unifiedFullFilename = generateUnifiedCSVFilePath('curve', base + '-' + quote + '-' + poolName);

    const sinceBlock = await this.getStartBlockFromExistingFile(unifiedFullFilename);
    let toWrite = [];

    console.log(
      `Curve: (${currentPoolNumber}/${totalPoolCount}) [${poolName}][${base}-${quote}] getting data since ${sinceBlock} to ${endBlock}`
    );
    const poolData = this.getCurveDataforBlockIntervalAnyVersion(poolName, sinceBlock, endBlock);

    const precisions = [];

    for (const blockNumber of Object.keys(poolData.reserveValues)) {
      const blockNumberInt = parseInt(blockNumber);
      const dataForBlock: BlockData = poolData.reserveValues[blockNumberInt];
      const reserves = [];
      for (const poolToken of poolData.poolTokens) {
        reserves.push(poolData.reserveValues[blockNumberInt].tokens[poolToken]);
      }

      let priceAndSlippage = undefined;
      if (poolData.isCryptoV2) {
        if (precisions.length == 0) {
          for (const token of poolData.poolTokens) {
            const tokenConf = this.tokens[token];
            precisions.push(10n ** BigInt(18 - tokenConf.decimals));
          }
        }

        priceAndSlippage = await computePriceAndSlippageMapForReserveValueCryptoV2(
          base,
          quote,
          poolData.poolTokens,
          dataForBlock.ampFactor,
          reserves,
          precisions,
          dataForBlock.gamma,
          dataForBlock.D,
          dataForBlock.priceScale.map((n) => BigInt(n)),
          this.tokens
        );
      } else {
        priceAndSlippage = await computePriceAndSlippageMapForReserveValue(
          base,
          quote,
          poolData.poolTokens,
          dataForBlock.ampFactor,
          reserves,
          this.tokens
        );
      }

      toWrite.push(`${blockNumber},${priceAndSlippage.price},${JSON.stringify(priceAndSlippage.slippageMap)}\n`);

      if (toWrite.length >= 50) {
        fs.appendFileSync(unifiedFullFilename, toWrite.join(''));
        toWrite = [];
      }
    }

    if (toWrite.length >= 0) {
      fs.appendFileSync(unifiedFullFilename, toWrite.join(''));
    }
  }

  async getStartBlockFromExistingFile(unifiedFullFilename: string): Promise<number> {
    let sinceBlock = 0;

    if (!fs.existsSync(unifiedFullFilename)) {
      fs.writeFileSync(unifiedFullFilename, 'blocknumber,price,slippagemap\n');
    } else {
      const lastLine = await readLastLine(unifiedFullFilename);
      sinceBlock = Number(lastLine.split(',')[0]) + 1;
      if (isNaN(sinceBlock)) {
        sinceBlock = 0;
      }
    }

    if (sinceBlock == 0) {
      const startDate = Math.round(Date.now() / 1000) - 365 * 24 * 60 * 60;
      // get the blocknumber for this date
      sinceBlock = await getBlocknumberForTimestamp(startDate);
    }

    return sinceBlock;
  }

  getCurveDataforBlockIntervalAnyVersion(poolName: string, startBlock: number, endBlock: number): CurveData {
    const rawDataFilePath = generateRawCSVFilePathForCurvePool('curve', poolName);
    const fileContent = fs.readFileSync(rawDataFilePath, 'utf-8').split('\n');

    const headersSplitted = fileContent[0].split(',');
    if (headersSplitted.includes('gamma')) {
      return this.getCurveDataforBlockIntervalCryptoV2(headersSplitted, fileContent, startBlock, endBlock);
    } else {
      return this.getCurveDataforBlockIntervalStandard(headersSplitted, fileContent, startBlock, endBlock);
    }
  }

  getCurveDataforBlockIntervalStandard(
    headersSplitted: string[],
    fileContent: string[],
    startBlock: number,
    endBlock: number
  ): CurveData {
    const dataContents: CurveData = {
      isCryptoV2: false,
      poolTokens: [], // ORDERED
      reserveValues: {}
    };

    for (let i = 3; i < headersSplitted.length; i++) {
      // save the symbol value into pool tokens
      dataContents.poolTokens.push(headersSplitted[i].split('_')[1]);
    }

    let lastValue = undefined;
    for (let i = 1; i < fileContent.length - 1; i++) {
      const line = fileContent[i];
      const splt = line.split(',');
      const blockNum = Number(splt[0]);

      if (blockNum > endBlock) {
        break;
      }

      // if blockNum inferior to startBlock, ignore but save last value
      if (blockNum < startBlock) {
        lastValue = {
          blockNumber: blockNum,
          lineValue: line.toString()
        };
      } else {
        // here it means we went through the sinceBlock, save the last value before
        // reaching sinceBlock to have one previous data
        if (lastValue && blockNum != startBlock) {
          const beforeValueSplitted = lastValue.lineValue.split(',');
          const lastValueBlock = lastValue.blockNumber;

          dataContents.reserveValues[lastValueBlock] = {
            ampFactor: BigInt(beforeValueSplitted[1]),
            lpSupply: beforeValueSplitted[2],
            gamma: 0n,
            D: 0n,
            priceScale: [],
            tokens: {}
          };

          for (let i = 3; i < beforeValueSplitted.length; i++) {
            const token = dataContents.poolTokens[i - 3];
            dataContents.reserveValues[lastValueBlock].tokens[token] = beforeValueSplitted[i];
          }

          // set lastValue to null, meaning we already saved it
          lastValue = null;
        }

        // save current value
        dataContents.reserveValues[blockNum] = {
          ampFactor: BigInt(splt[1]),
          lpSupply: splt[2],
          gamma: 0n,
          D: 0n,
          priceScale: [],
          tokens: {}
        };

        for (let i = 3; i < splt.length; i++) {
          const token = dataContents.poolTokens[i - 3];
          dataContents.reserveValues[blockNum].tokens[token] = splt[i];
        }
      }
    }

    return dataContents;
  }

  getCurveDataforBlockIntervalCryptoV2(
    headersSplitted: string[],
    fileContent: string[],
    startBlock: number,
    endBlock: number
  ): CurveData {
    const dataContents: CurveData = {
      isCryptoV2: true,
      poolTokens: [], // ORDERED
      reserveValues: {}
    };

    for (let i = 5; i < headersSplitted.length; i++) {
      const type = headersSplitted[i].split('_')[0]; // reserve of price_scale

      if (type == 'reserve') {
        // save the symbol value into pool tokens
        dataContents.poolTokens.push(headersSplitted[i].split('_')[1]);
        // poolTokens will contain plain tokens like BTC, WETH, WBTC, USDT
      }
    }

    let lastValue = undefined;
    for (let i = 1; i < fileContent.length - 1; i++) {
      const line = fileContent[i];
      const splt = line.split(',');
      const blockNum = Number(splt[0]);

      if (blockNum > endBlock) {
        break;
      }

      // if blockNum inferior to startBlock, ignore but save last value
      if (blockNum < startBlock) {
        lastValue = {
          blockNumber: blockNum,
          lineValue: line.toString()
        };
      } else {
        // here it means we went through the sinceBlock, save the last value before
        // reaching sinceBlock to have one previous data
        if (lastValue && blockNum != startBlock) {
          const beforeValueSplitted = lastValue.lineValue.split(',');
          const lastValueBlock = lastValue.blockNumber;

          dataContents.reserveValues[lastValueBlock] = {
            ampFactor: BigInt(beforeValueSplitted[1]),
            gamma: BigInt(beforeValueSplitted[2]),
            D: BigInt(beforeValueSplitted[3]),
            lpSupply: beforeValueSplitted[4],
            priceScale: [],
            tokens: {}
          };

          for (let i = 0; i < dataContents.poolTokens.length; i++) {
            const token = dataContents.poolTokens[i];
            dataContents.reserveValues[lastValueBlock].tokens[token] = beforeValueSplitted[i + 5];
          }

          dataContents.reserveValues[lastValueBlock].priceScale = [];
          for (let i = 0; i < dataContents.poolTokens.length - 1; i++) {
            dataContents.reserveValues[lastValueBlock].priceScale.push(
              BigInt(beforeValueSplitted[i + 5 + dataContents.poolTokens.length])
            );
          }

          // set lastValue to null, meaning we already saved it
          lastValue = null;
        }

        // save current value
        dataContents.reserveValues[blockNum] = {
          ampFactor: BigInt(splt[1]),
          gamma: BigInt(splt[2]),
          D: BigInt(splt[3]),
          lpSupply: splt[4],
          priceScale: [],
          tokens: {}
        };

        for (let i = 0; i < dataContents.poolTokens.length; i++) {
          const token = dataContents.poolTokens[i];
          dataContents.reserveValues[blockNum].tokens[token] = splt[i + 5];
        }

        dataContents.reserveValues[blockNum].priceScale = [];
        for (let i = 0; i < dataContents.poolTokens.length - 1; i++) {
          dataContents.reserveValues[blockNum].priceScale.push(BigInt(splt[i + 5 + dataContents.poolTokens.length]));
        }
      }
    }

    return dataContents;
  }
}

// async function debug() {
//   const fetcher = new CurveFetcher(0);
//   await fetcher.runSpecific();
// }

// debug();
