import { readFileSync } from 'fs';
import axios, { AxiosResponse } from 'axios';
import retry from '../utils/Utils';
import * as WorkerConfiguration from '../workers/configuration/WorkerConfiguration';
import { WorkersConfiguration } from '../workers/configuration/WorkerConfiguration';

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

  static async getPrecomputersConfiguration(): Promise<WorkerConfiguration.PrecomputersConfiguration> {
    const configVersion = 'default';
    const precomputersConfigFile =
      process.env.PRECOMPUTERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/src/config/precomputers.${configVersion}.json`;
    const precomputers: WorkerConfiguration.PrecomputersConfiguration =
      await Configuration.loadConfig<WorkerConfiguration.PrecomputersConfiguration>(precomputersConfigFile);
    return precomputers;
  }
}
