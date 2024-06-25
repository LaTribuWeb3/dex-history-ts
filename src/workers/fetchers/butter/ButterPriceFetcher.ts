import { UniswapV3PriceFetcher } from '../uniswapv3/UniswapV3PriceFetcher';

export class ButterPriceFetcher extends UniswapV3PriceFetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'butter', 'Butter.xyz Price Fetcher');
  }
}
