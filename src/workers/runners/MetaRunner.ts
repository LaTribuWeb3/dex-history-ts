import { sleep } from '../../utils/Utils';
import { AbstractRunner } from './AbstractRunner';
import { ComputersRunner } from './ComputersRunner';
import { FetchersRunner } from './FetchersRunner';

export class MetaRunner {
  static async run() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const start = Date.now();

      await MetaRunner.runOnce();

      const runEndDate = Math.round(Date.now() / 1000);
      const durationSec = runEndDate - Math.round(start / 1000);

      const sleepTime = 1000 * 60 * AbstractRunner.RUN_EVERY_MINUTES - durationSec * 1000;
      if (sleepTime > 0) {
        console.log(`sleeping ${Math.round(sleepTime / 1000)} seconds`);
        await sleep(sleepTime);
      }
    }
  }

  static async runOnce() {
    for (let i = 0; i < 10; i++) {
      try {
        const fetchersRunner = new FetchersRunner();
        await fetchersRunner.runOnce();

        const computerRunner = new ComputersRunner();
        await computerRunner.runOnce();
        break;
      } catch (error) {
        const errorMsg = `An exception occurred: ${error}`;
        await sleep(5000);
        console.log(errorMsg);
      }
    }
  }
}

MetaRunner.run();
