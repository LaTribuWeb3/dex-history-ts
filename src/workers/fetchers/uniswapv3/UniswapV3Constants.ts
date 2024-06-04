import BigNumber from 'bignumber.js';

export class UniswapV3Constants {
  static CONSTANT_1e18 = new BigNumber(10).pow(18);
  static CONSTANT_TARGET_SLIPPAGE = 20;
  static CONSTANT_BLOCK_INTERVAL = process.env.NETWORK == 'MANTLE' ? 300 : 50;
}
