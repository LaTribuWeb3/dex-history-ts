import { UniswapV2Fetcher } from '../uniswapv2/UniswapV2Fetcher';

export class SushiswapV2Fetcher extends UniswapV2Fetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'sushiswapv2', 'SushiswapV2 Fetcher');
  }
}
