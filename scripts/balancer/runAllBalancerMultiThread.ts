import { exec } from 'child_process';
import { BalancerWorkerConfiguration } from '../../src/workers/configuration/WorkerConfiguration';
import { sleep } from '../../src/utils/Utils';
import { Configuration } from '../../src/config/Configuration';

// run with 'npx ts-node .\scripts\balancer\runAllBalancerMultiThread.ts'
// only to be used in debug mode
async function runAllBalancerMultiThread() {
  const workers = await Configuration.getWorkersConfiguration();
  const balancerConf = workers.workers.find((_) => _.name == 'balancer')?.configuration as BalancerWorkerConfiguration;
  const allChilds = [];

  for (const balancerPoolConfig of balancerConf.pools) {
    for (const base of balancerPoolConfig.tokenSymbols) {
      for (const quote of balancerPoolConfig.tokenSymbols) {
        if (base == quote) {
          continue;
        }

        const cmd = `npx ts-node ./scripts/balancer/runBalancerUnifiedForPoolAndPair.ts ${balancerPoolConfig.name} ${base} ${quote}`;
        console.log(`Starting ${cmd}`);
        const childProcess = exec(cmd);
        allChilds.push(childProcess);
        await sleep(500);
      }
    }
  }

  await sleep(5000);
  let mustWait = allChilds.filter((_) => _.exitCode == null).length > 0;
  while (mustWait) {
    await sleep(10000);
    const subProcessStillRunningCount = allChilds.filter((_) => _.exitCode == null).length;
    console.log(
      `runAllBalancerMultiThread: Waiting for all subProcess to end. ${subProcessStillRunningCount}/${allChilds.length} still running`
    );
    mustWait = subProcessStillRunningCount > 0;
  }
}

runAllBalancerMultiThread();
