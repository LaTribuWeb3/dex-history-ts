import { AgniPoolV3__factory } from '../../../contracts/types';
import { UniswapV3Fetcher } from '../uniswapv3/UniswapV3Fetcher';
import ethers from 'ethers';

export class AgniFinanceFetcher extends UniswapV3Fetcher {
  constructor(runEveryMinutes: number, configVersion: string) {
    super(runEveryMinutes, configVersion, 'agnifinance', 'Agni Finance Fetcher');
  }

  override getPairContract(poolAddress: string): ethers.BaseContract {
    console.log(`getPairContract: getting specific agni finance contract for ${poolAddress}`);
    return AgniPoolV3__factory.connect(poolAddress, this.web3Provider);
  }
}
