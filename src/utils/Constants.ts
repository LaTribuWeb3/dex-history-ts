import BigNumber from 'bignumber.js';
import * as dotenv from 'dotenv';
dotenv.config();

export enum NetworkEnum {
  ETH = 'ETH',
  MANTLE = 'MANTLE',
  BSC = 'BSC'
}

function enumFromStringValue<T>(enm: { [s: string]: T }, value: string | undefined): T | undefined {
  if (!value) {
    return undefined;
  }
  return (Object.values(enm) as unknown as string[]).includes(value) ? (value as unknown as T) : undefined;
}

function getBlockTime(network: NetworkEnum): number {
  switch (network) {
    case NetworkEnum.ETH:
      return 12;
    case NetworkEnum.BSC:
      return 3;
    case NetworkEnum.MANTLE:
      return 2;
  }
}

/**
 * Where all the files are saved
 */
export const DATA_DIR = process.env.DATA_DIR || process.cwd() + '/data';

export const NETWORK = enumFromStringValue<NetworkEnum>(NetworkEnum, process.env.NETWORK);
if (!NETWORK) {
  throw new Error(`NETWORK NOT DEFINED OR WRONG ${process.env.NETWORK}`);
}

export const BLOCK_TIME = getBlockTime(NETWORK);
/**
 * Base slippages we are searching for the risk oracle frontend
 * Value in percent
 */
export const TARGET_SLIPPAGES = [1, 5, 10, 15, 20];

/**
 * The spans of days we want to export to the risk oracle frontend
 */
export const SPANS = [1, 7, 30, 180, 365];

export const BN_1e18 = new BigNumber(10).pow(18);

// 1h step block
export const DEFAULT_STEP_BLOCK = 3600 / BLOCK_TIME;

export const CONFIG_CACHE_DURATION = 10 * 60 * 1000; // 10 min cache duration for config

// median over 1h
export const MEDIAN_OVER_BLOCK = 3600 / BLOCK_TIME;
