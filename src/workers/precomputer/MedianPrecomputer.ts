import * as fs from 'fs';
import precomputers from '../../config/precomputers.json';
import { sleep } from '../../utils/Utils';
import * as Web3Utils from '../../utils/Web3Utils';
import { BaseWorker } from '../BaseWorker';
import { readLastLine } from '../configuration/Helper';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
import { checkIfFileExists, getMedianPricesFilenamesForPlatform } from '../configuration/WorkerConfiguration';
import { PriceGetter } from './data/median/PriceGetter';

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
    super('median', 'Median Precomputer', runEveryMinute);
  }

  async runSpecific() {
    for (const platform of this.getConfiguration().platforms) {
      const currentBlock = await Web3Utils.getCurrentBlock();

      for (const { base, quotes: quotesConfig } of this.getConfiguration().watchedPairs) {
        for (const quoteConfig of quotesConfig) {
          let pivots: string[] = [];

          if (
            quoteConfig.pivotsSpecific &&
            quoteConfig.pivotsSpecific.filter((_) => _.platform == platform).length !== 0
          ) {
            pivots = quoteConfig.pivotsSpecific.filter((_) => _.platform == platform)[0].pivots;
          } else if (quoteConfig.pivots !== undefined) {
            pivots = quoteConfig.pivots;
          }

          await this.precomputeAndSaveMedianPrices(platform, base, quoteConfig.quote, currentBlock, pivots);
        }
      }
    }
    await sleep(100);
  }

  async precomputeAndSaveMedianPrices(
    platform: string,
    base: string,
    quote: string,
    currentBlock: number,
    pivots: string[]
  ) {
    function getMedianPriceAccordingToPlatform(workerName: string) {
      if (platform == 'all') {
        return PriceGetter.getMedianPricesAllPlatforms(
          workerName,
          base,
          quote,
          lastBlock,
          currentBlock,
          pivots,
          fileAlreadyExists
        );
      } else {
        return PriceGetter.getMedianPricesForPlatform(
          workerName,
          platform,
          base,
          quote,
          lastBlock,
          currentBlock,
          pivots,
          fileAlreadyExists
        );
      }
    }

    console.log(`${this.workerName}[${platform}]: starting for ${base}/${quote} via pivot: ${pivots}`);
    const { basequote: filename, quotebase: filenameReversed } = getMedianPricesFilenamesForPlatform(
      platform,
      base,
      quote
    );

    // get the last block already medianed
    let lastBlock = 0;
    const fileAlreadyExists = checkIfFileExists(filename); // fs.existsSync(filename);
    if (fileAlreadyExists) {
      const lastline = await readLastLine(filename);
      lastBlock = Number(lastline.split(',')[0]);
      if (isNaN(lastBlock)) {
        lastBlock = 0;
      }
    }

    const medianed = getMedianPriceAccordingToPlatform(this.workerName);

    if (medianed.length == 0) {
      console.log(`${this.workerName}[${platform}]: no new data to save for ${base}/${quote} via pivot: ${pivots}`);
      return;
    }

    const toWrite = [];
    const toWriteReversed = [];

    if (!checkIfFileExists(filename)) {
      fs.writeFileSync(filename, 'blocknumber,price\n');
      fs.writeFileSync(filenameReversed, 'blocknumber,price\n');
    }

    for (const medianedData of medianed) {
      toWrite.push(`${medianedData.block},${medianedData.price}\n`);
      toWriteReversed.push(`${medianedData.block},${1 / medianedData.price}\n`);
    }

    fs.appendFileSync(filename, toWrite.join(''));
    fs.appendFileSync(filenameReversed, toWriteReversed.join(''));
  }
}
