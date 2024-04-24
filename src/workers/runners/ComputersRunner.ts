import { MedianPrecomputer } from '../precomputer/MedianPrecomputer';
import { AbstractRunner } from './AbstractRunner';

class ComputersRunner extends AbstractRunner {
  constructor() {
    super([new MedianPrecomputer(AbstractRunner.RUN_EVERY_MINUTES)]);
  }
}

const fetchersRunner = new ComputersRunner();
fetchersRunner.run();
