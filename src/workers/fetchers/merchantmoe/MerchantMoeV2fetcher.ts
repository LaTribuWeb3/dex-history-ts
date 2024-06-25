import {
  MerchantMoeV2PairWithFeesAndPool,
  MerchantMoeV2WorkerConfiguration,
  generateCSVFolderPath,
  generatePreComputedForWorker,
  generateUnifiedCSVFilePath,
  getMerchantMoeV2BaseFolder,
  getMerchantMoeV2PairDataPath,
  getMerchantMoeV2PairLatestDataPath,
  getMerchantMoeV2ResultPath
} from '../../configuration/WorkerConfiguration';
import { BaseFetcher } from '../BaseFetcher';
import * as Web3Utils from '../../../utils/Web3Utils';
import { MerchantMoeV2Constants } from './MerchantMoeV2Constants';
import * as ethers from 'ethers';
import * as fs from 'fs';
import { MerchantMoeFactory__factory, MerchantMoeLBPair__factory } from '../../../contracts/types';
import { translateTopicFilters } from '../uniswapv3/UniswapV3Utils';
import { MerchantMoeV2PoolData, SlippageMap } from '../../../models/datainterface/BlockData';
import retry, { sleep } from '../../../utils/Utils';
import { MerchantMoeV2Library } from '../../../library/MerchantMoeV2Library';
import { getAllPoolsToFetch } from './MerchantMoeV2Utils';
import { readLastLine } from '../../configuration/Helper';

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

    const poolsToFetch: MerchantMoeV2PairWithFeesAndPool[] = await getAllPoolsToFetch(
      this.workerName,
      this.getConfiguration(),
      this.tokens
    );

    console.log(
      `[${this.monitoringName}] | Found ${poolsToFetch.length} pools to fetch from ${
        this.getConfiguration().pairs.length
      } pairs in config`
    );

    const promises: { tokens: string[]; addressPromise: Promise<string>; label: string }[] = [];
    for (const fetchConfig of poolsToFetch) {
      const promise = this.FetchMerchantMoeV2HistoryForPair(fetchConfig, currentBlock, minStartBlock);
      // await promise;
      promises.push({
        tokens: [fetchConfig.pairToFetch.token0, fetchConfig.pairToFetch.token1],
        addressPromise: promise,
        label: `${fetchConfig.pairToFetch.token0}-${fetchConfig.pairToFetch.token1}-${fetchConfig.binStep}`
      });

      await sleep(1000);
    }

    await Promise.all(promises.map((_) => _.addressPromise));

    for (const p of promises) {
      const pairAddress = await p.addressPromise;
      if (pairAddress) {
        poolsData.push({
          tokens: p.tokens,
          address: pairAddress,
          label: p.label
        });
      }
    }

    const fetcherResult = {
      dataSourceName: 'merchantmoev2',
      lastBlockFetched: currentBlock,
      lastRunTimestampMs: Date.now(),
      poolsFetched: poolsData
    };

    fs.writeFileSync(getMerchantMoeV2ResultPath(this.workerName), JSON.stringify(fetcherResult, null, 2));

    // at the end, call the concatener script
    await this.generateUnifiedFileMerchantMoeV2(currentBlock);
  }

  async generateUnifiedFileMerchantMoeV2(endBlock: number) {
    const available = this.getAvailableMerchantMoeV2();

    if (!fs.existsSync(generatePreComputedForWorker(this.workerName))) {
      fs.mkdirSync(generatePreComputedForWorker(this.workerName), { recursive: true });
    }

    const blockLastYear: number = await Web3Utils.getBlocknumberForTimestamp(
      Math.round(Date.now() / 1000) - 365 * 24 * 60 * 60
    );
    for (const base of Object.keys(available)) {
      for (const quote of available[base]) {
        await this.createUnifiedFileForPair(endBlock, base, quote, blockLastYear);
      }
    }

    this.truncateUnifiedFiles(this.workerName, blockLastYear);
  }

  truncateUnifiedFiles(platform: string, oldestBlockToKeep: number) {
    const dirPath = generatePreComputedForWorker(platform);
    const allUnifiedFilesForDirectory = fs
      .readdirSync(dirPath)
      .filter((_) => _.endsWith('unified-data.csv'))
      .map((file) => dirPath + '/' + file);

    for (const unifiedFileToProcess of allUnifiedFilesForDirectory) {
      console.log(`[${this.monitoringName}] | TruncateUnifiedFiles: working on ${unifiedFileToProcess}`);
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
        console.log(
          `[${this.monitoringName}] | TruncateUnifiedFiles: no data to be truncated from ${unifiedFileToProcess}`
        );
        continue;
      }

      const stagingFilepath = unifiedFileToProcess + '-staging';
      fs.writeFileSync(stagingFilepath, linesToKeep.join(''));
      console.log(
        `[${this.monitoringName}] | TruncateUnifiedFiles: ${unifiedFileToProcess} will be truncated from ${linesToProcess.length} to ${linesToKeep.length} lines`
      );
      fs.rmSync(unifiedFileToProcess);
      retry(() => fs.renameSync(stagingFilepath, unifiedFileToProcess), []);
    }
  }

  async createUnifiedFileForPair(endBlock: number, fromSymbol: string, toSymbol: string, blockLastYear: number) {
    console.log(`[${this.monitoringName}] | Create/append for ${fromSymbol} ${toSymbol}`);
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

    const allData = this.getMerchantMoeV2DataforBlockInterval(fromSymbol, toSymbol, sinceBlock, endBlock);
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
      console.log(`[${this.monitoringName}] | Nothing to add to file`);
    } else {
      fs.appendFileSync(unifiedFullFilename, toWrite.join(''));
    }
  }

  getMerchantMoeV2DataforBlockInterval(fromSymbol: string, toSymbol: string, sinceBlock: number, toBlock: number) {
    console.log(`[${this.monitoringName}] | Searching for ${fromSymbol}/${toSymbol} since ${sinceBlock} to ${toBlock}`);

    const results: {
      [block: number]: {
        blockNumber: number;
        price: number;
        slippageMap: SlippageMap;
      };
    } = {};

    const { selectedFiles, reverse } = this.getMerchantMoeV2DataFiles(fromSymbol, toSymbol);

    if (selectedFiles.length == 0) {
      console.log(`[${this.monitoringName}] | Could not find MerchantMoeV2 files for ${fromSymbol}/${toSymbol}`);
      return results;
    }

    const dataContents: {
      [file: string]: {
        [blockNumber: string]: any;
      };
    } = this.getMerchantMoeV2DataContents(selectedFiles, sinceBlock);

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
        while (slippageBps <= MerchantMoeV2Constants.CONSTANT_TARGET_SLIPPAGE * 100) {
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

  getMerchantMoeV2DataFiles(fromSymbol: string, toSymbol: string) {
    const allMerchantMoeV2Files = fs
      .readdirSync(getMerchantMoeV2BaseFolder(this.workerName))
      .filter((_) => _.endsWith('.csv'));

    const searchKey = `${fromSymbol}-${toSymbol}`;
    let reverse = false;
    let selectedFiles = allMerchantMoeV2Files.filter((_) => _.startsWith(searchKey));
    if (selectedFiles.length == 0) {
      const searchKey = `${toSymbol}-${fromSymbol}`;
      reverse = true;
      selectedFiles = allMerchantMoeV2Files.filter((_) => _.startsWith(searchKey));
    }

    selectedFiles = selectedFiles.map(
      (relativePath: string) => getMerchantMoeV2BaseFolder(this.workerName) + '/' + relativePath
    );

    return { selectedFiles, reverse };
  }

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

  getMerchantMoeV2DataContents(selectedFiles: string[], minBlock = 0) {
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

  getAvailableMerchantMoeV2(): { [tokenA: string]: string[] } {
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

  async FetchMerchantMoeV2HistoryForPair(
    pairWithFeesAndPool: MerchantMoeV2PairWithFeesAndPool,
    currentBlock: number,
    minStartBlock: number
  ) {
    const pairConfig = pairWithFeesAndPool.pairToFetch;

    const logLabel = `[${this.monitoringName}] | [${pairConfig.token0}-${pairConfig.token1}-${pairWithFeesAndPool.binStep}] |`;
    console.log(
      `${logLabel} Start for pair ${pairConfig.token0}-${pairConfig.token1} and fees: ${pairWithFeesAndPool.binStep}`
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

    const dataFileName = getMerchantMoeV2PairDataPath(pairWithFeesAndPool, this.workerName);
    if (!fs.existsSync(dataFileName)) {
      fs.writeFileSync(dataFileName, 'blocknumber,data\n');
    }

    const initBlockStep = this.getConfiguration().fixedBlockStep || 50_000;
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

    // in the end, always save latest data
    latestData.blockNumber = currentBlock;
    fs.writeFileSync(latestDataFilePath, JSON.stringify(latestData));

    return latestData.poolAddress;
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

// async function debug() {
//   const fetcher = new MerchantMoeV2Fetcher(60, 'mantle');
//   await fetcher.run();
// }

// debug();
