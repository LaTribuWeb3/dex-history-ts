import { MonitoringStatusEnum, MonitoringData, RecordMonitoring } from '../utils/MonitoringHelper';
import * as WorkerConfiguration from './configuration/WorkerConfiguration';

export abstract class BaseWorker<T extends WorkerConfiguration.WorkerConfiguration> {
  configuration: T;
  workerName: string;
  monitoringName: string;
  runEveryMinutes: number;

  constructor(config: T, workerName: string, monitoringName: string, runEveryMinutes: number) {
    this.configuration = config;
    this.workerName = workerName;
    this.monitoringName = monitoringName;
    this.runEveryMinutes = runEveryMinutes;
  }

  /**
   * Asynchronous method representing the main execution logic for a worker task.
   *
   * This method performs the following steps:
   * 1. Checks if the worker's data folder exists in the Constants.DATA_DIR and creates it if not.
   * 2. Sends monitoring data indicating that the worker is in the "RUNNING" state.
   * 3. Logs the start of the specific worker run.
   * 4. Invokes the `runSpecific` method, which contains the worker's specific logic.
   * 5. Logs the completion of the specific worker run.
   * 6. Calculates the duration of the worker run.
   * 7. Sends monitoring data indicating a "SUCCESS" status with run details.
   *
   * If an exception occurs during execution, it is caught and handled as follows:
   * 1. Error details are logged.
   * 2. Monitoring data is sent indicating an "ERROR" status with error details.
   *
   * @throws {Error} If an exception occurs during execution, it is thrown.
   */
  async run(): Promise<void> {
    try {
      // Step 2: Send monitoring data indicating "RUNNING" state
      const start = Date.now();
      await this.SendMonitoringData(MonitoringStatusEnum.RUNNING, Math.round(start / 1000));

      // Step 3: Log the start of the specific worker run
      console.log(`${this.workerName}: starting run specific`);

      // Step 4: Execute the worker's specific logic
      await this.runSpecific();

      // Step 5: Log the completion of the specific worker run
      console.log(`${this.workerName}: ending run specific`);

      // Step 6: Calculate duration and send monitoring data for "SUCCESS" status
      const runEndDate = Math.round(Date.now() / 1000);
      const durationSec = runEndDate - Math.round(start / 1000);
      await this.SendMonitoringData(MonitoringStatusEnum.SUCCESS, undefined, runEndDate, durationSec, undefined);
    } catch (err) {
      // Step 7: Handle exceptions by logging and sending monitoring data for "ERROR" status
      console.error(`${this.workerName}: An exception occurred: ${err}`);
      console.error(err);
      await this.SendMonitoringData(
        MonitoringStatusEnum.ERROR,
        undefined,
        undefined,
        undefined,
        `An exception occurred: ${err}`
      );

      // Re-throw the exception to notify the caller of the error
      throw err;
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
      name: this.monitoringName,
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

  logFnDuration(functionName: string, dtStart: number, jobCount: number, jobName: string) {
    if (!process.env.DEBUG_DURATION) return;
    const secDuration = (Date.now() - dtStart) / 1000;
    if (jobCount) {
      console.log(
        `${functionName} duration: ${this.roundTo(secDuration, 6)} s. ${jobCount / secDuration} ${jobName}/sec`
      );
    } else {
      console.log(`${functionName} duration: ${this.roundTo(secDuration, 6)} s`);
    }
  }

  roundTo(num: number, dec = 2) {
    const pow = Math.pow(10, dec);
    return Math.round((num + Number.EPSILON) * pow) / pow;
  }
}
