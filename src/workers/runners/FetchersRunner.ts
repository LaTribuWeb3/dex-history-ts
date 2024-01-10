import { SYNC_FILENAMES, UpdateSyncFile } from '../../utils/Sync';
import { sleep } from '../../utils/Utils';
import { BaseWorker } from '../BaseWorker';
import { UniswapV2Fetcher } from '../fetchers/uniswapv2/UniswapV2Fetcher';
import { UniswapV3Fetcher } from '../fetchers/uniswapv3/UniswapV3Fetcher';

const RUN_EVERY_MINUTES = 60;
const fetchersToLaunch: BaseWorker[] = [
  new UniswapV2Fetcher('uniswapv2 fetcher', RUN_EVERY_MINUTES),
  new UniswapV3Fetcher('uniswapv3 fetcher', RUN_EVERY_MINUTES)
];

async function FetchersRunner() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Date.now();
    try {
      UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, true);
      for (const fetcherToLaunch of fetchersToLaunch) {
        console.log(`Starting fetcher ${fetcherToLaunch.workerName}`);
        await fetcherToLaunch.run();
        console.log(`Ending fetcher ${fetcherToLaunch.workerName}`);
      }
      UpdateSyncFile(SYNC_FILENAMES.FETCHERS_LAUNCHER, false);
    } catch (error) {
      const errorMsg = `An exception occurred: ${error}`;
      console.log(errorMsg);
    }
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
