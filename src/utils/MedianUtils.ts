import { getMedianPricesFilenamesForPlatform } from '../workers/configuration/WorkerConfiguration';
import * as fs from 'fs';

export class MedianUtils {
  static readMedianPricesFile(
    platform: string,
    fromSymbol: string,
    toSymbol: string,
    fromBlock: number | undefined = undefined,
    toBlock: number | undefined = undefined
  ): {
    block: number;
    price: number;
  }[] {
    const medianFileName = getMedianPricesFilenamesForPlatform(platform, fromSymbol, toSymbol).basequote;
    if (!fs.existsSync(medianFileName)) {
      console.warn(`readMedianPricesFile: file ${medianFileName} does not exists`);
      return [];
    }

    const allData = fs.readFileSync(medianFileName, 'utf-8').split('\n');

    const medianedPrices = [];
    for (let i = 1; i < allData.length - 1; i++) {
      const lineSplitted = allData[i].split(',');
      const block = Number(lineSplitted[0]);

      if (fromBlock && block < fromBlock) {
        continue;
      }

      if (toBlock && block > toBlock) {
        break;
      }

      const obj = {
        block,
        price: Number(lineSplitted[1])
      };

      medianedPrices.push(obj);
    }

    return medianedPrices;
  }

  static getClosestPrice(prices: { block: number; price: number }[], blocknumber: number) {
    // Filter out blocks with blocknumber greater than the input
    const eligiblePrices = prices.filter((item) => item.block <= blocknumber);

    // If no eligible prices, return null or a default value
    if (!eligiblePrices.length) {
      return undefined;
    }

    // Sort the eligible prices by the closest blocknumber
    eligiblePrices.sort((a, b) => b.block - a.block);

    // Return the price of the closest blocknumber
    return eligiblePrices[0].price;
  }
}
