import { SlippageMap } from '../models/datainterface/BlockData';
import * as fs from 'fs';

export class SlippageMapUtils {
  /**
   * Read a unified data line and transform it into an object
   * @param {string} line
   * @returns {{blockNumber: number, price: number, slippageMap: {[slippageBps: string]: number}}}
   */
  static extractDataFromUnifiedLine(line: string): {
    blockNumber: number;
    price: number;
    slippageMap: SlippageMap;
  } {
    const splt = line.split(',');
    const blockNumber = splt[0];
    const price = splt[1];
    const slippageMapJson = line.replace(`${blockNumber},${price},`, '');
    const slippageMap: SlippageMap = JSON.parse(slippageMapJson);

    return {
      blockNumber: Number(blockNumber),
      price: Number(price),
      slippageMap: slippageMap
    };
  }

  static getDataFromCSVFile(csvFile: string) {
    return fs.readFileSync(csvFile, 'utf-8').split('\n').slice(1);
  }
}
