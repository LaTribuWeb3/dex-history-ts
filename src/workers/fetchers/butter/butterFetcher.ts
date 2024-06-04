import { UniswapV3Fetcher } from '../uniswapv3/UniswapV3Fetcher';

export class ButterFetcher extends UniswapV3Fetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'butter', 'Butter.xyz Fetcher');
  }
}
