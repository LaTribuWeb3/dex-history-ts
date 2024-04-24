import { BaseWorker } from '../BaseWorker';
import * as WorkerConfiguration from '../configuration/WorkerConfiguration';
import precomputers from '../../config/precomputers.json';
import { sleep } from '../../utils/Utils';

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
    super(
      MedianPrecomputer.findPrecomputerConfigurationByName('median'),
      'median',
      'Median Precomputer',
      runEveryMinute
    );
  }

  async runSpecific() {
    for (const platform of this.configuration.platforms) {
      console.log(platform);
    }
    await sleep(100);
  }
}
