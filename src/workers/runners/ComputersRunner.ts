import { AdditionalLiquidityPrecomputer } from '../precomputer/AdditionalLiquidityPrecomputer';
import { MedianPrecomputer } from '../precomputer/MedianPrecomputer';
import { AbstractRunner } from './AbstractRunner';

class ComputersRunner extends AbstractRunner {
  constructor() {
    super([new AdditionalLiquidityPrecomputer(AbstractRunner.RUN_EVERY_MINUTES)]);
  }
}

const fetchersRunner = new ComputersRunner();
fetchersRunner.run();
