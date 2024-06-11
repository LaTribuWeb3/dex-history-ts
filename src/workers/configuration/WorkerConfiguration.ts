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
  fixedBlockStep?: number;
  factoryAddress: string;
  pairs: UniSwapV2PairConfiguration[];
}

export interface MerchantMoeV2WorkerConfiguration extends FetcherConfiguration {
  fixedBlockStep?: number;
  factoryAddress: string;
  pairs: MerchantMoeV2PairConfiguration[];
  fees: number[];
}

export interface MerchantMoeV2PairConfiguration {
  token0: any;
  token1: any;
  placeholder?: string;
}

export type MerchantMoeV2PairWithFeesAndPool = {
  pairToFetch: MerchantMoeV2PairConfiguration;
  fee?: number;
  binStep: number;
  poolAddress: string;
};

export function getMerchantMoeV2PairLatestDataPath(
  pairWithFeesAndPool: MerchantMoeV2PairWithFeesAndPool,
  workerName = 'merchantmoev2'
) {
  return `${Constants.DATA_DIR}/${workerName}/${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}-latestdata.json`;
}

export function getMerchantMoeV2PairDataPath(
  pairWithFeesAndPool: MerchantMoeV2PairWithFeesAndPool,
  workerName = 'merchantmoev2'
) {
  return `${Constants.DATA_DIR}/${workerName}/${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}-data.csv`;
}
export function getMerchantMoeV2ResultPath(workerName = 'merchantmoev2') {
  return `${Constants.DATA_DIR}/${workerName}/${workerName}-fetcher-result.json`;
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
  minBlock?: number;
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
  fixedBlockStep?: number;
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

export class EmptyConfiguration extends WorkerConfiguration {}
export class FetchersRunnerConfiguration extends WorkerConfiguration {}
export class PrecomputerConfiguration extends WorkerConfiguration {}
export class ComputersRunnerConfiguration extends WorkerConfiguration {}

export interface MedianPrecomputerConfiguration extends WorkerConfiguration {
  platforms: string[];
  watchedPairs: WatchedPair[];
}

export interface WatchedPair {
  base: string;
  quotes: PairQuote[];
}

export interface PairQuote {
  quote: string;
  pivots?: string[];
  pivotsSpecific?: SpecificPivot[];
}

export interface SpecificPivot {
  platform: string;
  pivots: string[];
}

export interface PrecomputersConfiguration {
  precomputers: { name: string; configuration: PrecomputerConfiguration }[];
}

export interface WorkerMainConfiguration<T extends WorkerConfiguration> extends NamedWorkerConfiguration<T> {
  name: string;
  configuration: T;
}

export interface NamedWorkerConfiguration<T extends WorkerConfiguration> {
  name: string;
  configuration: T;
}

// Main class for the configuration file workers.json
export interface WorkersConfiguration<T extends WorkerConfiguration> {
  workers: WorkerMainConfiguration<T>[];
}

export interface AdditionalLiquidityPrecomputerConfiguration extends WorkerConfiguration {
  platformedAdditionalLiquidities: PlatformedAdditionalLiquidities[];
}

export interface PlatformedAdditionalLiquidities {
  platform: string;
  additionalLiquidities: AdditionalLiquidity[];
}

export interface AdditionalLiquidity {
  from: string;
  pivot: string;
  to: string;
  priceSource: string;
  priceFrom: string;
  priceTo: string;
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

export function generatePreComputedPriceForWorker(worker: string) {
  return `${Constants.DATA_DIR}/precomputed/price/${worker}`;
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

export function getUniswapV3PairLatestDataPath(
  pairWithFeesAndPool: Univ3PairWithFeesAndPool,
  workerName = 'uniswapv3'
) {
  return `${Constants.DATA_DIR}/${workerName}/${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}-latestdata.json`;
}

export function getUniswapV3PairDataPath(pairWithFeesAndPool: Univ3PairWithFeesAndPool, workerName = 'uniswapv3') {
  return `${Constants.DATA_DIR}/${workerName}/${pairWithFeesAndPool.pairToFetch.token0}-${pairWithFeesAndPool.pairToFetch.token1}-${pairWithFeesAndPool.fee}-data.csv`;
}

export function getUniswapV3FetcherResultPath(workerName = 'uniswapv3') {
  return `${Constants.DATA_DIR}/${workerName}/${workerName}-fetcher-result.json`;
}

export function getUniswapV3BaseFolder(workerName = 'uniswapv3') {
  return `${Constants.DATA_DIR}/${workerName}`;
}

export function ensureCurvePrecomputedPresent() {
  createDirectoryIfItDoesNotExist(`${Constants.DATA_DIR}/precomputed/curve`);
}

export function ensureBalancerPrecomputedPresent() {
  createDirectoryIfItDoesNotExist(`${Constants.DATA_DIR}/precomputed/balancer`);
}

export function getMedianPlatformDirectory(platform: string) {
  return `${Constants.DATA_DIR}/precomputed/median/` + platform;
}

export function getMedianPricesFilenamesForPlatform(platform: string, base: string, quote: string) {
  const platformDirectory = getMedianPlatformDirectory(platform);
  createDirectoryIfItDoesNotExist(platformDirectory);

  return {
    basequote: path.join(platformDirectory, `${base}-${quote}-median-prices.csv`),
    quotebase: path.join(platformDirectory, `${quote}-${base}-median-prices.csv`)
  };
}

export function checkIfFileExists(filename: string) {
  return fs.existsSync(filename);
}

export function createDirectoryIfItDoesNotExist(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
