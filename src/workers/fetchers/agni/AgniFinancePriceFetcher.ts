import { UniswapV3PriceFetcher } from '../uniswapv3/UniswapV3PriceFetcher';

export class AgniFinancePriceFetcher extends UniswapV3PriceFetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'agnifinance', 'Agni Finance Price Fetcher');
  }
}
