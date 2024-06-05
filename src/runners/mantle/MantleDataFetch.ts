import { AgniFinanceFetcher } from '../../workers/fetchers/agni/AgniFinanceFetcher';
import { AgniFinancePriceFetcher } from '../../workers/fetchers/agni/AgniFinancePriceFetcher';
import { ButterPriceFetcher } from '../../workers/fetchers/butter/ButterPriceFetcher';
import { ButterFetcher } from '../../workers/fetchers/butter/butterFetcher';
import { FusionXFinanceFetcher } from '../../workers/fetchers/fusionx/FusionXFinanceFetcher';
import { FusionXFinancePriceFetcher } from '../../workers/fetchers/fusionx/FusionXFinancePriceFetcher';
import { MerchantMoeClassicFetcher } from '../../workers/fetchers/merchantmoe/MerchantMoeClassicFetcher';
import { MedianPrecomputer } from '../../workers/precomputer/MedianPrecomputer';
import { AbstractRunner } from '../AbstractRunner';

export class MantleDataFetch extends AbstractRunner {
  constructor() {
    const mutex = false;
    const shouldWait = true;
    const shouldLoop = true;
    const configVersion = 'mantle';
    super(
      'MantleDataFetch-Runner',
      [
        // LIQUIDITY FETCHERS
        new AgniFinanceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new ButterFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new FusionXFinanceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new MerchantMoeClassicFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        // PRICE FETCHERS
        new AgniFinancePriceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new ButterPriceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new FusionXFinancePriceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        // MEDIAN COMPUTER
        new MedianPrecomputer(AbstractRunner.RUN_EVERY_MINUTES, configVersion)
      ],
      mutex,
      shouldWait,
      shouldLoop
    );
  }
}
