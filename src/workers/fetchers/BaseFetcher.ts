import * as Constants from '../../utils/Constants';
import { MonitoringData, MonitoringStatusEnum, RecordMonitoring } from '../../utils/MonitoringHelper';
import * as fs from 'fs';
import * as path from 'path';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
import { TokenList } from '../configuration/TokenData';
import workers from '../../config/workers.json';
import tokens from '../../config/tokens.json';
import * as dotenv from 'dotenv';
import * as ethers from 'ethers';
import * as Web3Utils from '../../utils/Web3Utils';
import { BaseWorker } from '../BaseWorker';
dotenv.config();

/**
 * This is the base worker class
 * It is used to log monitoring
 */
export abstract class BaseFetcher<T extends WorkerConfiguration.FetcherConfiguration> extends BaseWorker<T> {
  tokens: TokenList;
  web3Provider: ethers.JsonRpcProvider;

  // Assuming workers is an array of worker configurations
  protected static findWorkerConfigurationByName<T extends WorkerConfiguration.FetcherConfiguration>(name: string): T {
    const foundWorker = workers.workers.find((worker) => worker.name === name);
    if (foundWorker === undefined) {
      throw new Error('Could not find worker with name: ' + name);
    }
    return foundWorker.configuration as unknown as T;
  }

  constructor(workerName: string, monitoringName: string, runEveryMinutes: number) {
    super(BaseFetcher.findWorkerConfigurationByName<T>(workerName), workerName, monitoringName, runEveryMinutes);

    this.web3Provider = Web3Utils.getJsonRPCProvider();
    this.tokens = tokens;
    console.log(`worker name: ${this.workerName}`);
  }

  async createDataDirForWorker() {
    if (!fs.existsSync(path.join(Constants.DATA_DIR, this.workerName))) {
      fs.mkdirSync(path.join(Constants.DATA_DIR, this.workerName), { recursive: true });
    }
  }

  async createPriceDataDirForWorker() {
    const dirPath = path.join(Constants.DATA_DIR, 'precomputed', 'price', this.workerName);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }
}
