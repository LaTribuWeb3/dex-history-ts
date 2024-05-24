import BigNumber from 'bignumber.js';
import * as ethers from 'ethers';
import * as fs from 'fs';
import { UniswapV3Pair, UniswapV3Pair__factory } from '../../../contracts/types';
import { Uniswapv3Library } from '../../../library/Uniswapv3Library';
import { BlockWithTick, SlippageMap } from '../../../models/datainterface/BlockData';
import retry, { getConfTokenBySymbol } from '../../../utils/Utils';
import * as Web3Utils from '../../../utils/Web3Utils';
import { getBlocknumberForTimestamp } from '../../../utils/Web3Utils';
import { BaseFetcher } from '../BaseFetcher';
import { readLastLine } from '../../configuration/Helper';
import {
  UniSwapV3WorkerConfiguration,
  Univ3PairWithFeesAndPool,
  generateCSVFolderPath,
  generatePreComputedForWorker,
  generateUnifiedCSVFilePath,
  getUniswapV3BaseFolder,
  getUniswapV3FetcherResultPath,
  getUniswapV3PairDataPath,
  getUniswapV3PairLatestDataPath
} from '../../configuration/WorkerConfiguration';
import { UniswapV3Constants } from './UniswapV3Constants';
import { getAllPoolsToFetch, parseEvent, translateTopicFilters } from './UniswapV3Utils';

export class UniswapV3Fetcher extends BaseFetcher<UniSwapV3WorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('uniswapv3', 'UniswapV3 Fetcher', runEveryMinutes);
  }
  async runSpecific(): Promise<void> {
    this.createDataDirForWorker();

    const poolsData = [];
    const currentBlock = await Web3Utils.getCurrentBlock();

    // this is used to only keep 380 days of data, but still need to fetch trade data since the pool initialize block
    // computing the data is CPU heavy so this avoid computing too old data that we don't use
    // fetching events is not
    const minStartDate = Math.round(Date.now() / 1000) - 380 * 24 * 60 * 60; // min start block is 380 days ago
    const minStartBlock: number = await Web3Utils.getBlocknumberForTimestamp(minStartDate);
    console.log(`minStartBlock is ${minStartBlock}`);

    console.log(`${this.workerName}: getting pools to fetch`);

    const poolsToFetch: Univ3PairWithFeesAndPool[] = await getAllPoolsToFetch(
      this.workerName,
      this.getConfiguration(),
      this.tokens
    );

    console.log(
      `${this.workerName}: found ${poolsToFetch.length} pools to fetch from ${
        this.getConfiguration().pairs.length
      } pairs in config`
    );

    for (const fetchConfig of poolsToFetch) {
      const pairAddress = await this.FetchUniswapV3HistoryForPair(fetchConfig, currentBlock, minStartBlock);
      if (pairAddress) {
        poolsData.push({
          tokens: [fetchConfig.pairToFetch.token0, fetchConfig.pairToFetch.token1],
          address: pairAddress,
          label: `${fetchConfig.pairToFetch.token0}-${fetchConfig.pairToFetch.token1}-${fetchConfig.fee}`
        });
      }
    }

    const fetcherResult = {
      dataSourceName: 'uniswapv3',
      lastBlockFetched: currentBlock,
      lastRunTimestampMs: Date.now(),
      poolsFetched: poolsData
    };

    fs.writeFileSync(getUniswapV3FetcherResultPath(), JSON.stringify(fetcherResult, null, 2));

    // at the end, call the concatener script
    await this.generateUnifiedFileUniv3(currentBlock);
  }

  async generateUnifiedFileUniv3(endBlock: number) {
    const available = this.getAvailableUniswapV3();

    if (!fs.existsSync(generatePreComputedForWorker('uniswapv3'))) {
      fs.mkdirSync(generatePreComputedForWorker('uniswapv3'), { recursive: true });
    }

    const blockLastYear: number = await getBlocknumberForTimestamp(Math.round(Date.now() / 1000) - 365 * 24 * 60 * 60);
    for (const base of Object.keys(available)) {
      for (const quote of available[base]) {
        await this.createUnifiedFileForPair(endBlock, base, quote, blockLastYear);
      }
    }

    this.truncateUnifiedFiles('uniswapv3', blockLastYear);
  }

  truncateUnifiedFiles(platform: string, oldestBlockToKeep: number) {
    const dirPath = generatePreComputedForWorker(platform);
    const allUnifiedFilesForDirectory = fs
      .readdirSync(dirPath)
      .filter((_) => _.endsWith('unified-data.csv'))
      .map((file) => dirPath + '/' + file);

    for (const unifiedFileToProcess of allUnifiedFilesForDirectory) {
      console.log(`truncateUnifiedFiles: working on ${unifiedFileToProcess}`);
      const linesToKeep = [];
      linesToKeep.push('blocknumber,price,slippagemap\n');
      const linesToProcess = fs.readFileSync(unifiedFileToProcess, 'utf-8').split('\n');
      let deletedLines = 0;
      for (let i = 1; i < linesToProcess.length - 1; i++) {
        const lineToProcess = linesToProcess[i];
        if (lineToProcess) {
          const blockNumber = Number(lineToProcess.split(',')[0]);
          if (blockNumber > oldestBlockToKeep) {
            linesToKeep.push(lineToProcess + '\n');
          } else {
            deletedLines++;
          }
        }
      }

      if (deletedLines == 0) {
        console.log(`truncateUnifiedFiles: no data to be truncated from ${unifiedFileToProcess}`);
        continue;
      }

      const stagingFilepath = unifiedFileToProcess + '-staging';
      fs.writeFileSync(stagingFilepath, linesToKeep.join(''));
      console.log(
        `truncateUnifiedFiles: ${unifiedFileToProcess} will be truncated from ${linesToProcess.length} to ${linesToKeep.length} lines`
      );
      fs.rmSync(unifiedFileToProcess);
      retry(() => fs.renameSync(stagingFilepath, unifiedFileToProcess), []);
    }
  }

  async createUnifiedFileForPair(endBlock: number, fromSymbol: string, toSymbol: string, blockLastYear: number) {
    console.log(`${this.workerName}: create/append for ${fromSymbol} ${toSymbol}`);
    const unifiedFullFilename = generateUnifiedCSVFilePath(this.workerName, `${fromSymbol}-${toSymbol}`);
    let sinceBlock = 0;
    if (!fs.existsSync(unifiedFullFilename)) {
      fs.writeFileSync(unifiedFullFilename, 'blocknumber,price,slippagemap\n');
    } else {
      const lastLine = await readLastLine(unifiedFullFilename);
      sinceBlock = Number(lastLine.split(',')[0]) + 1;
      if (isNaN(sinceBlock)) {
        sinceBlock = blockLastYear;
      }
    }

    const allData = this.getUniV3DataforBlockInterval(fromSymbol, toSymbol, sinceBlock, endBlock);
    const toWrite = [];
    for (const [blockNumber, data] of Object.entries(allData)) {
      if (Number(blockNumber) < sinceBlock) {
        continue;
      }
      if (Number(blockNumber) > endBlock) {
        break;
      }

      toWrite.push(`${blockNumber},${data.price},${JSON.stringify(data.slippageMap)}\n`);
    }

    if (toWrite.length == 0) {
      console.log(`${this.workerName}: nothing to add to file`);
    } else {
      fs.appendFileSync(unifiedFullFilename, toWrite.join(''));
    }
  }

  /**
   *
   * @param {string} dataDir
   * @param {string} fromSymbol
   * @param {string} toSymbol
   * @param {number[]} blockRange
   * @returns {{[targetBlock: number]: {blockNumber: number, price: number, slippageMap: {[slippagePct: number]: number}}}}
   */
  getUniV3DataforBlockInterval(fromSymbol: string, toSymbol: string, sinceBlock: number, toBlock: number) {
    console.log(`${this.workerName}: Searching for ${fromSymbol}/${toSymbol} since ${sinceBlock} to ${toBlock}`);

    const results: {
      [block: number]: {
        blockNumber: number;
        price: number;
        slippageMap: SlippageMap;
      };
    } = {};

    const { selectedFiles, reverse } = this.getUniV3DataFiles(fromSymbol, toSymbol);

    if (selectedFiles.length == 0) {
      console.log(`Could not find univ3 files for ${fromSymbol}/${toSymbol}`);
      return results;
    }

    const dataContents: {
      [file: string]: {
        [blockNumber: string]: any;
      };
    } = this.getUniV3DataContents(selectedFiles, sinceBlock);

    // get all blocks with data from all selected files
    const allBlocks: Set<number> = new Set();
    const keys: { [filename: string]: number[] } = {};
    for (const filename of selectedFiles) {
      keys[filename] = Object.keys(dataContents[filename]).map((_) => Number(_));
      for (const key of keys[filename]) {
        allBlocks.add(key);
      }
    }

    // sort them
    const allBlocksArray = Array.from(allBlocks).sort((a, b) => a - b);

    // console.log(`selected base file: ${baseFile}`);
    for (const targetBlock of allBlocksArray) {
      if (targetBlock < sinceBlock) {
        continue;
      }
      if (targetBlock > toBlock) {
        break;
      }

      let minBlockDistance = Number.MAX_SAFE_INTEGER;
      let selectedNearestBlockNumber = 0;
      let selectedPrice = 0;
      const blockSlippageMap = this.getDefaultSlippageMap();
      for (const filename of selectedFiles) {
        const nearestBlockNumbers = keys[filename].filter((_) => Number(_) <= targetBlock);
        if (nearestBlockNumbers.length == 0) {
          continue; // no available data in source
        }

        const nearestBlockNumberUndefined = nearestBlockNumbers.at(-1);
        if (nearestBlockNumberUndefined == undefined) throw new Error('No nearest block number found');
        const nearestBlockNumber = nearestBlockNumberUndefined;
        // console.log(`[${targetBlock}] ${filename} nearest block value is ${nearestBlockNumber}. Distance: ${targetBlock-nearestBlockNumber}`);
        const slippageMap = dataContents[filename][nearestBlockNumber][`${fromSymbol}-slippagemap`];

        // if the slippage map is empty, ignore completely
        if (Object.keys(slippageMap).length == 0) {
          continue;
        }

        const blockDistance = Math.abs(targetBlock - nearestBlockNumber);
        // this select the data from the file with the closest block
        // normally, it select the file from which the block comes from
        if (blockDistance < minBlockDistance) {
          // console.log(`min distance updated with ${blockDistance} from file ${filename}`);
          minBlockDistance = blockDistance;
          selectedPrice = reverse
            ? dataContents[filename][nearestBlockNumber].p1vs0
            : dataContents[filename][nearestBlockNumber].p0vs1;
          selectedNearestBlockNumber = nearestBlockNumber;
        }

        let slippageBps = 50;
        while (slippageBps <= UniswapV3Constants.CONSTANT_TARGET_SLIPPAGE * 100) {
          let slippageObj: { base: number; quote: number } = slippageMap[slippageBps];
          if (!slippageObj) {
            // find the closest value that is < slippageBps
            const sortedAvailableSlippageBps = Object.keys(slippageMap)
              .filter((_) => Number(_) < slippageBps)
              .sort((a, b) => Number(b) - Number(a));
            if (sortedAvailableSlippageBps.length == 0) {
              slippageObj = {
                base: 0,
                quote: 0
              };
            } else {
              slippageObj = slippageMap[sortedAvailableSlippageBps[0]];
            }
          }

          if (slippageObj.base < 0) {
            slippageObj.base = 0;
          }
          if (slippageObj.quote < 0) {
            slippageObj.quote = 0;
          }

          blockSlippageMap[slippageBps].base += slippageObj.base;
          blockSlippageMap[slippageBps].quote += slippageObj.quote;
          slippageBps += 50;
        }
      }

      if (selectedPrice > 0) {
        results[targetBlock] = {
          blockNumber: selectedNearestBlockNumber,
          price: selectedPrice,
          slippageMap: blockSlippageMap
        };
      }
    }

    return results;
  }

  /**
   * Instanciate a default slippage map: from 50 bps to 2000, containing only 0 volume
   * @returns SlippageMap
   */
  getDefaultSlippageMap(): SlippageMap {
    const slippageMap: SlippageMap = {};
    for (let i = 50; i <= 2000; i += 50) {
      slippageMap[i] = {
        base: 0,
        quote: 0
      };
    }
    return slippageMap;
  }

  getUniV3DataFiles(fromSymbol: string, toSymbol: string) {
    const allUniv3Files = fs.readdirSync(getUniswapV3BaseFolder()).filter((_) => _.endsWith('.csv'));

    const searchKey = `${fromSymbol}-${toSymbol}`;
    let reverse = false;
    let selectedFiles = allUniv3Files.filter((_) => _.startsWith(searchKey));
    if (selectedFiles.length == 0) {
      const searchKey = `${toSymbol}-${fromSymbol}`;
      reverse = true;
      selectedFiles = allUniv3Files.filter((_) => _.startsWith(searchKey));
    }

    selectedFiles = selectedFiles.map((relativePath: string) => getUniswapV3BaseFolder() + '/' + relativePath);

    return { selectedFiles, reverse };
  }

  getUniV3DataContents(selectedFiles: string[], minBlock = 0) {
    const dataContents: { [file: string]: { [blockNumber: string]: any } } = {};
    for (let i = 0; i < selectedFiles.length; i++) {
      const selectedFile = selectedFiles[i];
      dataContents[selectedFiles[i]] = {};
      const fileContent = fs
        .readFileSync(selectedFile, 'utf-8')
        .split('\n')
        // remove first line, which is headers
        .splice(1);

      // remove last line, which is empty
      fileContent.pop();

      let lastLine: string | null = fileContent[0];
      for (let j = 1; j < fileContent.length; j++) {
        const blockNumber = Number(fileContent[j].split(',')[0]);
        if (blockNumber < minBlock) {
          lastLine = fileContent[j];
          continue;
        }

        // when breaching the minblock, save the last line
        if (blockNumber > minBlock && lastLine) {
          const lastLineBlockNumber = Number(lastLine.split(',')[0]);
          const lastLineJsonStr = lastLine.replace(`${lastLineBlockNumber},`, '');
          const lastLineParsed = JSON.parse(lastLineJsonStr);
          dataContents[selectedFile][lastLineBlockNumber] = lastLineParsed;
          lastLine = null;
        }

        const jsonStr = fileContent[j].replace(`${blockNumber},`, '');
        const parsed = JSON.parse(jsonStr);
        dataContents[selectedFile][blockNumber] = parsed;
      }

      // if lastline is still instancied, it means we never breached the minBlock and that the
      // datacontent for the file is empty
      // in that case, just save the last line as the only point
      if (lastLine /* && Object.keys(dataContents[selectedFile]) == 0 */) {
        // DIFFERENCE TO CHECK
        const lastLineBlockNumber = Number(lastLine.split(',')[0]);
        const lastLineJsonStr = lastLine.replace(`${lastLineBlockNumber},`, '');
        const lastLineParsed = JSON.parse(lastLineJsonStr);
        dataContents[selectedFile][lastLineBlockNumber] = lastLineParsed;
      }
    }

    return dataContents;
  }

  getAvailableUniswapV3(): { [tokenA: string]: string[] } {
    const available: { [tokenA: string]: string[] } = {};
    const files = fs.readdirSync(generateCSVFolderPath(undefined, this.workerName)).filter((_) => _.endsWith('.csv'));
    for (const file of files) {
      const splitted = file.split('-');

      const tokenA = splitted[0];
      const tokenB = splitted[1];
      if (!available[tokenA]) {
        available[tokenA] = [];
      }
      if (!available[tokenB]) {
        available[tokenB] = [];
      }

      if (!available[tokenA].includes(tokenB)) {
        available[tokenA].push(tokenB);
      }

      if (!available[tokenB].includes(tokenA)) {
        available[tokenB].push(tokenA);
      }
    }

    return available;
  }

  async FetchUniswapV3HistoryForPair(
    pairWithFeesAndPool: Univ3PairWithFeesAndPool,
    currentBlock: number,
    minStartBlock: number
  ) {
    const pairConfig = pairWithFeesAndPool.pairToFetch;

    console.log(
      `${this.workerName}[${pairConfig.token0}-${pairConfig.token1}]: start for pair ${pairConfig.token0}-${pairConfig.token1} and fees: ${pairWithFeesAndPool.fee}`
    );

    // try to find the json file representation of the pool latest value already fetched
    const latestDataFilePath = getUniswapV3PairLatestDataPath(pairWithFeesAndPool);

    const univ3PairContract: UniswapV3Pair = UniswapV3Pair__factory.connect(
      pairWithFeesAndPool.poolAddress,
      this.web3Provider
    );

    let latestData: BlockWithTick;
    const token0 = this.tokens[pairWithFeesAndPool.pairToFetch.token0];
    const token1 = this.tokens[pairWithFeesAndPool.pairToFetch.token1];

    if (fs.existsSync(latestDataFilePath)) {
      // if the file exists, set its value to latestData
      latestData = JSON.parse(fs.readFileSync(latestDataFilePath, { encoding: 'utf-8' }));
      console.log(
        `${this.workerName}[${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}]: data file found ${latestDataFilePath}, last block fetched: ${latestData.blockNumber}`
      );
    } else {
      console.log(
        `${this.workerName}[${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}]: data file not found, starting from scratch`
      );

      // verify that the token0 in config is the token0 of the pool
      const poolToken0 = await univ3PairContract.token0();
      if (poolToken0.toLowerCase() != token0.address.toLowerCase()) {
        throw new Error(`pool token0 ${poolToken0} != config token0 ${token0.address}. config must match pool order`);
      }

      // same for token1
      const poolToken1 = await univ3PairContract.token1();
      if (poolToken1.toLowerCase() != token1.address.toLowerCase()) {
        throw new Error(`pool token0 ${poolToken1} != config token0 ${token1.address}. config must match pool order`);
      }

      console.log(
        `${this.workerName}[${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}]: pool address found: ${pairWithFeesAndPool.poolAddress} with pair ${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}`
      );
      latestData = await this.fetchInitializeData(pairWithFeesAndPool.poolAddress, univ3PairContract);
      latestData.poolAddress = pairWithFeesAndPool.poolAddress;
    }

    const dataFileName = getUniswapV3PairDataPath(pairWithFeesAndPool);
    if (!fs.existsSync(dataFileName)) {
      fs.writeFileSync(dataFileName, 'blocknumber,data\n');
    }

    const initBlockStep = 50000;
    let blockStep = initBlockStep;
    let fromBlock = latestData.blockNumber + 1;
    let toBlock = 0;
    let cptError = 0;
    while (toBlock < currentBlock) {
      toBlock = fromBlock + blockStep - 1;
      if (toBlock > currentBlock) {
        toBlock = currentBlock;
      }

      let events = undefined;

      const topics: ethers.TopicFilter = await translateTopicFilters([
        univ3PairContract.filters.Burn().getTopicFilter(),
        univ3PairContract.filters.Mint().getTopicFilter(),
        univ3PairContract.filters.Swap().getTopicFilter()
      ]);

      try {
        events = await (univ3PairContract as ethers.BaseContract).queryFilter(topics, fromBlock, toBlock);
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

      console.log(
        `FetchUniswapV3HistoryForPair[${pairConfig.token0}-${pairConfig.token1}-${
          pairWithFeesAndPool.fee
        }]: [${fromBlock} - ${toBlock}] found ${
          events.length
        } Mint/Burn/Swap events after ${cptError} errors (fetched ${toBlock - fromBlock + 1} blocks)`
      );

      if (events.length != 0) {
        this.processEvents(events, latestData, pairWithFeesAndPool, latestDataFilePath, dataFileName, minStartBlock);

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
    }

    return latestData.poolAddress;
  }

  async processEvents(
    events: (ethers.ethers.EventLog | ethers.ethers.Log)[],
    latestData: BlockWithTick,
    pairWithFeesAndPool: Univ3PairWithFeesAndPool,
    latestDataFilePath: string,
    dataFileName: string,
    minStartBlock: number
  ) {
    const token0 = this.tokens[pairWithFeesAndPool.pairToFetch.token0];
    const token1 = this.tokens[pairWithFeesAndPool.pairToFetch.token1];

    const dtStart = Date.now();
    const saveData = [];
    // const priceData = [];
    // const checkpointData = [];
    let lastBlock = events[0].blockNumber;
    for (const event of events) {
      const parsedEvent: ethers.ethers.LogDescription = parseEvent(event);

      // this checks that we are crossing a new block, so we will save the price and maybe checkpoint data
      if (
        lastBlock != event.blockNumber &&
        lastBlock >= latestData.lastDataSave + UniswapV3Constants.CONSTANT_BLOCK_INTERVAL &&
        event.blockNumber >= minStartBlock
      ) {
        const newSaveData = Uniswapv3Library.getSaveDataFromLatestData(
          token0,
          token1,
          latestData,
          pairWithFeesAndPool.pairToFetch.token0,
          pairWithFeesAndPool.pairToFetch.token1
        );
        saveData.push(newSaveData);
      }

      switch (parsedEvent.name.toLowerCase()) {
        case 'mint':
          if (parsedEvent.args.amount > 0) {
            const lqtyToAdd = new BigNumber(parsedEvent.args.amount.toString());
            Uniswapv3Library.updateLatestDataLiquidity(
              latestData,
              event.blockNumber,
              Number(parsedEvent.args.tickLower),
              Number(parsedEvent.args.tickUpper),
              lqtyToAdd
            );
          }
          break;
        case 'burn':
          if (parsedEvent.args.amount > 0) {
            const lqtyToSub = new BigNumber(-1).times(new BigNumber(parsedEvent.args.amount.toString()));
            Uniswapv3Library.updateLatestDataLiquidity(
              latestData,
              event.blockNumber,
              parsedEvent.args.tickLower,
              parsedEvent.args.tickUpper,
              lqtyToSub
            );
          }
          break;
        case 'swap':
          latestData.currentSqrtPriceX96 = parsedEvent.args.sqrtPriceX96.toString();
          latestData.currentTick = Number(parsedEvent.args.tick);
          latestData.blockNumber = event.blockNumber;
          break;
      }

      lastBlock = event.blockNumber;
    }

    if (
      latestData.blockNumber != latestData.lastDataSave &&
      latestData.blockNumber >= latestData.lastDataSave + UniswapV3Constants.CONSTANT_BLOCK_INTERVAL &&
      latestData.blockNumber >= minStartBlock
    ) {
      const newSaveData = Uniswapv3Library.getSaveDataFromLatestData(
        token0,
        token1,
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

  /**
   * get caller function name
   * @returns caller name
   */
  fnName() {
    return this.fnName.caller.name;
  }

  async fetchInitializeData(poolAddress: string, univ3PairContract: UniswapV3Pair): Promise<BlockWithTick> {
    // if the file does not exists, it means we start from the beginning
    // fetch the deployed block number for the pool
    const deployedBlock = await Web3Utils.GetContractCreationBlockNumber(poolAddress, this.workerName);
    let fromBlock = deployedBlock;
    let toBlock = deployedBlock + 100000;

    console.log(`${this.workerName}: searching Initialize event between blocks [${fromBlock} - ${toBlock}]`);

    const initEvents = await retry(
      () => univ3PairContract.queryFilter(univ3PairContract.filters.Initialize, fromBlock, toBlock),
      []
    );

    if (initEvents.length > 0) {
      if (initEvents.length > 1) {
        throw new Error('More than 1 Initialize event found???');
      }

      console.log(`${this.workerName}: found Initialize event at block ${initEvents[0].blockNumber}`);

      const tickSpacing = await retry(() => univ3PairContract.tickSpacing(), []);

      return {
        currentTick: Number(initEvents[0].args.tick),
        currentSqrtPriceX96: initEvents[0].args.sqrtPriceX96.toString(10),
        blockNumber: initEvents[0].blockNumber - 1, // set to blocknumber -1 to be sure to fetch mint/burn events on same block as initialize,
        tickSpacing: Number(tickSpacing),
        lastCheckpoint: 0, // set to 0 to save liquidity check point at the begining
        lastDataSave: 0, // set to 0 to save data at the beginning
        ticks: {},
        poolAddress: poolAddress
      };

      // fs.appendFileSync('logs.txt', `Initialized at ${initEvents[0].blockNumber}. base tick ${latestData.currentTick}. base price: ${latestData.currentSqrtPriceX96}\n`);
    } else {
      console.log(`${this.workerName}: Initialize event not found between blocks [${fromBlock} - ${toBlock}]`);
      fromBlock = toBlock + 1;
      toBlock = fromBlock + 100000;
    }

    throw new Error('No Initialize event found');
  }
}

// async function debug() {
//   const fetcher = new UniswapV3Fetcher(0);
//   await fetcher.runSpecific();
// }

// debug();
