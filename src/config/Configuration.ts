import { readFileSync } from 'fs';
import { HttpGet } from '../utils/Utils';
import * as WorkerConfiguration from '../workers/configuration/WorkerConfiguration';
import { WorkersConfiguration } from '../workers/configuration/WorkerConfiguration';
import { TokenList } from '../workers/configuration/TokenData';
import SimpleCacheService from '../utils/SimpleCacheService';
import { CONFIG_CACHE_DURATION } from '../utils/Constants';

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
    configVersion: string
  ): Promise<WorkersConfiguration<WorkerConfiguration.FetcherConfiguration>> {
    const configKey = `worker-${configVersion}`;
    const workersConfigFile =
      process.env.WORKERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/workers.${configVersion}.json`;

    const workers = await SimpleCacheService.GetAndCache(
      configKey,
      () => Configuration.loadConfig<WorkersConfiguration<WorkerConfiguration.FetcherConfiguration>>(workersConfigFile),
      CONFIG_CACHE_DURATION
    );

    return workers;
  }

  static async getTokensConfiguration(configVersion: string): Promise<TokenList> {
    const configKey = `tokens-${configVersion}`;
    const tokensConfigFile =
      process.env.TOKENS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/tokens.${configVersion}.json`;

    const tokens = await SimpleCacheService.GetAndCache(
      configKey,
      () => Configuration.loadConfig<TokenList>(tokensConfigFile),
      CONFIG_CACHE_DURATION
    );

    return tokens;
  }

  static async getPrecomputersConfiguration(
    configVersion: string
  ): Promise<WorkerConfiguration.PrecomputersConfiguration> {
    const configKey = `precomputers-${configVersion}`;
    const precomputersConfigFile =
      process.env.PRECOMPUTERS_CONFIG_FILE ||
      `https://raw.githubusercontent.com/LaTribuWeb3/dex-history-ts/main/params/precomputers.${configVersion}.json`;

    const precomputers = await SimpleCacheService.GetAndCache(
      configKey,
      () => Configuration.loadConfig<WorkerConfiguration.PrecomputersConfiguration>(precomputersConfigFile),
      CONFIG_CACHE_DURATION
    );

    return precomputers;
  }
}
