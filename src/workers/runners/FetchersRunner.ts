import { BalancerFetcher } from '../fetchers/balancer/BalancerFetcher';
import { BalancerPriceFetcher } from '../fetchers/balancer/BalancerPriceFetcher';
import { CurveFetcher } from '../fetchers/curve/CurveFetcher';
import { CurvePriceFetcher } from '../fetchers/curve/CurvePriceFetcher';
import { SushiswapV2Fetcher } from '../fetchers/sushiswap/SushiswapV2Fetcher';
import { UniswapV2Fetcher } from '../fetchers/uniswapv2/UniswapV2Fetcher';
import { UniswapV3Fetcher } from '../fetchers/uniswapv3/UniswapV3Fetcher';
import { UniswapV3PriceFetcher } from '../fetchers/uniswapv3/UniswapV3PriceFetcher';
import { AbstractRunner } from './AbstractRunner';

class FetchersRunner extends AbstractRunner {
  constructor() {
    super([
      new UniswapV2Fetcher(AbstractRunner.RUN_EVERY_MINUTES),
      new SushiswapV2Fetcher(AbstractRunner.RUN_EVERY_MINUTES),
      new CurveFetcher(AbstractRunner.RUN_EVERY_MINUTES),
      new CurvePriceFetcher(AbstractRunner.RUN_EVERY_MINUTES),
      new UniswapV3Fetcher(AbstractRunner.RUN_EVERY_MINUTES),
      new UniswapV3PriceFetcher(AbstractRunner.RUN_EVERY_MINUTES),
      new BalancerFetcher(AbstractRunner.RUN_EVERY_MINUTES),
      new BalancerPriceFetcher(AbstractRunner.RUN_EVERY_MINUTES)
    ]);
  }
}

const fetchersRunner = new FetchersRunner();
fetchersRunner.run();
