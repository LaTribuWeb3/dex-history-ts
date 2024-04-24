import { BaseWorker } from '../BaseWorker';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
import precomputers from '../../config/precomputers.json';
import { readDataFromFile, sleep } from '../../utils/Utils';
import {
  checkIfFileExists,
  generatePriceCSVFilePath,
  getMedianPricesFilenamesForPlatform
} from '../configuration/WorkerConfiguration';
import { readLastLine } from '../configuration/Helper';
import * as fs from 'fs';
import { PLATFORMS } from '../../utils/Constants';
import { median } from 'simple-statistics';
import { logFnDuration } from '../../utils/MonitoringHelper';
import { logFnDurationWithLabel } from './data/DataInterfaceHelper';
import { MEDIAN_OVER_BLOCK } from './data/DataInterfaceConstants';
import * as Web3Utils from '../../utils/Web3Utils';

export class MedianPrecomputer extends BaseWorker<WorkerConfiguration.PrecomputerConfiguration> {
  // Assuming workers is an array of worker configurations
  protected static findPrecomputerConfigurationByName<T extends WorkerConfiguration.PrecomputerConfiguration>(
    name: string
  ): T {
    const foundWorker = precomputers.precomputers.find((worker) => worker.name === name);
    if (foundWorker === undefined) {
      throw new Error('Could not find worker with name: ' + name);
    }
    return foundWorker.configuration as unknown as T;
  }

  constructor(runEveryMinute: number) {
    super(
      MedianPrecomputer.findPrecomputerConfigurationByName('median'),
      'median',
      'Median Precomputer',
      runEveryMinute
    );
  }

  async runSpecific() {
    for (const platform of this.configuration.platforms) {
      const currentBlock = await Web3Utils.getCurrentBlock();

      for (const { base, quotes: quotesConfig } of this.configuration.watchedPairs) {
        for (const quoteConfig of quotesConfig) {
          let pivots: string[] = [];

          if (
            quoteConfig.pivotsSpecific &&
            quoteConfig.pivotsSpecific.filter((_) => _.platform == platform).length !== 0
          ) {
            pivots = quoteConfig.pivotsSpecific.filter((_) => _.platform == platform)[0].pivots;
          } else if (quoteConfig.pivots !== undefined) {
            pivots = quoteConfig.pivots;
          }

          await this.precomputeAndSaveMedianPrices(platform, base, quoteConfig.quote, currentBlock, pivots);
        }
      }
    }
    await sleep(100);
  }

  async precomputeAndSaveMedianPrices(
    platform: string,
    base: string,
    quote: string,
    currentBlock: number,
    pivots: string[]
  ) {
    console.log(`${this.workerName}[${platform}]: starting for ${base}/${quote} via pivot: ${pivots}`);
    const { basequote: filename, quotebase: filenameReversed } = getMedianPricesFilenamesForPlatform(
      platform,
      base,
      quote
    );

    // get the last block already medianed
    let lastBlock = 0;
    const fileAlreadyExists = checkIfFileExists(filename); // fs.existsSync(filename);
    if (fileAlreadyExists) {
      const lastline = await readLastLine(filename);
      lastBlock = Number(lastline.split(',')[0]);
      if (isNaN(lastBlock)) {
        lastBlock = 0;
      }
    }

    const medianed =
      platform == 'all'
        ? this.getMedianPricesAllPlatforms(base, quote, lastBlock, currentBlock, pivots, fileAlreadyExists)
        : this.getMedianPricesForPlatform(platform, base, quote, lastBlock, currentBlock, pivots, fileAlreadyExists);

    if (medianed.length == 0) {
      console.log(`${this.workerName}[${platform}]: no new data to save for ${base}/${quote} via pivot: ${pivots}`);
      return;
    }

    const toWrite = [];
    const toWriteReversed = [];

    if (!checkIfFileExists(filename)) {
      fs.writeFileSync(filename, 'blocknumber,price\n');
      fs.writeFileSync(filenameReversed, 'blocknumber,price\n');
    }

    for (const medianedData of medianed) {
      toWrite.push(`${medianedData.block},${medianedData.price}\n`);
      toWriteReversed.push(`${medianedData.block},${1 / medianedData.price}\n`);
    }

    fs.appendFileSync(filename, toWrite.join(''));
    fs.appendFileSync(filenameReversed, toWriteReversed.join(''));
  }

  getMedianPricesAllPlatforms(
    base: string,
    quote: string,
    lastBlock: number,
    currentBlock: number,
    pivots: string[],
    fileAlreadyExists: boolean
  ) {
    let allPrices: {
      block: number;
      price: number;
    }[] = [];
    for (const subPlatform of PLATFORMS) {
      if (
        subPlatform == 'uniswapv3' &&
        ((base == 'stETH' && quote == 'WETH') || (base == 'WETH' && quote == 'stETH'))
      ) {
        // stETH/WETH pair for univ3 is fake data
        // so ignore it
        continue;
      }
      const prices = this.getPricesAtBlockForIntervalViaPivots(
        subPlatform,
        base,
        quote,
        lastBlock + 1,
        currentBlock,
        pivots
      );
      if (!prices || prices.length == 0) {
        console.log(`Cannot find prices for ${base}->${quote}(pivot: ${pivots}) for platform: ${subPlatform}`);
        continue;
      }

      console.log(`Adding ${prices.length} from ${subPlatform}`);
      allPrices = allPrices.concat(prices);
    }

    if (allPrices.length == 0) {
      return [];
    }

    // here we have all the prices data from all platforms, sorting them before calling the median
    console.log(`sorting ${allPrices.length} prices`);
    allPrices.sort((a, b) => a.block - b.block);
    console.log(`${allPrices.length} prices sorted by blocks, starting median process`);
    const medianed = this.medianPricesOverBlocks(
      allPrices,
      fileAlreadyExists ? lastBlock + MEDIAN_OVER_BLOCK : undefined
    );
    return medianed;
  }

  getPricesAtBlockForIntervalViaPivots(
    platform: string,
    fromSymbol: string,
    toSymbol: string | undefined,
    fromBlock: number,
    toBlock: number,
    pivotSymbols: string[]
  ): {
    block: number;
    price: number;
  }[] {
    const start = Date.now();
    if (!pivotSymbols || pivotSymbols.length == 0) {
      return this.getPricesAtBlockForInterval(platform, fromSymbol, toSymbol, fromBlock, toBlock);
    } else if (pivotSymbols.length == 1) {
      return this.getPricesAtBlockForIntervalViaPivot(
        platform,
        fromSymbol,
        toSymbol,
        fromBlock,
        toBlock,
        pivotSymbols[0]
      );
    }

    const label = `${this.workerName}[${fromSymbol}->${pivotSymbols.join(
      '->'
    )}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`;
    console.log(label);
    const dataSegment1 = this.getPricesAtBlockForIntervalViaPivots(
      platform,
      fromSymbol,
      pivotSymbols.slice(1).at(-1),
      fromBlock,
      toBlock,
      pivotSymbols.slice(0, pivotSymbols.length - 1)
    );

    if (!dataSegment1 || dataSegment1.length == 0) {
      console.log(`${label}: Cannot find data for ${fromSymbol}/${pivotSymbols.join('->')}, returning 0`);
      return [];
    }

    const dataSegment2 = this.getPricesAtBlockForInterval(platform, pivotSymbols.at(-1), toSymbol, fromBlock, toBlock);

    if (!dataSegment2 || dataSegment2.length == 0) {
      console.log(`${label}: Cannot find data for ${pivotSymbols.at(-1)}/${toSymbol}, returning 0`);
      return [];
    }

    // check whether to compute the price with base data from segment1 or 2
    // based on the number of prices in each segments
    // example if the segment1 has 1000 prices and segment2 has 500 prices
    // we will use segment1 as the base for the blocknumbers in the returned object
    if (dataSegment1.length > dataSegment2.length) {
      // compute all the prices with blocks from segment1
      const pricesAtBlock = this.ComputePriceViaPivot(dataSegment1, dataSegment2);
      logFnDurationWithLabel(
        this.workerName,
        start,
        `[${fromSymbol}->${pivotSymbols.join('->')}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    } else {
      const pricesAtBlock = this.ComputePriceViaPivot(dataSegment2, dataSegment1);
      logFnDurationWithLabel(
        this.workerName,
        start,
        `[${fromSymbol}->${pivotSymbols.join('->')}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    }
  }

  getPricesAtBlockForIntervalViaPivot(
    platform: string,
    fromSymbol: string,
    toSymbol: string | undefined,
    fromBlock: number,
    toBlock: number,
    pivotSymbol: string
  ): {
    block: number;
    price: number;
  }[] {
    const start = Date.now();
    if (!pivotSymbol) {
      return this.getPricesAtBlockForInterval(platform, fromSymbol, toSymbol, fromBlock, toBlock);
    }

    const label = `${this.workerName}[${fromSymbol}->${pivotSymbol}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`;

    const dataSegment1 = this.getPricesAtBlockForInterval(platform, fromSymbol, pivotSymbol, fromBlock, toBlock);

    if (!dataSegment1 || dataSegment1.length == 0) {
      console.log(`${label}: Cannot find data for ${fromSymbol}/${pivotSymbol}, returning 0`);
      return [];
    }

    const dataSegment2 = this.getPricesAtBlockForInterval(platform, pivotSymbol, toSymbol, fromBlock, toBlock);

    if (!dataSegment2 || dataSegment2.length == 0) {
      console.log(`${label}: Cannot find data for ${pivotSymbol}/${toSymbol}, returning 0`);
      return [];
    }

    // check whether to compute the price with base data from segment1 or 2
    // based on the number of prices in each segments
    // example if the segment1 has 1000 prices and segment2 has 500 prices
    // we will use segment1 as the base for the blocknumbers in the returned object
    if (dataSegment1.length > dataSegment2.length) {
      // compute all the prices with blocks from segment1
      const pricesAtBlock = this.ComputePriceViaPivot(dataSegment1, dataSegment2);
      logFnDurationWithLabel(
        this.workerName,
        start,
        `[${fromSymbol}->${pivotSymbol}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    } else {
      const pricesAtBlock = this.ComputePriceViaPivot(dataSegment2, dataSegment1);
      logFnDurationWithLabel(
        this.workerName,
        start,
        `[${fromSymbol}->${pivotSymbol}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    }
  }

  ComputePriceViaPivot(
    dataSegment1: {
      block: number;
      price: number;
    }[],
    dataSegment2: {
      block: number;
      price: number;
    }[]
  ) {
    const priceAtBlock = [];
    const keysSegment2 = dataSegment2.map((_) => _.block);
    let currentBlockOtherSegmentIndex = 0;

    for (const priceAtBlockData of dataSegment1) {
      // for(const [blockNumber, priceSegment1] of Object.entries(dataSegment1)) {
      const blockNumber = priceAtBlockData.block;
      const priceSegment1 = priceAtBlockData.price;
      const nearestBlockDataBefore = this.findNearestBlockBefore(
        blockNumber,
        keysSegment2,
        currentBlockOtherSegmentIndex
      );
      if (!nearestBlockDataBefore) {
        // console.log(`ignoring block ${blockNumber}`);
        continue;
      }

      currentBlockOtherSegmentIndex = nearestBlockDataBefore.selectedIndex;

      const priceSegment2 = dataSegment2[currentBlockOtherSegmentIndex].price;
      const computedPrice = priceSegment1 * priceSegment2;
      priceAtBlock.push({
        block: blockNumber,
        price: computedPrice
      });
    }

    return priceAtBlock;
  }

  findNearestBlockBefore(targetBlock: number, blocks: number[], startIndex: number) {
    let block = blocks[startIndex];
    let selectedIndex = startIndex;
    for (let i = startIndex + 1; i < blocks.length; i++) {
      const nextBlock = blocks[i];
      if (nextBlock > targetBlock) {
        block = blocks[i - 1];
        selectedIndex = i - 1;
        break;
      }

      block = blocks[i];
      selectedIndex = i;
    }

    if (block > targetBlock) {
      return null;
    }

    return { block, selectedIndex };
  }

  getPricesAtBlockForInterval(
    platform: string,
    fromSymbol: string | undefined,
    toSymbol: string | undefined,
    fromBlock: number,
    toBlock: number
  ): {
    block: number;
    price: number;
  }[] {
    const { actualFrom, actualTo } = this.GetPairToUse(fromSymbol, toSymbol);
    const start = Date.now();

    // specific case for univ3 and stETH/WETH pair
    // because it does not really exists
    if (
      platform == 'uniswapv3' &&
      ((actualFrom == 'stETH' && actualTo == 'WETH') || (actualFrom == 'WETH' && actualTo == 'stETH'))
    ) {
      const prices = this.generateFakePriceForStETHWETHUniswapV3(Math.max(fromBlock, 10_000_000), toBlock);
      logFnDurationWithLabel(
        this.workerName,
        start,
        `[${actualFrom}->${actualTo}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return prices;
    } else {
      const fullFilename = generatePriceCSVFilePath(platform, `${actualFrom}-${actualTo}`);
      const prices = this.readAllPricesFromFilename(fullFilename, fromBlock, toBlock);
      logFnDurationWithLabel(
        this.workerName,
        start,
        `[${actualFrom}->${actualTo}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return prices;
    }
  }

  readAllPricesFromFilename(fullFilename: string, fromBlock: number, toBlock: number) {
    if (!fs.existsSync(fullFilename)) {
      console.warn('File ' + fullFilename + ' not found while reading all prices.');
      return [];
    }

    const pricesAtBlock = [];
    const fileContent = readDataFromFile(fullFilename);
    for (let i = 1; i < fileContent.length - 1; i++) {
      const lineContent = fileContent[i];
      const blockNumber = Number(lineContent.split(',')[0]);

      if (blockNumber < fromBlock) {
        continue;
      }

      if (blockNumber > toBlock) {
        break;
      }

      const splt = lineContent.split(',');
      const price = Number(splt[1]);

      pricesAtBlock.push({
        block: blockNumber,
        price: price
      });
    }

    return pricesAtBlock;
  }

  // TODO rewrite this with a map of exceptions in the configuration
  GetPairToUse(
    from: string | undefined,
    to: string | undefined
  ): { actualFrom: string | undefined; actualTo: string | undefined } {
    let actualFrom = from;
    let actualTo = to;

    if (from == 'sDAI') {
      actualFrom = 'DAI';
    }
    if (to == 'sDAI') {
      actualTo = 'DAI';
    }

    return { actualFrom, actualTo };
  }

  // TODO rewrite this with list comprehension
  generateFakePriceForStETHWETHUniswapV3(fromBlock: number, toBlock: number) {
    const pricesAtBlock = [];
    let currBlock = fromBlock;
    while (currBlock <= toBlock) {
      pricesAtBlock.push({
        block: currBlock,
        price: 1
      });

      currBlock += MEDIAN_OVER_BLOCK;
    }

    return pricesAtBlock;
  }

  getMedianPricesForPlatform(
    platform: string,
    base: string,
    quote: string,
    lastBlock: number,
    currentBlock: number,
    pivots: string[],
    fileAlreadyExists: boolean
  ) {
    // specific case for curve with USDC as the quote or base
    // add USDT as a step
    if (pivots && platform == 'curve' && pivots[0] == 'WETH' && quote == 'USDC') {
      pivots = ['WETH', 'USDT'];
    }
    if (pivots && platform == 'curve' && pivots[0] == 'WETH' && base == 'USDC') {
      pivots = ['USDT', 'WETH'];
    }

    const prices = this.getPricesAtBlockForIntervalViaPivots(
      platform,
      base,
      quote,
      lastBlock + 1,
      currentBlock,
      pivots
    );
    if (!prices) {
      console.log(`Cannot find prices for ${base}->${quote}(pivot: ${pivots}) for platform: ${platform}`);
      return [];
    }

    if (prices.length == 0) {
      console.log(`${this.workerName}[${platform}]: no new data to save for ${base}/${quote} via pivot: ${pivots}`);
      return [];
    }

    const medianed = this.medianPricesOverBlocks(prices, fileAlreadyExists ? lastBlock + MEDIAN_OVER_BLOCK : undefined);
    return medianed;
  }

  medianPricesOverBlocks(pricesAtBlock: { block: number; price: number }[], baseBlock: number | undefined) {
    const start = Date.now();

    let currBlock = baseBlock || pricesAtBlock[0].block;
    const lastPrice = pricesAtBlock.at(-1);
    if (lastPrice == undefined) {
      throw 'Block ' + baseBlock + ' is undefined.';
    }
    console.log(`starting median prices since block ${currBlock} to ${lastPrice.block}`);
    const medianPricesAtBlock = [];
    while (currBlock <= lastPrice.block) {
      const stepTargetBlock = currBlock + MEDIAN_OVER_BLOCK;
      // only median full block ranges
      if (stepTargetBlock > lastPrice.block) {
        break;
      }
      const blocksToMedian = pricesAtBlock.filter((_) => _.block >= currBlock && _.block < stepTargetBlock);
      if (blocksToMedian.length > 0) {
        const medianPrice = median(blocksToMedian.map((_) => _.price));
        if (medianPrice > 0) {
          medianPricesAtBlock.push({
            block: currBlock,
            price: medianPrice
          });
        }
      }

      currBlock = stepTargetBlock;
    }

    logFnDuration(this.workerName, start, pricesAtBlock.length);
    return medianPricesAtBlock;
  }
}
