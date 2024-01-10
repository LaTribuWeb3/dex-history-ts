import { BaseWorker } from '../../BaseWorker';

export class UniswapV2Fetcher extends BaseWorker {
  constructor(workerName: string, runEveryMinutes: number) {
    super(workerName, runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
