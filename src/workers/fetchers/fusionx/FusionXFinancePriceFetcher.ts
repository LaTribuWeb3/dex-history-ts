import { FusionXPoolV3__factory } from '../../../contracts/types';
import { UniswapV3PriceFetcher } from '../uniswapv3/UniswapV3PriceFetcher';
import ethers from 'ethers';

export class FusionXFinancePriceFetcher extends UniswapV3PriceFetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'fusionx', 'FusionX Finance Price Fetcher');
  }

  override getPairContract(poolAddress: string): ethers.BaseContract {
    console.log(`getPairContract: getting specific fusion contract for ${poolAddress}`);
    return FusionXPoolV3__factory.connect(poolAddress, this.web3Provider);
  }
}
