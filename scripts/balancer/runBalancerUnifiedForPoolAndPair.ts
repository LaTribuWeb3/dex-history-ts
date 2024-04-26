import {
  BalancerPoolConfiguration,
  BalancerWorkerConfiguration,
  generateRawCSVFilePathForBalancerPool
} from '../../src/workers/configuration/WorkerConfiguration';
import fs from 'fs';
import { computeBalancerUnifiedDataForPair } from '../../src/workers/fetchers/balancer/BalancerUtils';
import { Configuration } from '../../src/config/Configuration';

// run with 'npx ts-node .\scripts\balancer\runBalancerUnifiedForPoolAndPair.ts Balancer-rETH-Stable-Pool rETH WETH'
// or launching 'runAllBalancerMultiThread'
// only to be used in debug mode
async function runBalancerUnifiedForPoolAndPair() {
  const poolName = process.argv[2];
  const base = process.argv[3];
  const quote = process.argv[4];

  const rawDataFilePath = generateRawCSVFilePathForBalancerPool('balancer', poolName);
  if (!fs.existsSync(rawDataFilePath)) {
    throw new Error(`Cannot find raw data history file: ${rawDataFilePath}`);
  }

  const cfg = await findPoolConfigByName(poolName);
  if (!cfg) {
    throw new Error(`find pool config for name ${poolName}`);
  }

  await computeBalancerUnifiedDataForPair(base, quote, cfg, rawDataFilePath);
}

runBalancerUnifiedForPoolAndPair();

async function findPoolConfigByName(poolName: string): Promise<BalancerPoolConfiguration | undefined> {
  const workers = await Configuration.getWorkersConfiguration();

  return (workers.workers.find((_) => _.name == 'balancer')?.configuration as BalancerWorkerConfiguration).pools?.find(
    (_) => _.name == poolName
  ) as BalancerPoolConfiguration;
}
