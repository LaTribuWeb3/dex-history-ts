import { readFileSync } from 'fs';
import { HttpGet } from '../utils/Utils';
import * as WorkerConfiguration from '../workers/configuration/WorkerConfiguration';
import { WorkersConfiguration } from '../workers/configuration/WorkerConfiguration';
import { TokenList } from '../workers/configuration/TokenData';

const configCache: any = {};

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

  static async getWorkersConfiguration(
    configVersion = 'ethereum'
  ): Promise<WorkersConfiguration<WorkerConfiguration.FetcherConfiguration>> {
    const configKey = `worker-${configVersion}`;
    if (configCache[configKey]) {
      return configCache[configKey];
    }

    const workersConfigFile =
      process.env.WORKERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/workers.${configVersion}.json`;
    const workers = await Configuration.loadConfig<WorkersConfiguration<WorkerConfiguration.FetcherConfiguration>>(
      workersConfigFile
    );

    configCache[configKey] = workers;
    return workers;
  }

  static async getTokensConfiguration(configVersion = 'ethereum'): Promise<TokenList> {
    const configKey = `tokens-${configVersion}`;
    if (configCache[configKey]) {
      return configCache[configKey];
    }
    const tokensConfigFile =
      process.env.TOKENS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/tokens.${configVersion}.json`;
    const tokens = await Configuration.loadConfig<TokenList>(tokensConfigFile);

    configCache[configKey] = tokens;
    return tokens;
  }

  static async getPrecomputersConfiguration(
    configVersion = 'ethereum'
  ): Promise<WorkerConfiguration.PrecomputersConfiguration> {
    const configKey = `precomputers-${configVersion}`;
    if (configCache[configKey]) {
      return configCache[configKey];
    }
    const precomputersConfigFile =
      process.env.PRECOMPUTERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/precomputers.${configVersion}.json`;
    const precomputers: WorkerConfiguration.PrecomputersConfiguration =
      await Configuration.loadConfig<WorkerConfiguration.PrecomputersConfiguration>(precomputersConfigFile);

    configCache[configKey] = precomputers;
    return precomputers;
  }
}
