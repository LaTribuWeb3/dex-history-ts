import axios from 'axios';
import retry from './Utils';

const uri = process.env.MONITORING_API_URI;
const monitoringEnabled = process.env.MONITORING && process.env.MONITORING == 'true';

export interface MonitoringData {
  type: string; // bad debt, liquidity alert, other...
  name: string; // "BSC Apeswap Runner"
  status: MonitoringStatusEnum;
  lastStart?: number;
  lastEnd?: number;
  lastDuration?: number;
  lastBlockFetched?: number;
  error?: string;
  lastUpdate?: number;
  runEvery?: number; // in seconds
}

export enum MonitoringStatusEnum {
  SUCCESS = 'success',
  ERROR = 'error',
  RUNNING = 'running',
  STALE = 'stale'
}

export async function RecordMonitoring(monitoringData: MonitoringData) {
  if (!monitoringEnabled) {
    return;
  }

  if (!uri) {
    console.error('Could not find env variable MONITORING_API_URI');
    return;
  }

  try {
    console.log(`RecordMonitoring: sending new monitoring: ${JSON.stringify(monitoringData)}`);
    monitoringData['lastUpdate'] = Math.round(Date.now() / 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp: any = await retry(axios.post, [uri, monitoringData]);
    console.log(`RecordMonitoring: api response: ${JSON.stringify(resp.data)}`);
  } catch (e) {
    console.error('error when sending monitoring data', e);
  }
}

/**
 * Logs the duration of a function
 * @param {number} dtStart unix timestamp ms
 * @param {number} jobCount the number of job done, to be displayed as nbjob/sec if set
 * @param {number} jobName the name for the jobs done
 */
export function logFnDuration(
  callerName: string,
  dtStart: number,
  jobCount: number | undefined = undefined,
  jobName = 'job'
) {
  if (!process.env.DEBUG_DURATION) return;
  const secDuration = (Date.now() - dtStart) / 1000;
  if (jobCount) {
    console.log(`${callerName} duration: ${roundTo(secDuration, 6)} s. ${jobCount / secDuration} ${jobName}/sec`);
  } else {
    console.log(`${callerName} duration: ${roundTo(secDuration, 6)} s`);
  }
}

function roundTo(num: number, dec = 2) {
  const pow = Math.pow(10, dec);
  return Math.round((num + Number.EPSILON) * pow) / pow;
}
