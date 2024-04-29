import { ComputersRunner } from './ComputersRunner';
import { FetchersRunner } from './FetchersRunner';

export class MetaRunner {
  static async run() {
    const fetchersRunner = new FetchersRunner();
    await fetchersRunner.runOnce();

    const computerRunner = new ComputersRunner();
    await computerRunner.runOnce();
  }
}

MetaRunner.run();
