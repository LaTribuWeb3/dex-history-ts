import { WorkerConfiguration } from '../../configuration/WorkerConfiguration';

export interface Workable {
  monitoringName: string;
  configuration: WorkerConfiguration;
  workerName: string;
}
