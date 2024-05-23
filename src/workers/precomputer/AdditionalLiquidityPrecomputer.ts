import { MedianUtils } from '../../utils/MedianUtils';
import { SlippageMapUtils } from '../../utils/SlippageMapUtils';
import { BaseWorker } from '../BaseWorker';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
import * as fs from 'fs';
import { generatePreComputedForWorker, getAllPreComputed } from '../configuration/WorkerConfiguration';
import { Configuration } from '../../config/Configuration';

export class AdditionalLiquidityPrecomputer extends BaseWorker<WorkerConfiguration.AdditionalLiquidityPrecomputerConfiguration> {
  constructor(runEveryMinute: number) {
    super('additionalLiquidityProvider', 'Additional Liquidity Provider', runEveryMinute);
  }

  override async init() {
    const precomputers: WorkerConfiguration.PrecomputersConfiguration =
      await Configuration.getPrecomputersConfiguration();
    const precomputerConfiguration = precomputers.precomputers.find(
      (precomputer) => precomputer.name == this.workerName
    );
    if (precomputerConfiguration == undefined)
      throw 'Could not find configuration for precomputer additionalLiquidityProvider';
    this.configuration = precomputerConfiguration.configuration;
  }

  async runSpecific(): Promise<void> {
    // get config to know what tokens to transform
    for (const platformedAdditionalLiquidities of this.getConfiguration().platformedAdditionalLiquidities) {
      console.log(`working on ${platformedAdditionalLiquidities.platform}`);
      console.log(`${JSON.stringify(platformedAdditionalLiquidities)}`);

      for (const onePlatformConfig of platformedAdditionalLiquidities.additionalLiquidities) {
        const itemsToTransform = this.getFilesForPlatform(
          onePlatformConfig.from,
          onePlatformConfig.pivot,
          platformedAdditionalLiquidities.platform
        );
        console.log(
          `Working on ${itemsToTransform.length} files: ${itemsToTransform.map((_) => _.filename).join(',')}`
        );

        for (const itemToTransform of itemsToTransform) {
          await this.transformLiquidityDataForFilename(
            platformedAdditionalLiquidities.platform,
            onePlatformConfig,
            itemToTransform
          );
        }
      }
    }
  }

  getFilesForPlatform(from: string, to: string, platform: string) {
    const filenamesToTransform = [];
    const allPreComputedFiles = getAllPreComputed(platform);
    const filenames = allPreComputedFiles.map((compo) => compo.split('\\').pop());
    for (const filename of filenames) {
      if (filename == undefined) continue;
      const base = filename.split('-')[0];
      const quote = filename.split('-')[1];

      if (base == from && quote == to) {
        filenamesToTransform.push({ filename, reversed: false, base, quote });
      }

      if (base == to && quote == from) {
        filenamesToTransform.push({ filename, reversed: true, base, quote });
      }
    }

    return filenamesToTransform;
  }

  async transformLiquidityDataForFilename(
    platform: string,
    config: WorkerConfiguration.AdditionalLiquidity,
    itemToTransform: {
      filename: string;
      reversed: boolean;
      base: string;
      quote: string;
    }
  ) {
    console.log(`Working on ${platform} for file ${itemToTransform.filename}`);

    const csvLines = SlippageMapUtils.getDataFromCSVFile(
      generatePreComputedForWorker(platform) + '/' + itemToTransform.filename
    );
    const prices = MedianUtils.readMedianPricesFile(config.priceSource, config.priceFrom, config.priceTo);

    const reverse = config.from == itemToTransform.quote;
    // stETH-WETH-stETHngPool-unified-data.csv
    const targetFileName = itemToTransform.filename.replace(config.from, config.to);
    const linesToWrite = [];
    linesToWrite.push('blocknumber,price,slippagemap\n');

    for (let i = 0; i < csvLines.length - 1; i++) {
      const lineToTransform = csvLines[i];
      const unifiedData = SlippageMapUtils.extractDataFromUnifiedLine(lineToTransform);
      const closestPrice = MedianUtils.getClosestPrice(prices, unifiedData.blockNumber);
      if (!closestPrice) {
        continue;
      }

      const targetUnifiedData = structuredClone(unifiedData);
      targetUnifiedData.price = reverse ? unifiedData.price / closestPrice : unifiedData.price * closestPrice;
      for (const slippageBps of Object.keys(targetUnifiedData.slippageMap)) {
        if (reverse) {
          targetUnifiedData.slippageMap[slippageBps].quote /= closestPrice;
        } else {
          targetUnifiedData.slippageMap[slippageBps].base /= closestPrice;
        }
      }

      const lineToWrite = `${targetUnifiedData.blockNumber},${targetUnifiedData.price},${JSON.stringify(
        targetUnifiedData.slippageMap
      )}\n`;
      linesToWrite.push(lineToWrite);
    }

    if (linesToWrite.length >= 0) {
      const fullFileName = generatePreComputedForWorker(platform) + '/' + targetFileName;
      fs.writeFileSync(fullFileName, linesToWrite.join(''));
    }
  }
}
