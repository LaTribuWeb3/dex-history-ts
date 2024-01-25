import { SYNC_FILENAMES, UpdateSyncFile } from '../../utils/Sync';
import { sleep } from '../../utils/Utils';
import { BaseWorker } from '../BaseWorker';
import { WorkerConfiguration } from '../configuration/WorkerConfiguration';
import { UniswapV2Fetcher } from '../fetchers/uniswapv2/UniswapV2Fetcher';
import * as fs from 'fs';

const RUN_EVERY_MINUTES = 60;
const fetchersToLaunch: BaseWorker<WorkerConfiguration>[] = [new UniswapV2Fetcher(RUN_EVERY_MINUTES)];

function ReturnStatus(watched_file: string) {
  const contentOfFile = fs.readFileSync('data/' + watched_file, 'utf-8');
  if (contentOfFile.length == 0) return undefined;
  try {
    const parsed = JSON.parse(contentOfFile);
    if ('status' in parsed) return parsed.status;
    else return undefined;
  } catch (e) {
    console.log('Parsing of status file failed with ' + e);
    return undefined;
  }
}

async function FetchersRunner() {
  if (ReturnStatus(SYNC_FILENAMES.FETCHERS_LAUNCHER) == 'done') startMainLoop();

  fs.watch('data/' + SYNC_FILENAMES.FETCHERS_LAUNCHER, (_) => {
    if (ReturnStatus(SYNC_FILENAMES.FETCHERS_LAUNCHER) == 'done') startMainLoop();
  });
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
