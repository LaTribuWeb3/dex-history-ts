import * as Constants from '../../utils/Constants';
import * as fs from 'fs';
import workers from '../../../config/workers.json';
import path from 'path';

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
  directoryStructureVersion: number;
  workers: WorkerMainConfiguration[];
}

export function generateCSVFolderPath(type: string, worker: string) {
  if (workers.directoryStructureVersion == 0) return `${Constants.DATA_DIR}/${worker}`;
  else return `${Constants.DATA_DIR}/${type}/${worker}`;
}

export function generateUnifedCSVBasePathForPair(type: string, worker: string, pair: string) {
  return generateCSVFolderPath(type, worker) + `/${pair}`;
}

export function generateRawCSVFilePath(worker: string, pair: string) {
  if (workers.directoryStructureVersion == 0) return `${Constants.DATA_DIR}/${worker}/${pair}_${worker}.csv`;
  else return generateUnifedCSVBasePathForPair('raw', worker, pair) + `/${worker}.${pair}.raw.csv`;
}

export function getAllPreComputed(worker: string): string[] {
  if (workers.directoryStructureVersion == 0)
    return readdirSyncWithFullPath(`${Constants.DATA_DIR}/precomputed/${worker}`).filter((file) =>
      file.endsWith('unified-data.csv')
    );
  else
    return readdirSyncWithFullPath(generateCSVFolderPath('computed', worker)).flatMap((f) =>
      readdirSyncWithFullPath(f)
    );
}

export function readdirSyncWithFullPath(dir: string): string[] {
  return fs.readdirSync(dir).map((f) => path.join(dir, f));
}

export function generateUnifiedCSVFilePath(worker: string, pair: string) {
  if (workers.directoryStructureVersion == 0)
    return `${Constants.DATA_DIR}/precomputed/${worker}/${pair}-unified-data.csv`;
  else return generateUnifedCSVBasePathForPair('computed', worker, pair) + `/${worker}.${pair}.computed.csv`;
}

export function generatePriceCSVFilePath(worker: string, pair: string) {
  if (workers.directoryStructureVersion == 0)
    return `${Constants.DATA_DIR}/precomputed/price/${worker}/${pair}-unified-data.csv`;
  else return generateUnifedCSVBasePathForPair('price', worker, pair) + `/${worker}.${pair}.price.csv`;
}

export function listAllExistingRawPairs() {
  if (workers.directoryStructureVersion == 0)
    return fs
      .readdirSync(`${Constants.DATA_DIR}/uniswapv2`)
      .filter((f) => f.endsWith('.csv'))
      .map((f) => f.split('_')[0]);
  else return fs.readdirSync(`${Constants.DATA_DIR}/raw/uniswapv2`);
}
