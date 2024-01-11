import { BaseWorker } from '../../BaseWorker';

export class CurveFetcher extends BaseWorker {
  constructor(runEveryMinutes: number) {
    super("curvefetcher", runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
