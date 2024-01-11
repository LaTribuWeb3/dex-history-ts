import { BaseWorker } from '../../BaseWorker'
import * as ethers from 'ethers'

export class UniswapV2Fetcher extends BaseWorker {
  constructor(runEveryMinutes: number) {
    super("uniswapv2", runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    const web3Provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    this.createDataDirForWorker();
    throw new Error('Method not implemented.');
  }
}
