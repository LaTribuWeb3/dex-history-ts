import * as fs from 'fs';
import * as path from 'path';
import * as Constants from './Constants';
import { sleep, writeContentToFile } from './Utils';

import * as dotenv from 'dotenv';
dotenv.config();

let externalLockFile = process.env.EXTERNAL_LOCK_FILE;

if (!externalLockFile) {
  externalLockFile = path.join(process.cwd(), 'data', 'fetchers-launcher');
}

interface SyncFilenames {
  FETCHERS_LAUNCHER: string;
}

const SYNC_FILENAMES: SyncFilenames = {
  FETCHERS_LAUNCHER: externalLockFile
};

// Methods used to sync processes using filenames
function UpdateSyncFile(syncFilename: string, isWorking: boolean): void {
  const content = JSON.stringify({ status: isWorking ? 'working' : 'done' });

  console.log(`SYNC: setting ${syncFilename} working to ${isWorking}`);

  if (path.isAbsolute(syncFilename)) {
    writeContentToFile(syncFilename, content);
  } else {
    writeContentToFile(path.join(Constants.DATA_DIR, syncFilename), content);
  }
}

function CheckSyncFileStatusInData(syncFilename: string): string | undefined {
  if (path.isAbsolute(syncFilename)) {
    return CheckSyncFileStatus(syncFilename);
  } else {
    return CheckSyncFileStatus(path.join(Constants.DATA_DIR, syncFilename));
  }
}

function CheckSyncFileStatus(syncFilename: string): string | undefined {
  try {
    if (!fs.existsSync(syncFilename)) {
      return 'done';
    }

    const syncData = JSON.parse(fs.readFileSync(syncFilename, { encoding: 'utf-8' }));
    console.log(`SYNC: CheckSyncFile ${syncFilename} = ${syncData.status}`);
    if ('status' in syncData) return syncData.status;
    else return undefined;
  } catch (e) {
    console.log('Parsing of status file failed with ' + e);
    return undefined;
  }
}

async function WaitUntilDone(syncFilename: string): Promise<void> {
  let status = CheckSyncFileStatusInData(syncFilename);

  while (status !== 'done') {
    console.log(`Waiting for ${syncFilename} to be done`);
    await sleep(5000);
    status = CheckSyncFileStatusInData(syncFilename);
  }
}

async function WaitForStatusInFileBeforeContinuing(file: string, expectedStatus: string, closure: () => any) {
  const watcher = fs.watch(file, () => {
    if (CheckSyncFileStatus(file) == expectedStatus) {
      watcher.close();
      closure();
    }
  });

  if (CheckSyncFileStatus(file) == expectedStatus) {
    watcher.close();
    closure();
  }
}

export { SYNC_FILENAMES, UpdateSyncFile, WaitUntilDone, writeContentToFile, WaitForStatusInFileBeforeContinuing };
