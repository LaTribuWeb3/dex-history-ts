import { readFileSync } from 'fs';
import { HttpGet } from '../utils/Utils';
import * as WorkerConfiguration from '../workers/configuration/WorkerConfiguration';
import { WorkersConfiguration } from '../workers/configuration/WorkerConfiguration';
import { TokenList } from '../workers/configuration/TokenData';

export class Configuration {
  static async loadConfig<T>(fileOrURL: string): Promise<T> {
    // Log(`LoadConfiguration: loading tokens data from ${TOKENS_FILE}`);
    if (fileOrURL.startsWith('http')) {
      // load via http
      return await HttpGet<T>(fileOrURL);
    } else {
      // read from filesystem
      return JSON.parse(readFileSync(fileOrURL, 'utf-8')) as T;
    }
  }

  static async getWorkersConfiguration() {
    const configVersion = 'default';
    const workersConfigFile =
      process.env.WORKERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/workers.${configVersion}.json`;
    const workers = await Configuration.loadConfig<WorkersConfiguration<WorkerConfiguration.FetcherConfiguration>>(
      workersConfigFile
    );
    return workers;
  }

  static async getTokensConfiguration() {
    const configVersion = 'default';
    const tokensConfigFile =
      process.env.TOKENS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/tokens.${configVersion}.json`;
    const workers = await Configuration.loadConfig<TokenList>(tokensConfigFile);
    return workers;
  }

  static async getPrecomputersConfiguration(): Promise<WorkerConfiguration.PrecomputersConfiguration> {
    const configVersion = 'default';
    const precomputersConfigFile =
      process.env.PRECOMPUTERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/precomputers.${configVersion}.json`;
    const precomputers: WorkerConfiguration.PrecomputersConfiguration =
      await Configuration.loadConfig<WorkerConfiguration.PrecomputersConfiguration>(precomputersConfigFile);
    return precomputers;
  }
}
