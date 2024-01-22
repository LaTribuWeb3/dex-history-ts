import * as fs from 'fs';
import * as path from 'path';
import * as Constants from './Constants';
import { sleep, writeContentToFile } from './Utils';

interface SyncFilenames {
  FETCHERS_LAUNCHER: string;
}

const SYNC_FILENAMES: SyncFilenames = {
  FETCHERS_LAUNCHER: 'fetchers-launcher'
};

// Methods used to sync processes using filenames
function UpdateSyncFile(syncFilename: string, isWorking: boolean): void {
  const content = JSON.stringify({ status: isWorking ? 'working' : 'done' });

  console.log(`SYNC: setting ${syncFilename} working to ${isWorking}`);

  const fullFilename = path.join(Constants.DATA_DIR, syncFilename);

  writeContentToFile(fullFilename, content);
}

function CheckSyncFileStatus(syncFilename: string): string {
  const fullFilename = path.join(Constants.DATA_DIR, syncFilename);
  const syncData = JSON.parse(fs.readFileSync(fullFilename, { encoding: 'utf-8' }));
  console.log(`SYNC: CheckSyncFile ${syncFilename} = ${syncData.status}`);
  return syncData.status;
}

async function WaitUntilDone(syncFilename: string): Promise<void> {
  let status = CheckSyncFileStatus(syncFilename);

  while (status !== 'done') {
    console.log(`Waiting for ${syncFilename} to be done`);
    await sleep(5000);
    status = CheckSyncFileStatus(syncFilename);
  }
}

export { SYNC_FILENAMES, UpdateSyncFile, WaitUntilDone, writeContentToFile };
