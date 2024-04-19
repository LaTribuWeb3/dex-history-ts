import * as Constants from '../../utils/Constants';
import * as fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

export interface UniSwapV2PairConfiguration {
  name: string;
  startBlock?: number;
}

export interface BalancerPoolConfiguration {
  name: string;
  deployBlock: number;
  address: string;
  poolId: string;
  type: BalancerPoolTypeEnum;
  tokenSymbols: string[];
  tokenIndexes: number[]; // index of the tokens from the vault.getPoolTokens
  minBlock?: number;
  computePrice: boolean; // whether or not to compute the prices of this pool
}

export enum BalancerPoolTypeEnum {
  META_STABLE_POOL = 'MetaStablePool',
  COMPOSABLE_STABLE_POOL = 'ComposableStablePool',
  WEIGHTED_POOL_2_TOKENS = 'WeightedPool2Tokens'
}

export interface CurveFetcherWorkerConfiguration extends FetcherConfiguration {
  placeholder: string;
}

export interface UniSwapV2WorkerConfiguration extends FetcherConfiguration {
  factoryAddress: string;
  pairs: UniSwapV2PairConfiguration[];
}

export interface BalancerWorkerConfiguration extends FetcherConfiguration {
  vaultAddress: string;
  pools: BalancerPoolConfiguration[];
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

export interface CurveTokenPair {
  token0: string;
  token1: string;
}

export interface CurvePricePairConfiguration {
  poolAddress: string;
  poolName: string;
  abi: string;
  tokens: CurveToken[];
  pairs: CurveTokenPair[];
}

export interface CurveWorkerConfiguration extends FetcherConfiguration {
  factoryAddress: string;
  pairs: CurvePairConfiguration[];
  pricePairs: CurvePricePairConfiguration[];
}

export interface UniSwapV3WorkerConfiguration extends FetcherConfiguration {
  factoryAddress: string;
  startBlockNumber?: number;
  pairs: UniswapV3PairConfiguration[];
  fees: number[];
}

export interface UniswapV3PairConfiguration {
  token0: any;
  token1: any;
  placeholder: string;
}

export type Univ3PairWithFeesAndPool = {
  pairToFetch: UniswapV3PairConfiguration;
  fee: number;
  poolAddress: string;
};

export interface SushiSwapV2WorkerConfiguration extends FetcherConfiguration {
  placeholder: string;
}

export interface FetcherConfiguration extends WorkerConfiguration {
  configType: string;
}

export abstract class WorkerConfiguration {}

export interface WorkerMainConfiguration {
  name: string;
  configuration: FetcherConfiguration;
}

// Main class for the configuration file workers.json
export interface WorkersConfiguration {
  workers: WorkerMainConfiguration[];
}

const directoryStructureVersion = process.env.DIRECTORY_STRUCTURE_VERSION || 0;

export function generateCSVFolderPath(type = '', worker: string) {
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

export function generateRawCSVFilePathForBalancerPool(worker: string, pool: string) {
  if (directoryStructureVersion == 0) return `${Constants.DATA_DIR}/${worker}/${pool}_${worker}.csv`;
  else return generateUnifedCSVBasePathForPair('raw', worker, pool) + `/${worker}.${pool}.raw.csv`;
}

export function getAllPreComputed(worker: string): string[] {
  if (directoryStructureVersion == 0)
    return readdirSyncWithFullPath(generatePreComputedForWorker(worker)).filter((file) =>
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
  if (directoryStructureVersion == 0) return generatePreComputedForWorker(worker) + `/${pair}-unified-data.csv`;
  else return generateUnifedCSVBasePathForPair('computed', worker, pair) + `/${worker}.${pair}.computed.csv`;
}

export function generatePreComputedForWorker(worker: string) {
  return `${Constants.DATA_DIR}/precomputed/${worker}`;
}

export function generatePriceCSVFilePath(worker: string, pair: string) {
  if (directoryStructureVersion == 0)
    return `${Constants.DATA_DIR}/precomputed/price/${worker}/${pair}-unified-data.csv`;
  else return generateUnifedCSVBasePathForPair('price', worker, pair) + `/${worker}.${pair}.price.csv`;
}

export function generateLastFetchFileName(worker: string, pool: string) {
  if (directoryStructureVersion == 0) return `${Constants.DATA_DIR}/precomputed/price/${worker}/${pool}-lastfetch.json`;
  else return generateCSVFolderPath('price', worker) + `/${pool}-lastfetch.json`;
}

export function generateUnifiedDataFileName(worker: string, pool: string) {
  if (directoryStructureVersion == 0)
    return `${Constants.DATA_DIR}/precomputed/price/${worker}/${pool}-unified-data.csv`;
  else return generateCSVFolderPath('price', worker) + `/${pool}-unified-data.csv`;
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

export function generateFetcherResultFilename(workerName: string): string {
  return `${Constants.DATA_DIR}/${workerName}/${workerName}-fetcher-result.json`;
}

export function getCurvePoolSummaryFile() {
  return `${Constants.DATA_DIR}/curve/curve_pools_summary.json`;
}

export function getUniswapV3PairLatestDataPath(pairWithFeesAndPool: Univ3PairWithFeesAndPool) {
  return `${Constants.DATA_DIR}/uniswapv3/${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}-latestdata.json`;
}

export function getUniswapV3PairDataPath(pairWithFeesAndPool: Univ3PairWithFeesAndPool) {
  return `${Constants.DATA_DIR}/uniswapv3/${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}-data.csv`;
}

export function getUniswapV3FetcherResultPath() {
  return `${Constants.DATA_DIR}/uniswapv3/uniswapv3-fetcher-result.json`;
}

export function getUniswapV3BaseFolder() {
  return `${Constants.DATA_DIR}/uniswapv3`;
}

export function ensureCurvePrecomputedPresent() {
  const dir = `${Constants.DATA_DIR}/precomputed/curve`;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function ensureBalancerPrecomputedPresent() {
  const dir = `${Constants.DATA_DIR}/precomputed/balancer`;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
