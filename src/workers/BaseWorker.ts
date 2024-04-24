import * as WorkerConfiguration from './configuration/WorkerConfiguration';

export abstract class BaseWorker<T extends WorkerConfiguration.WorkerConfiguration> {
  configuration: T;

  constructor(config: T) {
    this.configuration = config;
  }
}
