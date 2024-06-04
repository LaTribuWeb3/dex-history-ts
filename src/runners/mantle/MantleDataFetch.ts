import { AgniFinanceFetcher } from '../../workers/fetchers/agni/AgniFinanceFetcher';
import { BalancerFetcher } from '../../workers/fetchers/balancer/BalancerFetcher';
import { BalancerPriceFetcher } from '../../workers/fetchers/balancer/BalancerPriceFetcher';
import { UniswapV3Fetcher } from '../../workers/fetchers/uniswapv3/UniswapV3Fetcher';
import { UniswapV3PriceFetcher } from '../../workers/fetchers/uniswapv3/UniswapV3PriceFetcher';
import { AdditionalLiquidityPrecomputer } from '../../workers/precomputer/AdditionalLiquidityPrecomputer';
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
      [new AgniFinanceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion)],
      mutex,
      shouldWait,
      shouldLoop
    );
  }
}
