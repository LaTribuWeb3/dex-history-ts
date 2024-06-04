import { AgniFinanceFetcher } from '../../workers/fetchers/agni/AgniFinanceFetcher';
import { AgniFinancePriceFetcher } from '../../workers/fetchers/agni/AgniFinancePriceFetcher';
import { ButterFetcher } from '../../workers/fetchers/butter/butterFetcher';
import { FusionXFinanceFetcher } from '../../workers/fetchers/fusionx/FusionXFinanceFetcher';
import { MedianPrecomputer } from '../../workers/precomputer/MedianPrecomputer';
import { AbstractRunner } from '../AbstractRunner';

export class MantleDataFetch extends AbstractRunner {
  constructor() {
    const mutex = true;
    const shouldWait = true;
    const shouldLoop = true;
    const configVersion = 'mantle';
    super(
      'MantleDataFetch-Runner',
      [
        new AgniFinanceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new AgniFinancePriceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        // new FusionXFinanceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new ButterFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion)
        // new MedianPrecomputer(AbstractRunner.RUN_EVERY_MINUTES, configVersion)
      ],
      mutex,
      shouldWait,
      shouldLoop
    );
  }
}
