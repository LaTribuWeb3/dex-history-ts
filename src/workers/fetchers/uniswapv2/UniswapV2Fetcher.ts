import { BaseWorker } from '../../BaseWorker';

export class UniswapV2Fetcher extends BaseWorker {
  constructor(runEveryMinutes: number) {
    super("uniswapv2", runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
