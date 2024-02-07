import { BaseWorker } from '../../BaseWorker';
import { UniSwapV3WorkerConfiguration } from '../../configuration/WorkerConfiguration';

export class UniswapV3Fetcher extends BaseWorker<UniSwapV3WorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('uniswapv3', 'UniswapV3 Fetcher', runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
