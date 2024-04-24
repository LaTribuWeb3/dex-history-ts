import { PLATFORMS } from '../../../../utils/Constants';
import { DataPairUtils } from '../../../../utils/DataPairUtils';
import { FileReaderUtils } from '../../../../utils/FileReaderUtils';
import { logFnDuration, logFnDurationWithLabel } from '../../../../utils/MonitoringHelper';
import { generatePriceCSVFilePath } from '../../../configuration/WorkerConfiguration';
import { MEDIAN_OVER_BLOCK } from '../DataInterfaceConstants';
import { DataMedianer } from './DataMedianer';

export class PriceGetter {
  static getMedianPricesAllPlatforms(
    workerName: string,
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
        workerName,
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
    const medianed = DataMedianer.medianPricesOverBlocks(
      allPrices,
      fileAlreadyExists ? lastBlock + MEDIAN_OVER_BLOCK : undefined
    );
    return medianed;
  }

  static getPricesAtBlockForIntervalViaPivots(
    workerName: string,
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
      return this.getPricesAtBlockForInterval(workerName, platform, fromSymbol, toSymbol, fromBlock, toBlock);
    } else if (pivotSymbols.length == 1) {
      return this.getPricesAtBlockForIntervalViaPivot(
        workerName,
        platform,
        fromSymbol,
        toSymbol,
        fromBlock,
        toBlock,
        pivotSymbols[0]
      );
    }

    const label = `${workerName}[${fromSymbol}->${pivotSymbols.join(
      '->'
    )}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`;
    console.log(label);
    const dataSegment1 = this.getPricesAtBlockForIntervalViaPivots(
      workerName,
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

    const dataSegment2 = this.getPricesAtBlockForInterval(
      workerName,
      platform,
      pivotSymbols.at(-1),
      toSymbol,
      fromBlock,
      toBlock
    );

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
      const pricesAtBlock = DataMedianer.ComputePriceViaPivot(dataSegment1, dataSegment2);
      logFnDurationWithLabel(
        workerName,
        start,
        `[${fromSymbol}->${pivotSymbols.join('->')}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    } else {
      const pricesAtBlock = DataMedianer.ComputePriceViaPivot(dataSegment2, dataSegment1);
      logFnDurationWithLabel(
        workerName,
        start,
        `[${fromSymbol}->${pivotSymbols.join('->')}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    }
  }

  static getPricesAtBlockForInterval(
    workerName: string,
    platform: string,
    fromSymbol: string | undefined,
    toSymbol: string | undefined,
    fromBlock: number,
    toBlock: number
  ): {
    block: number;
    price: number;
  }[] {
    const { actualFrom, actualTo } = DataPairUtils.GetPairToUse(fromSymbol, toSymbol);
    const start = Date.now();

    // specific case for univ3 and stETH/WETH pair
    // because it does not really exists
    if (
      platform == 'uniswapv3' &&
      ((actualFrom == 'stETH' && actualTo == 'WETH') || (actualFrom == 'WETH' && actualTo == 'stETH'))
    ) {
      const prices = DataMedianer.generateFakePriceForStETHWETHUniswapV3(Math.max(fromBlock, 10_000_000), toBlock);
      logFnDurationWithLabel(workerName, start, `[${actualFrom}->${actualTo}] [${fromBlock}-${toBlock}] [${platform}]`);
      return prices;
    } else {
      const fullFilename = generatePriceCSVFilePath(platform, `${actualFrom}-${actualTo}`);
      const prices = FileReaderUtils.readAllPricesFromFilename(fullFilename, fromBlock, toBlock);
      logFnDurationWithLabel(workerName, start, `[${actualFrom}->${actualTo}] [${fromBlock}-${toBlock}] [${platform}]`);
      return prices;
    }
  }

  static getMedianPricesForPlatform(
    workerName: string,
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

    const prices = PriceGetter.getPricesAtBlockForIntervalViaPivots(
      workerName,
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
      console.log(`${workerName}[${platform}]: no new data to save for ${base}/${quote} via pivot: ${pivots}`);
      return [];
    }

    const start = Date.now();

    const medianed = DataMedianer.medianPricesOverBlocks(
      prices,
      fileAlreadyExists ? lastBlock + MEDIAN_OVER_BLOCK : undefined
    );

    logFnDuration(workerName, start, medianed.length);

    return medianed;
  }

  static getPricesAtBlockForIntervalViaPivot(
    workerName: string,
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
      return PriceGetter.getPricesAtBlockForInterval(workerName, platform, fromSymbol, toSymbol, fromBlock, toBlock);
    }

    const label = `${workerName}[${fromSymbol}->${pivotSymbol}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`;

    const dataSegment1 = PriceGetter.getPricesAtBlockForInterval(
      workerName,
      platform,
      fromSymbol,
      pivotSymbol,
      fromBlock,
      toBlock
    );

    if (!dataSegment1 || dataSegment1.length == 0) {
      console.log(`${label}: Cannot find data for ${fromSymbol}/${pivotSymbol}, returning 0`);
      return [];
    }

    const dataSegment2 = PriceGetter.getPricesAtBlockForInterval(
      workerName,
      platform,
      pivotSymbol,
      toSymbol,
      fromBlock,
      toBlock
    );

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
      const pricesAtBlock = DataMedianer.ComputePriceViaPivot(dataSegment1, dataSegment2);
      logFnDurationWithLabel(
        workerName,
        start,
        `[${fromSymbol}->${pivotSymbol}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    } else {
      const pricesAtBlock = DataMedianer.ComputePriceViaPivot(dataSegment2, dataSegment1);
      logFnDurationWithLabel(
        workerName,
        start,
        `[${fromSymbol}->${pivotSymbol}->${toSymbol}] [${fromBlock}-${toBlock}] [${platform}]`
      );
      return pricesAtBlock;
    }
  }
}
