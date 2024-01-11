import { BaseWorker } from '../../BaseWorker';

export class UniswapV3Fetcher extends BaseWorker {
  constructor(runEveryMinutes: number) {
    super("uniswapv3", runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
