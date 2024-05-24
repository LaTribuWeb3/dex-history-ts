import BigNumber from 'bignumber.js';
import * as dotenv from 'dotenv';
dotenv.config();

/**
 * Where all the files are saved
 */
export const DATA_DIR = process.env.DATA_DIR || process.cwd() + '/data';

/**
 * List of platforms (dexes) that are available for data querying
 */
export const PLATFORMS = ['uniswapv2', 'curve', 'uniswapv3', 'sushiswapv2'];

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

/**
 * data source -> uint map
 * from contract:
 * enum LiquiditySource {
        All,
        UniV2,
        UniV3,
        Curve
    }
 */
export const smartLTVSourceMap = {
  all: 0,
  uniswapv2: 1,
  uniswapv3: 2,
  curve: 3
};

export const DEFAULT_STEP_BLOCK = 100;

export const CONFIG_CACHE_DURATION = 10 * 60 * 1000; // 10 min cache duration for config
