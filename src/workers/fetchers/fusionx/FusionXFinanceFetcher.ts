import { FusionXPoolV3__factory } from '../../../contracts/types';
import { UniswapV3Fetcher } from '../uniswapv3/UniswapV3Fetcher';
import ethers from 'ethers';

export class FusionXFinanceFetcher extends UniswapV3Fetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'fusionx', 'FusionX Finance Fetcher');
  }

  override getPairContract(poolAddress: string): ethers.BaseContract {
    console.log(`getPairContract: getting specific fusion contract for ${poolAddress}`);
    return FusionXPoolV3__factory.connect(poolAddress, this.web3Provider);
  }
}
