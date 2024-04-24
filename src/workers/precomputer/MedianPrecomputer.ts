import { BaseWorker } from '../BaseWorker';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
import precomputers from '../../config/precomputers.json';
import { sleep } from '../../utils/Utils';
import { createDirectoryIfItDoesNotExist, getMedianPlatformDirectory } from '../configuration/WorkerConfiguration';

export class MedianPrecomputer extends BaseWorker<WorkerConfiguration.PrecomputerConfiguration> {
  // Assuming workers is an array of worker configurations
  protected static findPrecomputerConfigurationByName<T extends WorkerConfiguration.PrecomputerConfiguration>(
    name: string
  ): T {
    const foundWorker = precomputers.precomputers.find((worker) => worker.name === name);
    if (foundWorker === undefined) {
      throw new Error('Could not find worker with name: ' + name);
    }
    return foundWorker.configuration as unknown as T;
  }

  constructor(runEveryMinute: number) {
    super(
      MedianPrecomputer.findPrecomputerConfigurationByName('median'),
      'median',
      'Median Precomputer',
      runEveryMinute
    );
  }

  async runSpecific() {
    for (const platform of this.configuration.platforms) {
      const directory = getMedianPlatformDirectory(platform);
      createDirectoryIfItDoesNotExist(directory);

      const currentBlock = (await this.web3Provider.getBlockNumber()) - 10;

      for (const { base, quotes: quotesConfig } of this.configuration.watchedPairs) {
        for (const quoteConfig of quotesConfig) {
          let pivots;

          if (
            quoteConfig.pivotsSpecific &&
            quoteConfig.pivotsSpecific.filter((_) => _.platform == platform).length !== 0
          ) {
            pivots = quoteConfig.pivotsSpecific.filter((_) => _.platform == platform)[0].pivots;
          } else {
            pivots = quoteConfig.pivots;
          }

          // await precomputeAndSaveMedianPrices(directory, platform, base, quoteConfig.quote, currentBlock, pivots);
          console.log(
            'await precomputeAndSaveMedianPrices(directory, platform, base, quoteConfig.quote, currentBlock, pivots)'
          );
        }
      }

      console.log(directory);
    }
    await sleep(100);
  }
}
