import { UniswapV3Fetcher } from '../uniswapv3/UniswapV3Fetcher';

export class FusionXFinanceFetcher extends UniswapV3Fetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'fusionx', 'FusionX Finance Fetcher');
  }
}
