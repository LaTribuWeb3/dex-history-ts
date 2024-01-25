import { SYNC_FILENAMES, UpdateSyncFile, WaitForStatusInFileBeforeContinuing } from '../../utils/Sync';
import { sleep } from '../../utils/Utils';
import { BaseWorker } from '../BaseWorker';
import { WorkerConfiguration } from '../configuration/WorkerConfiguration';
import { UniswapV2Fetcher } from '../fetchers/uniswapv2/UniswapV2Fetcher';
import Config from '../../../config/config.json';

const RUN_EVERY_MINUTES = 60;
const fetchersToLaunch: BaseWorker<WorkerConfiguration>[] = [new UniswapV2Fetcher(RUN_EVERY_MINUTES)];

async function FetchersRunner() {
  WaitForStatusInFileBeforeContinuing(Config.externalLockFile, 'done', startMainLoop);
}

async function startMainLoop() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, true);
    for (const fetcherToLaunch of fetchersToLaunch) {
      console.log(`Starting fetcher ${fetcherToLaunch.workerName}`);
      for (let i = 0; i < 10; i++) {
        try {
          await fetcherToLaunch.run();
          break;
        } catch (error) {
          const errorMsg = `An exception occurred: ${error}`;
          console.log(errorMsg);
        }
      }
      console.log(`Ending fetcher ${fetcherToLaunch.workerName}`);
    }
    UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, false);

    const runEndDate = Math.round(Date.now() / 1000);
    const durationSec = runEndDate - Math.round(start / 1000);

    const sleepTime = 1000 * 60 * RUN_EVERY_MINUTES - durationSec * 1000;
    if (sleepTime > 0) {
      console.log(`sleeping ${Math.round(sleepTime / 1000)} seconds`);
      await sleep(sleepTime);
    }
  }
}

FetchersRunner();
