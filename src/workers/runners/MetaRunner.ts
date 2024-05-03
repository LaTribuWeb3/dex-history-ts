import { AbstractRunner } from './AbstractRunner';
import { ComputersRunner } from './ComputersRunner';
import { FetchersRunner } from './FetchersRunner';

export class MetaRunner extends AbstractRunner {
  constructor() {
    super([new FetchersRunner(), new ComputersRunner()], false, true);
  }
}

const metaRunner = new MetaRunner();
metaRunner.run();
