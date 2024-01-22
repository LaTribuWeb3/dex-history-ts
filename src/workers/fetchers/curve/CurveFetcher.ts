import { BaseWorker } from '../../BaseWorker';
import { CurveFetcherWorkerConfiguration } from '../../configuration/WorkerConfiguration';

export class CurveFetcher extends BaseWorker<CurveFetcherWorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('curvefetcher', runEveryMinutes);
  }

  runSpecific(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
