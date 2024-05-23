import { ComputersRunnerConfiguration } from '../configuration/WorkerConfiguration';
import { AdditionalLiquidityPrecomputer } from '../precomputer/AdditionalLiquidityPrecomputer';
import { MedianPrecomputer } from '../precomputer/MedianPrecomputer';
import { AbstractRunner } from './AbstractRunner';
import { RunWorkable } from './interfaces/RunWorkable';

export class ComputersRunner extends AbstractRunner implements RunWorkable {
  monitoringName = 'computers-runner';
  configuration = new ComputersRunnerConfiguration();
  workerName = 'computers-runner';

  constructor() {
    super(
      [
        new MedianPrecomputer(AbstractRunner.RUN_EVERY_MINUTES),
        new AdditionalLiquidityPrecomputer(AbstractRunner.RUN_EVERY_MINUTES)
      ],
      false,
      true
    );
  }
}
