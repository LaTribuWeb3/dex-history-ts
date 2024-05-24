import { AbstractRunner } from './AbstractRunner';
import { ComputersRunner } from './ComputersRunner';
import { FetchersRunner } from './FetchersRunner';

export class MetaRunner extends AbstractRunner {
  constructor() {
    const mutex = false;
    const shouldWait = true;
    const shouldLoop = true;
    super('Meta-Runner', [new FetchersRunner(), new ComputersRunner()], mutex, shouldWait, shouldLoop);
  }
}

const metaRunner = new MetaRunner();
metaRunner.run();
