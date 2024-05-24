import { SYNC_FILENAMES, UpdateSyncFile, WaitUntilDone } from '../utils/Sync';
import { sleep } from '../utils/Utils';
import { RunWorkable } from './interfaces/RunWorkable';
import { Runnable } from './interfaces/Runnable';
import { duration } from 'duration-pretty';

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
    do {
      const start = Date.now();
      await this.init();

      await this.runSpecific();

      const runEndDate = Math.round(Date.now() / 1000);
      const durationSec = runEndDate - Math.round(start / 1000);

      console.log(`[${this.name}] | run duration: ${duration(durationSec, 'seconds').format('HH[h]mm[m]ss[s]')}`);

      if (this.shouldWait) {
        const sleepTime = 1000 * 60 * AbstractRunner.RUN_EVERY_MINUTES - durationSec * 1000;
        if (sleepTime > 0) {
          console.log(
            `[${this.name}] | sleeping ${duration(Math.round(sleepTime / 1000), 'seconds').format('HH[h]mm[m]ss[s]')}`
          );
          await sleep(sleepTime);
        }
      }
    } while (this.loop);
  }

  async runSpecific() {
    if (this.mutex) await WaitUntilDone(SYNC_FILENAMES.FETCHERS_LAUNCHER);
    if (this.mutex) UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, true);

    try {
      for (const fetcherToLaunch of this.workersToLaunch) {
        console.log(
          `[${this.name}] | Starting worker ${fetcherToLaunch.workerName} (${fetcherToLaunch.monitoringName})`
        );
        await fetcherToLaunch.run();
      }
    } finally {
      if (this.mutex) UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, false);
    }
  }
}
