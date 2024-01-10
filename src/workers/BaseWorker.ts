import { DATA_DIR } from '../utils/Constants';
import { MonitoringData, MonitoringStatusEnum, RecordMonitoring } from '../utils/MonitoringHelper';
import * as fs from 'fs';
/**
 * This is the base worker class
 * It is used to log monitoring
 */
export abstract class BaseWorker {
  workerName: string;
  runEveryMinutes: number;
  constructor(workerName: string, runEveryMinutes: number) {
    this.workerName = workerName;
    this.runEveryMinutes = runEveryMinutes;
    console.log(`worker name: ${this.workerName}`);
  }

  async run() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR);
      }

      const start = Date.now();
      await this.SendMonitoringData(MonitoringStatusEnum.RUNNING, Math.round(start / 1000));

      console.log(`${this.workerName}: starting run specific`);
      await this.runSpecific();
      console.log(`${this.workerName}: ending run specific`);

      const runEndDate = Math.round(Date.now() / 1000);
      const durationSec = runEndDate - Math.round(start / 1000);
      await this.SendMonitoringData(MonitoringStatusEnum.SUCCESS, undefined, runEndDate, durationSec, undefined);
    } catch (err) {
      console.error(`${this.workerName}: An exception occurred: ${err}`);
      console.error(err);
      await this.SendMonitoringData(
        MonitoringStatusEnum.ERROR,
        undefined,
        undefined,
        undefined,
        `An exception occurred: ${err}`
      );
    }
  }

  abstract runSpecific(): Promise<void>;

  // this method can be overwritten for test purpose
  async SendMonitoringData(
    status: MonitoringStatusEnum,
    start?: number,
    end?: number,
    duration?: number,
    error?: string
  ) {
    const m: MonitoringData = {
      name: this.workerName,
      type: 'Dex History',
      status: status,
      runEvery: this.runEveryMinutes * 60
    };

    if (start) {
      m.lastStart = start;
    }

    if (end) {
      m.lastEnd = end;
    }

    if (duration) {
      m.lastDuration = duration;
    }

    if (error) {
      m.error = error;
    }

    await RecordMonitoring(m);
  }
}
