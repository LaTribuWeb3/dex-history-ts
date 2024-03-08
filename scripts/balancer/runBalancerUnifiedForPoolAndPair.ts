import {
  BalancerPoolConfiguration,
  generateRawCSVFilePathForBalancerPool
} from '../../src/workers/configuration/WorkerConfiguration';
import fs from 'fs';
import workers from '../../src/config/workers.json';
import { computeBalancerUnifiedDataForPair } from '../../src/workers/fetchers/balancer/BalancerUtils';

async function runBalancerUnifiedForPoolAndPair() {
  const poolName = process.argv[2];
  const base = process.argv[3];
  const quote = process.argv[4];

  const rawDataFilePath = generateRawCSVFilePathForBalancerPool('balancer', poolName);
  if (!fs.existsSync(rawDataFilePath)) {
    throw new Error(`Cannot find raw data history file: ${rawDataFilePath}`);
  }

  const cfg = findPoolConfigByName(poolName);
  if (!cfg) {
    throw new Error(`find pool config for name ${poolName}`);
  }

  await computeBalancerUnifiedDataForPair(base, quote, cfg, rawDataFilePath);
}

runBalancerUnifiedForPoolAndPair();

function findPoolConfigByName(poolName: string): BalancerPoolConfiguration | undefined {
  return workers.workers
    .find((_) => _.name == 'balancer')
    ?.configuration.pools?.find((_) => _.name == poolName) as BalancerPoolConfiguration;
}
