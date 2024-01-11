import { BaseWorker } from '../../BaseWorker';

export class SushiswapV2Fetcher extends BaseWorker {
  constructor(runEveryMinutes: number) {
    super("sushiswapv2", runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
