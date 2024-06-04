import { UniswapV3Fetcher } from '../uniswapv3/UniswapV3Fetcher';

export class AgniFinanceFetcher extends UniswapV3Fetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'agnifinance', 'Agni Finance Fetcher');
  }
}
