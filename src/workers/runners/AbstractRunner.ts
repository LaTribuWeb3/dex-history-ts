import { SYNC_FILENAMES, UpdateSyncFile, WaitUntilDone } from '../../utils/Sync';
import { sleep } from '../../utils/Utils';
import { EmptyConfiguration } from '../configuration/WorkerConfiguration';
import { RunWorkable } from './interfaces/RunWorkable';
import { Runnable } from './interfaces/Runnable';

export abstract class AbstractRunner implements Runnable {
  static RUN_EVERY_MINUTES = 60;

  name: string;
  workersToLaunch: RunWorkable[];
  mutex;
  shouldWait;
  loop;

  async init(): Promise<void> {
    console.log(`No init needed for ${this.name}`);
  }

  constructor(name: string, toLaunch: RunWorkable[], mutex = true, shouldWait = false, loop = false) {
    this.name = name;
    this.workersToLaunch = toLaunch;
    this.mutex = mutex;
    this.shouldWait = shouldWait;
    this.loop = loop;
  }

  async run() {
    // eslint-disable-next-line no-constant-condition
    do {
      const start = Date.now();
      await this.init();

      await this.runSpecific();

      if (this.shouldWait) {
        const runEndDate = Math.round(Date.now() / 1000);
        const durationSec = runEndDate - Math.round(start / 1000);

        const sleepTime = 1000 * 60 * AbstractRunner.RUN_EVERY_MINUTES - durationSec * 1000;
        if (sleepTime > 0) {
          console.log(`sleeping ${Math.round(sleepTime / 1000)} seconds`);
          await sleep(sleepTime);
        }
      }
    } while (this.loop);
  }

  async runSpecific() {
    if (this.mutex) await WaitUntilDone(SYNC_FILENAMES.FETCHERS_LAUNCHER);
    if (this.mutex) UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, true);

    for (const fetcherToLaunch of this.workersToLaunch) {
      console.log(`Starting worker ${fetcherToLaunch.workerName} (${fetcherToLaunch.monitoringName})`);
      await fetcherToLaunch.run();
    }

    if (this.mutex) UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, false);
  }
}
