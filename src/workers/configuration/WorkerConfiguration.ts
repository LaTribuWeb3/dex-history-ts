import * as Constants from '../../utils/Constants';
import * as fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

export interface UniSwapV2PairConfiguration {
  name: string;
  startBlock?: number;
}

export interface CurveFetcherWorkerConfiguration extends WorkerConfiguration {
  placeholder: string;
}

export interface UniSwapV2WorkerConfiguration extends WorkerConfiguration {
  factoryAddress: string;
  pairs: UniSwapV2PairConfiguration[];
}

export interface CurveToken {
  symbol: string;
  address: string;
}

export interface CurvePairConfiguration {
  poolAddress: string;
  poolName: string;
  lpTokenAddress: string;
  lpTokenName: string;
  abi: string;
  isCryptoV2?: boolean;
  minBlock?: number;
  tokens: CurveToken[];
}

export interface CurveWorkerConfiguration extends WorkerConfiguration {
  factoryAddress: string;
  pairs: CurvePairConfiguration[];
}

export interface UniSwapV3WorkerConfiguration extends WorkerConfiguration {
  placeholder: string;
}

export interface SushiSwapV2WorkerConfiguration extends WorkerConfiguration {
  placeholder: string;
}

export interface WorkerConfiguration {
  configType: string;
}

export interface WorkerMainConfiguration {
  name: string;
  configuration: WorkerConfiguration;
}

export interface WorkersConfiguration {
  workers: WorkerMainConfiguration[];
}

const directoryStructureVersion = process.env.DIRECTORY_STRUCTURE_VERSION || 0;

export function generateCSVFolderPath(type: string, worker: string) {
  if (directoryStructureVersion == 0) return `${Constants.DATA_DIR}/${worker}`;
  else return `${Constants.DATA_DIR}/${type}/${worker}`;
}

export function generateUnifedCSVBasePathForPair(type: string, worker: string, pair: string) {
  return generateCSVFolderPath(type, worker) + `/${pair}`;
}

export function generateRawCSVFilePathForPair(worker: string, pair: string) {
  if (directoryStructureVersion == 0) return `${Constants.DATA_DIR}/${worker}/${pair}_${worker}.csv`;
  else return generateUnifedCSVBasePathForPair('raw', worker, pair) + `/${worker}.${pair}.raw.csv`;
}

export function generateRawCSVFilePathForCurvePool(worker: string, pool: string) {
  if (directoryStructureVersion == 0) return `${Constants.DATA_DIR}/${worker}/${pool}_${worker}.csv`;
  else return generateUnifedCSVBasePathForPair('raw', worker, pool) + `/${worker}.${pool}.raw.csv`;
}

export function getAllPreComputed(worker: string): string[] {
  if (directoryStructureVersion == 0)
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
  if (directoryStructureVersion == 0) return `${Constants.DATA_DIR}/precomputed/${worker}/${pair}-unified-data.csv`;
  else return generateUnifedCSVBasePathForPair('computed', worker, pair) + `/${worker}.${pair}.computed.csv`;
}

export function generatePriceCSVFilePath(worker: string, pair: string) {
  if (directoryStructureVersion == 0)
    return `${Constants.DATA_DIR}/precomputed/price/${worker}/${pair}-unified-data.csv`;
  else return generateUnifedCSVBasePathForPair('price', worker, pair) + `/${worker}.${pair}.price.csv`;
}

export function listAllExistingRawPairs(workerName: string) {
  if (directoryStructureVersion == 0)
    return fs
      .readdirSync(path.join(Constants.DATA_DIR, workerName))
      .filter((f) => f.endsWith('.csv'))
      .map((f) => f.split('_')[0]);
  else return fs.readdirSync(`${Constants.DATA_DIR}/raw/uniswapv2`);
}

export function generateCurvePoolSummaryFullName(workerName: string): string {
  return `${Constants.DATA_DIR}/${workerName}/${workerName}_pools_summary.json`;
}

export function generateCurvePoolFetcherResult(workerName: string): string {
  return `${Constants.DATA_DIR}/${workerName}/${workerName}-fetcher-result.json`;
}
