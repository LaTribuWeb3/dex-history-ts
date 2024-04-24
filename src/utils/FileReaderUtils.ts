import * as fs from 'fs';
import { readDataFromFile } from './Utils';

export class FileReaderUtils {
  static readAllPricesFromFilename(fullFilename: string, fromBlock: number, toBlock: number) {
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
}
