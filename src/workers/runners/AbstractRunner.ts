import { SYNC_FILENAMES, UpdateSyncFile, WaitUntilDone } from '../../utils/Sync';
import { sleep } from '../../utils/Utils';
import { EmptyConfiguration } from '../configuration/WorkerConfiguration';
import { RunWorkable } from './interfaces/RunWorkable';
import { Runnable } from './interfaces/Runnable';

export abstract class AbstractRunner implements Runnable {
  static RUN_EVERY_MINUTES = 60;

  workersToLaunch: RunWorkable[];
  mutex;
  shouldWait;

  async init(): Promise<void> {
    for (const fetcherToLaunch of this.workersToLaunch) {
      try {
        await fetcherToLaunch.init();
      } catch (e) {
        console.warn('Could not load configuration for worker ' + fetcherToLaunch.monitoringName + '. Skipping it.');
        continue;
      }
      if (fetcherToLaunch.configuration instanceof EmptyConfiguration) {
        console.warn('Configuration for worker ' + fetcherToLaunch.monitoringName + ' is empty. Skipping it.');
        continue;
      }
    }
  }

  constructor(toLaunch: RunWorkable[], mutex = true, shouldWait = false) {
    this.workersToLaunch = toLaunch;
    this.mutex = mutex;
    this.shouldWait = shouldWait;
  }

  async run() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const start = Date.now();

      await this.runOnce();

      if (this.shouldWait) {
        const runEndDate = Math.round(Date.now() / 1000);
        const durationSec = runEndDate - Math.round(start / 1000);

        const sleepTime = 1000 * 60 * AbstractRunner.RUN_EVERY_MINUTES - durationSec * 1000;
        if (sleepTime > 0) {
          console.log(`sleeping ${Math.round(sleepTime / 1000)} seconds`);
          await sleep(sleepTime);
        }
      }
    }
  }

  async runOnce() {
    if (this.mutex) await WaitUntilDone(SYNC_FILENAMES.FETCHERS_LAUNCHER);

    await this.init();

    if (this.mutex) UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, true);

    for (const fetcherToLaunch of this.workersToLaunch) {
      console.log(`Starting worker ${fetcherToLaunch.workerName} (${fetcherToLaunch.monitoringName})`);
      await this.runOneWorker(fetcherToLaunch);
    }

    if (this.mutex) UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, false);
  }

  async runOneWorker(fetcherToLaunch: RunWorkable) {
    for (let i = 0; i < 10; i++) {
      try {
        await fetcherToLaunch.runOnce();
        break;
      } catch (error) {
        const errorMsg = `An exception occurred: ${error}`;
        await sleep(5000);
        console.log(errorMsg);
      }
      console.log(`Ending fetcher ${fetcherToLaunch.workerName}`);
    }
  }
}
