import { UniswapV2Fetcher } from '../uniswapv2/UniswapV2Fetcher';

export class MerchantMoeClassicFetcher extends UniswapV2Fetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'merchantmoeclassic', 'Merchant Moe Classic Fetcher');
  }
}

// async function debug() {
//   const fetcher = new MerchantMoeClassicFetcher(60, 'mantle');
//   await fetcher.run();
// }

// debug();
