import { readFileSync } from 'fs';
import axios, { AxiosResponse } from 'axios';
import retry from '../utils/Utils';
import * as WorkerConfiguration from '../workers/configuration/WorkerConfiguration';
import { WorkersConfiguration } from '../workers/configuration/WorkerConfiguration';
import { TokenList } from '../workers/configuration/TokenData';

export class Configuration {
  static async loadConfig<T>(fileOrURL: string): Promise<T> {
    // Log(`LoadConfiguration: loading tokens data from ${TOKENS_FILE}`);
    if (fileOrURL.startsWith('http')) {
      // load via http
      return await Configuration.HttpGet<T>(fileOrURL);
    } else {
      // read from filesystem
      return JSON.parse(readFileSync(fileOrURL, 'utf-8')) as T;
    }
  }

  static async HttpGet<T>(url: string, config?: any): Promise<T> {
    const axiosResp: AxiosResponse<T> = (await retry(axios.get, [url, config])) as AxiosResponse<T>;

    return axiosResp.data;
  }

  static async getWorkersConfiguration() {
    const configVersion = 'default';
    const workersConfigFile =
      process.env.WORKERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/src/config/workers.${configVersion}.json`;
    const workers = await Configuration.loadConfig<WorkersConfiguration<WorkerConfiguration.FetcherConfiguration>>(
      workersConfigFile
    );
    return workers;
  }

  static async getTokensConfiguration() {
    const configVersion = 'default';
    const tokensConfigFile =
      process.env.TOKENS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/src/config/tokens.${configVersion}.json`;
    const workers = await Configuration.loadConfig<TokenList>(tokensConfigFile);
    return workers;
  }
}
