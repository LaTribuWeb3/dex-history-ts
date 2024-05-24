import { BalancerFetcher } from '../../workers/fetchers/balancer/BalancerFetcher';
import { BalancerPriceFetcher } from '../../workers/fetchers/balancer/BalancerPriceFetcher';
import { CurveFetcher } from '../../workers/fetchers/curve/CurveFetcher';
import { CurvePriceFetcher } from '../../workers/fetchers/curve/CurvePriceFetcher';
import { SushiswapV2Fetcher } from '../../workers/fetchers/sushiswap/SushiswapV2Fetcher';
import { UniswapV2Fetcher } from '../../workers/fetchers/uniswapv2/UniswapV2Fetcher';
import { UniswapV3Fetcher } from '../../workers/fetchers/uniswapv3/UniswapV3Fetcher';
import { UniswapV3PriceFetcher } from '../../workers/fetchers/uniswapv3/UniswapV3PriceFetcher';
import { AdditionalLiquidityPrecomputer } from '../../workers/precomputer/AdditionalLiquidityPrecomputer';
import { MedianPrecomputer } from '../../workers/precomputer/MedianPrecomputer';
import { AbstractRunner } from '../AbstractRunner';

export class BscDataFetch extends AbstractRunner {
  constructor() {
    const mutex = true;
    const shouldWait = true;
    const shouldLoop = true;
    const configVersion = 'bsc';
    super(
      'EthereumDataFetch-Runner',
      [
        new CurveFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion),
        new CurvePriceFetcher(AbstractRunner.RUN_EVERY_MINUTES, configVersion)
      ],
      mutex,
      shouldWait,
      shouldLoop
    );
  }
}
