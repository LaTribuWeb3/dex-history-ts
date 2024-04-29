import { SYNC_FILENAMES, UpdateSyncFile, WaitUntilDone } from '../../utils/Sync';
import { sleep } from '../../utils/Utils';
import { BaseWorker } from '../BaseWorker';
import { EmptyConfiguration, WorkerConfiguration } from '../configuration/WorkerConfiguration';

export class AbstractRunner {
  static RUN_EVERY_MINUTES = 60;

  workersToLaunch: BaseWorker<WorkerConfiguration>[];

  constructor(toLaunch: BaseWorker<WorkerConfiguration>[]) {
    this.workersToLaunch = toLaunch;
  }

  async run() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const start = Date.now();

      this.runOnce();

      const runEndDate = Math.round(Date.now() / 1000);
      const durationSec = runEndDate - Math.round(start / 1000);

      const sleepTime = 1000 * 60 * AbstractRunner.RUN_EVERY_MINUTES - durationSec * 1000;
      if (sleepTime > 0) {
        console.log(`sleeping ${Math.round(sleepTime / 1000)} seconds`);
        await sleep(sleepTime);
      }
    }
  }

  async runOnce() {
    await Promise.all(this.workersToLaunch.map((fetcher) => fetcher.init()));
    await WaitUntilDone(SYNC_FILENAMES.FETCHERS_LAUNCHER);
    UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, true);
    for (const fetcherToLaunch of this.workersToLaunch) {
      if (!(fetcherToLaunch.configuration instanceof EmptyConfiguration)) {
        console.log(`Starting worker ${fetcherToLaunch.workerName} (${fetcherToLaunch.monitoringName})`);
        for (let i = 0; i < 10; i++) {
          try {
            await fetcherToLaunch.run();
            break;
          } catch (error) {
            const errorMsg = `An exception occurred: ${error}`;
            await sleep(5000);
            console.log(errorMsg);
          }
        }
        console.log(`Ending fetcher ${fetcherToLaunch.workerName}`);
      }
    }
    UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, false);
  }
}
