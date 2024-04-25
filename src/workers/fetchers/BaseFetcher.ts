import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import tokens from '../../config/tokens.json';
import * as Constants from '../../utils/Constants';
import { BaseWorker } from '../BaseWorker';
import { TokenList } from '../configuration/TokenData';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
dotenv.config();

/**
 * This is the base worker class
 * It is used to log monitoring
 */
export abstract class BaseFetcher<T extends WorkerConfiguration.FetcherConfiguration> extends BaseWorker<T> {
  tokens: TokenList;

  constructor(workerName: string, monitoringName: string, runEveryMinutes: number) {
    super(workerName, monitoringName, runEveryMinutes);

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

