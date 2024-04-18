import { BaseWorker } from '../../BaseWorker';
import * as ethers from 'ethers';
import * as fs from 'fs';
import * as Constants from '../../../utils/Constants';
import * as Web3Utils from '../../../utils/Web3Utils';
import * as Sync from '../../../utils/Sync';
import retry, { normalize } from '../../../utils/Utils';
import { UniswapV2Factory__factory } from '../../../contracts/types/factories/uniswapv2/UniswapV2Factory__factory';
import { UniswapV2Pair__factory } from '../../../contracts/types/factories/uniswapv2/UniswapV2Pair__factory';
import * as Helper from '../../configuration/Helper';
import path, { dirname } from 'path';
import { readLastLine } from '../../configuration/Helper';
import {
  UniSwapV2WorkerConfiguration,
  getAllPreComputed,
  generatePriceCSVFilePath,
  generateRawCSVFilePathForPair,
  generateUnifiedCSVFilePath,
  listAllExistingRawPairs,
  generateFetcherResultFilename
} from '../../configuration/WorkerConfiguration';
import { ComputeLiquidityXYKPool, ComputeXYKPrice } from '../../../library/XYKLibrary';
import { FetcherResults, PoolData } from '../../../models/dashboard/FetcherResult';

export class UniswapV2Fetcher extends BaseWorker<UniSwapV2WorkerConfiguration> {
  constructor(runEveryMinutes: number, workerName = 'uniswapv2', monitoringName = 'UniswapV2 Fetcher') {
    super(workerName, monitoringName, runEveryMinutes);
  }

  async runSpecific(): Promise<void> {
    const web3Provider: ethers.JsonRpcProvider = Web3Utils.getJsonRPCProvider();
    const endBlock: number = (await web3Provider.getBlockNumber()) - 10;

    this.createDataDirForWorker();

    let startBlock = 0;
    const stalePools = [];
    const poolsData: PoolData[] = [];
    for (const pairKey of this.workerConfiguration.pairs) {
      if (pairKey.startBlock != undefined) {
        startBlock = pairKey.startBlock;
      } else {
        startBlock = 0;
      }
      const fetchResult = await this.FetchHistoryForPair(pairKey.name, endBlock, startBlock);
      if (fetchResult.isStale) {
        stalePools.push(pairKey);
      }

      const token0Symbol = pairKey.name.split('-')[0];
      const token1Symbol = pairKey.name.split('-')[1];

      poolsData.push({
        tokens: [token0Symbol, token1Symbol],
        address: fetchResult.pairAddress,
        label: ''
      });
    }

    if (stalePools.length > 0) {
      console.warn(`Stale pools: ${stalePools.join(',')}`);
    }

    const fetcherResult: FetcherResults = {
      dataSourceName: this.workerName,
      lastBlockFetched: endBlock,
      lastRunTimestampMs: Date.now(),
      poolsFetched: poolsData
    };

    fs.writeFileSync(generateFetcherResultFilename(this.workerName), JSON.stringify(fetcherResult, null, 2));

    // generate unified files
    await this.generateUnifiedFileUniv2(endBlock);

    // truncate all files to 1 year
    const timestampLastYear = Math.round(Date.now() / 1000) - 365 * 24 * 60 * 60; // in seconds
    const blockLastYear = await retry(Web3Utils.getBlocknumberForTimestamp, [timestampLastYear]);
    this.truncateUnifiedFiles(this.workerName, blockLastYear);
  }

  //    ___ ___ _____ ___ _  _   ___ _   _ _  _  ___ _____ ___ ___  _  _ ___
  //   | __| __|_   _/ __| || | | __| | | | \| |/ __|_   _|_ _/ _ \| \| / __|
  //   | _|| _|  | || (__| __ | | _|| |_| | .` | (__  | |  | | (_) | .` \__ \
  //   |_| |___| |_| \___|_||_| |_|  \___/|_|\_|\___| |_| |___\___/|_|\_|___/
  //

  async FetchHistoryForPair(pairKey: string, currentBlock: number, minStartBlock: number) {
    const web3Provider: ethers.JsonRpcProvider = Web3Utils.getJsonRPCProvider();

    const historyFileName = generateRawCSVFilePathForPair(this.workerName, pairKey);

    const token0Symbol = pairKey.split('-')[0];
    const token0Address: string = this.tokens[token0Symbol].address;
    const token1Symbol = pairKey.split('-')[1];
    const token1Address: string = this.tokens[token1Symbol].address;
    const uniswapV2Factory = UniswapV2Factory__factory.connect(this.workerConfiguration.factoryAddress, web3Provider);

    const pairAddress: string = await uniswapV2Factory.getPair(token0Address, token1Address);

    if (pairAddress == ethers.ZeroAddress) {
      throw new Error(`Could not find address with tokens  ${token0Symbol} and ${token1Symbol}`);
    }

    const pairContract = UniswapV2Pair__factory.connect(pairAddress, web3Provider);

    const contractToken0: string = await pairContract.token0();

    if (contractToken0.toLowerCase() != token0Address.toLowerCase()) {
      throw new Error('Order mismatch between configuration and uniswapv2 pair');
    }

    const contractToken1: string = await pairContract.token1();

    if (contractToken1.toLowerCase() != token1Address.toLowerCase()) {
      throw new Error('Order mismatch between configuration and uniswapv2 pair');
    }

    const initBlockStep = 500000;

    let startBlock = 0;
    if (!fs.existsSync(historyFileName)) {
      // TODO Move to Utils / Writer (un autre paquet)
      Sync.writeContentToFile(
        historyFileName,
        `blocknumber,reserve_${token0Symbol}_${token0Address},reserve_${token1Symbol}_${token1Address}\n`
      );
    } else {
      const lastLine = await Helper.readLastLine(historyFileName);
      startBlock = Number(lastLine.split(',')[0]) + 1;
    }

    if (!startBlock) {
      const deployBlockNumber = await retry(Web3Utils.GetContractCreationBlockNumber, [pairAddress, this.workerName]);

      if (!deployBlockNumber) {
        throw new Error('Deploy block is null when getting the pair address creation block');
      }
      startBlock = deployBlockNumber + 100_000; // leave 100k blocks ~2 weeks after pool creation because many pools starts with weird data
    }

    if (startBlock < minStartBlock) {
      startBlock = minStartBlock;
    }

    console.log(
      `${this.workerName}[${pairKey}]: start fetching data for ${
        currentBlock - startBlock
      } blocks to reach current block: ${currentBlock}`
    );

    let liquidityValues = [];

    let blockStep = initBlockStep;
    let fromBlock = startBlock;
    let toBlock = 0;
    let cptError = 0;
    let lastEventBlock = startBlock;
    while (toBlock < currentBlock) {
      toBlock = fromBlock + blockStep - 1;
      if (toBlock > currentBlock) {
        toBlock = currentBlock;
      }

      let events = undefined;
      try {
        events = await pairContract.queryFilter(pairContract.filters.Sync(), fromBlock, toBlock);
      } catch (e) {
        // console.log(`query filter error: ${e.toString()}`);
        blockStep = Math.max(10, Math.round(blockStep / 2));
        toBlock = 0;
        cptError++;
        if (cptError >= 100) {
          throw new Error('Too many errors');
        }
        continue;
      }

      console.log(
        `${this.workerName}[${pairKey}]: [${fromBlock} - ${toBlock}] found ${
          events.length
        } Sync events after ${cptError} errors (fetched ${toBlock - fromBlock + 1} blocks)`
      );
      cptError = 0;

      if (events.length > 0) {
        if (events.length == 1) {
          lastEventBlock = events[0].blockNumber;
          liquidityValues.push({
            blockNumber: events[0].blockNumber,
            reserve0: events[0].args.reserve0.toString(),
            reserve1: events[0].args.reserve1.toString()
          });
        } else {
          let previousEvent = events[0];
          // for each events, we will only save the last event of a block
          for (let i = 1; i < events.length; i++) {
            const workingEvent = events[i];
            lastEventBlock = events[i].blockNumber;

            // we save the 'previousEvent' when the workingEvent block number is different than the previousEvent
            if (workingEvent.blockNumber != previousEvent.blockNumber) {
              liquidityValues.push({
                blockNumber: previousEvent.blockNumber,
                reserve0: previousEvent.args.reserve0.toString(),
                reserve1: previousEvent.args.reserve1.toString()
              });
            }

            if (i == events.length - 1) {
              // always save the last event
              liquidityValues.push({
                blockNumber: workingEvent.blockNumber,
                reserve0: workingEvent.args.reserve0.toString(),
                reserve1: workingEvent.args.reserve1.toString()
              });
            }

            previousEvent = workingEvent;
          }
        }

        if (liquidityValues.length >= Number(process.env.MINIMUM_TO_APPEND || '5000')) {
          const textToAppend = liquidityValues.map((_) => `${_.blockNumber},${_.reserve0},${_.reserve1}`);
          fs.appendFileSync(historyFileName, textToAppend.join('\n') + '\n');
          liquidityValues = [];
        }

        // try to find the blockstep to reach 8000 events per call as the RPC limit is 10 000,
        // this try to change the blockstep by increasing it when the pool is not very used
        // or decreasing it when the pool is very used
        blockStep = Math.min(1000000, Math.round((blockStep * 8000) / events.length));
      }

      fromBlock = toBlock + 1;
    }

    if (liquidityValues.length > 0) {
      const textToAppend = liquidityValues.map((_) => `${_.blockNumber},${_.reserve0},${_.reserve1}`);
      fs.appendFileSync(historyFileName, textToAppend.join('\n') + '\n');
    }

    // return true if the last event fetched is more than 500k blocks old
    return { isStale: lastEventBlock < currentBlock - 500_000, pairAddress: pairAddress };
  }

  async generateUnifiedFileUniv2(endBlock: number) {
    const available = this.getAvailableUniswapV2();
    for (const base of Object.keys(available)) {
      for (const quote of available[base]) {
        await this.createUnifiedFileForPair(endBlock, base, quote);
      }
    }
  }

  /**
   * Truncate all unified files for a platform, keeping only data after 'oldestBlockToKeep'.
   * @param platform - The platform identifier.
   * @param oldestBlockToKeep - The oldest block number to keep in the files.
   */
  truncateUnifiedFiles(platform: string, oldestBlockToKeep: number): void {
    const allUnifiedFilesForDirectory: string[] = getAllPreComputed(platform);

    for (const unifiedFileToProcess of allUnifiedFilesForDirectory) {
      console.log(`truncateUnifiedFiles: working on ${unifiedFileToProcess}`);
      const linesToKeep: string[] = ['blocknumber,price,slippagemap\n'];
      const linesToProcess: string[] = fs.readFileSync(unifiedFileToProcess, 'utf-8').split('\n'); // To put in the helper with a condition as well
      let deletedLines = 0;

      for (let i = 1; i < linesToProcess.length - 1; i++) {
        const lineToProcess: string = linesToProcess[i];
        if (lineToProcess) {
          const blockNumber = Number(lineToProcess.split(',')[0]);
          if (blockNumber > oldestBlockToKeep) {
            linesToKeep.push(lineToProcess + '\n');
          } else {
            deletedLines++;
          }
        }
      }

      if (deletedLines === 0) {
        console.log(`truncateUnifiedFiles: no data to be truncated from ${unifiedFileToProcess}`);
        continue;
      }

      const stagingFilepath: string = unifiedFileToProcess + '-staging';
      fs.writeFileSync(stagingFilepath, linesToKeep.join(''));
      console.log(
        `truncateUnifiedFiles: ${unifiedFileToProcess} will be truncated from ${linesToProcess.length} to ${linesToKeep.length} lines`
      );
      // Adjust the retrySync function as per your project's implementation.
      fs.renameSync(stagingFilepath, unifiedFileToProcess);
    }
  }

  /**
   * Read all the csv files to check what pairs are available
   * @returns {{[base: string]: string[]}}
   */
  getAvailableUniswapV2(): { [base: string]: string[] } {
    const available: { [base: string]: string[] } = {};
    // generateRawCSVFilePath
    const pairs = listAllExistingRawPairs(this.workerName);
    for (const pair of pairs) {
      const tokenA = pair.split('-')[0];
      const tokenB = pair.split('-')[1];
      if (!available[tokenA]) {
        available[tokenA] = [];
      }
      if (!available[tokenB]) {
        available[tokenB] = [];
      }
      available[tokenA].push(tokenB);
      available[tokenB].push(tokenA);
    }

    return available;
  }

  async createUnifiedFileForPair(endBlock: number, fromSymbol: string, toSymbol: string) {
    console.log(`${this.workerName}: create/append for ${fromSymbol} ${toSymbol}`);
    const unifiedFullFilename = generateUnifiedCSVFilePath(this.workerName, fromSymbol + '-' + toSymbol);
    const unifiedFullFilenamePrice = generatePriceCSVFilePath(this.workerName, fromSymbol + '-' + toSymbol);
    let sinceBlock = 0;
    const toWrite = [];
    const toWritePrice = [];
    if (!fs.existsSync(unifiedFullFilename)) {
      fs.mkdirSync(dirname(unifiedFullFilename), { recursive: true });
      fs.writeFileSync(unifiedFullFilename, 'blocknumber,price,slippagemap\n');
    } else {
      const lastLine = await readLastLine(unifiedFullFilename);
      sinceBlock = Number(lastLine.split(',')[0]) + 1;
      if (isNaN(sinceBlock)) {
        sinceBlock = 0;
      }
    }

    if (!fs.existsSync(unifiedFullFilenamePrice)) {
      fs.mkdirSync(dirname(unifiedFullFilenamePrice), { recursive: true });
      fs.writeFileSync(unifiedFullFilenamePrice, 'blocknumber,price\n');
    }

    console.log(`${this.workerName}: getting data since ${sinceBlock} to ${endBlock}`);
    const univ2Data: {
      [blockNumber: string]: {
        fromReserve: string;
        toReserve: string;
      };
    } = this.getUniV2DataforBlockInterval(fromSymbol, toSymbol, sinceBlock, endBlock);
    const fromConf = this.tokens[fromSymbol]; // tokens was precomputed by main class
    const toConf = this.tokens[toSymbol];

    let lastSavedBlock: number = sinceBlock - 1;
    for (const blockNumber in univ2Data) {
      const data = univ2Data[blockNumber];
      const normalizedFrom = normalize(data.fromReserve, fromConf.decimals);
      const normalizedTo = normalize(data.toReserve, toConf.decimals);
      const price = ComputeXYKPrice(normalizedFrom, normalizedTo);

      // only save every 50 blocks
      if (lastSavedBlock + 50 > +blockNumber) {
        // This will cast number to a number
        // just save the price
        toWritePrice.push(`${blockNumber},${price}\n`);
        continue;
      }

      const slippageMap: {
        [slippageBps: string]: {
          quote: number;
          base: number;
        };
      } = {};
      for (let slippageBps = 50; slippageBps <= 2000; slippageBps += 50) {
        slippageMap[slippageBps] = ComputeLiquidityXYKPool(normalizedFrom, normalizedTo, slippageBps / 10000);
      }

      lastSavedBlock = Number(blockNumber);
      toWrite.push(`${blockNumber},${price},${JSON.stringify(slippageMap)}\n`);
      toWritePrice.push(`${blockNumber},${price}\n`);
    }

    if (toWrite.length == 0) {
      console.log(`${this.workerName}: nothing to add to file`);
    } else {
      fs.appendFileSync(unifiedFullFilename, toWrite.join(''));
    }

    if (toWritePrice.length == 0) {
      console.log(`${this.workerName}: nothing to add to price file`);
    } else {
      fs.appendFileSync(unifiedFullFilenamePrice, toWritePrice.join(''));
    }
  }

  getUniV2DataforBlockInterval(
    fromSymbol: string,
    toSymbol: string,
    fromBlock: number,
    toBlock: number
  ): { [blockNumber: string]: { fromReserve: string; toReserve: string } } {
    const fileInfo = this.getUniV2DataFile(fromSymbol, toSymbol);
    if (!fileInfo) {
      throw new Error(`Could not find pool data for ${fromSymbol}/${toSymbol} on uniswapv2`);
    }
    // load the file in RAM
    const fileContent = fs.readFileSync(fileInfo.path, 'utf-8').split('\n');

    const results: { [blockNumber: string]: { fromReserve: string; toReserve: string } } = {};

    for (let i = 1; i < fileContent.length - 1; i++) {
      const line = fileContent[i];
      const splitted = line.split(',');
      const blockNumber = Number(splitted[0]);
      if (blockNumber < fromBlock) {
        continue;
      }

      if (blockNumber > toBlock) {
        break;
      }

      results[blockNumber] = {
        fromReserve: fileInfo.reverse ? splitted[2] : splitted[1],
        toReserve: fileInfo.reverse ? splitted[1] : splitted[2]
      };
    }

    return results;
  }

  getUniV2DataFile(fromSymbol: string, toSymbol: string) {
    let filePath = generateRawCSVFilePathForPair(this.workerName, `${fromSymbol}-${toSymbol}`);
    let reverse = false;

    if (fs.existsSync(filePath)) {
      return {
        path: filePath,
        reverse: reverse
      };
    } else {
      filePath = generateRawCSVFilePathForPair(this.workerName, `${toSymbol}-${fromSymbol}`);
      reverse = true;
      if (fs.existsSync(filePath)) {
        return {
          path: filePath,
          reverse: reverse
        };
      } else {
        return null;
      }
    }
  }
}
