import * as Constants from '../../utils/Constants';
import * as fs from 'fs';

export interface PairConfiguration {
  name: string;
  startBlock?: number;
}

export interface CurveFetcherWorkerConfiguration extends WorkerConfiguration {
  placeholder: string;
}

export interface UniSwapV2WorkerConfiguration extends WorkerConfiguration {
  pairs: PairConfiguration[];
}

export interface UniSwapV3WorkerConfiguration extends WorkerConfiguration {
  placeholder: string;
}

export interface SushiSwapV2WorkerConfiguration extends WorkerConfiguration {
  placeholder: string;
}

export interface WorkerConfiguration {
  address: string;
}

export interface WorkerMainConfiguration {
  name: string;
  configuration: WorkerConfiguration;
}

export interface WorkersConfiguration {
  workers: WorkerMainConfiguration[];
}

export function generateCSVFolderPath(type: string, worker: string) {
  return `${Constants.DATA_DIR}/${worker}`;
  // return `${Constants.DATA_DIR}/${type}/${worker}`;
}

// export function generateUnifedCSVBasePathForPair(type: string, worker: string, pair: string) {
//   return generateCSVFolderPath(type, worker) + `/${pair}`;
// }

export function generateRawCSVFilePath(worker: string, pair: string) {
  return `${Constants.DATA_DIR}/${worker}/${pair}_${worker}.csv`;
  // return generateUnifedCSVBasePathForPair('raw', worker, pair) + `/${worker}.${pair}.raw.csv`;
}

export function generateUnifiedCSVFilePath(worker: string, pair: string) {
  return `${Constants.DATA_DIR}/precomputed/${worker}/${pair}-unified-data.csv`;
  // return generateUnifedCSVBasePathForPair('computed', worker, pair) + `/${worker}.${pair}.computed.csv`;
}

export function generatePriceCSVFilePath(worker: string, pair: string) {
  return `${Constants.DATA_DIR}/precomputed/price/${worker}/${pair}-unified-data.csv`;
  // return generateUnifedCSVBasePathForPair('price', worker, pair) + `/${worker}.${pair}.price.csv`;
}

export function listAllExistingRawPairs() {
  return fs
    .readdirSync(`${Constants.DATA_DIR}/uniswapv2`)
    .filter((f) => f.endsWith('.csv'))
    .map((f) => f.split('_')[0]);
}
