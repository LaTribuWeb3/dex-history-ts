import { ComputersRunner } from './ComputersRunner';
import { FetchersRunner } from './FetchersRunner';

export class MetaRunner {
  static run() {
    const fetchersRunner = new FetchersRunner();
    fetchersRunner.run();

    const computerRunner = new ComputersRunner();
    computerRunner.run();
  }
}

MetaRunner.run();
