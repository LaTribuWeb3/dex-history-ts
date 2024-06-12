import * as fs from 'fs';
import * as path from 'path';
import * as Constants from '../../utils/Constants';
import { BaseWorker } from '../BaseWorker';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
import { Configuration } from '../../config/Configuration';

/**
 * This is the base worker class
 * It is used to log monitoring
 */
export abstract class BaseFetcher<T extends WorkerConfiguration.FetcherConfiguration> extends BaseWorker<T> {
  constructor(workerName: string, monitoringName: string, runEveryMinutes: number, configVersion: string) {
    super(workerName, monitoringName, runEveryMinutes, configVersion);

    this.tokens = {};
    console.log(`worker name: ${this.workerName}`);
  }

  async createDataDirForWorker() {
    if (!fs.existsSync(path.join(Constants.DATA_DIR, this.workerName))) {
      fs.mkdirSync(path.join(Constants.DATA_DIR, this.workerName), { recursive: true });
    }
  }

  override async init() {
    const workers = await Configuration.getWorkersConfiguration(this.configVersion);

    if (workers.workers == undefined) {
      return;
    }

    const foundWorker = workers.workers.find((worker) => worker.name === this.workerName);
    if (foundWorker === undefined) {
      return;
    }

    this.setConfiguration(foundWorker.configuration as unknown as T);
    this.tokens = await Configuration.getTokensConfiguration(this.configVersion);
  }

  async createPriceDataDirForWorker() {
    const dirPath = path.join(Constants.DATA_DIR, 'precomputed', 'price', this.workerName);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}
