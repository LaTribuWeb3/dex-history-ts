import { BaseWorker } from '../../BaseWorker';
import { SushiSwapV2WorkerConfiguration } from '../../configuration/WorkerConfiguration';

export class SushiswapV2Fetcher extends BaseWorker<SushiSwapV2WorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('sushiswapv2', runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
