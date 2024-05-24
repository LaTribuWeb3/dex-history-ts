import { WorkerConfiguration } from '../../workers/configuration/WorkerConfiguration';

export interface Workable {
  monitoringName: string;
  configuration: WorkerConfiguration;
  workerName: string;
}
