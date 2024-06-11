import { TokenList } from '../../configuration/TokenData';
import * as Web3Utils from '../../../utils/Web3Utils';
import { MerchantMoeFactory__factory } from '../../../contracts/types';
import * as ethers from 'ethers';
import { MerchantMoeV2WorkerConfiguration } from '../../configuration/WorkerConfiguration';

export async function getAllPoolsToFetch(
  workerName: string,
  workerConfiguration: MerchantMoeV2WorkerConfiguration,
  tokens: TokenList
) {
  const merchantMoeV2Factory = MerchantMoeFactory__factory.connect(
    workerConfiguration.factoryAddress,
    Web3Utils.getMulticallProvider()
  );

  const poolsToFetch = [];
  // find existing pools via multicall
  const promises = [];
  for (const pairToFetch of workerConfiguration.pairs) {
    const token0 = tokens[pairToFetch.token0];
    const token1 = tokens[pairToFetch.token1];
    promises.push(merchantMoeV2Factory.getAllLBPairs(token0.address, token1.address));
    ///
    // LBPairInformation({
    //     binStep: binStep,
    //     LBPair: lbPairsInfo[binStep].LBPair,
    //     createdByOwner: lbPairsInfo[binStep].createdByOwner,
    //     ignoredForRouting: lbPairsInfo[binStep].ignoredForRouting
    // });
  }
  let promiseIndex = 0;
  for (const pairToFetch of workerConfiguration.pairs) {
    const poolsForPair = await promises[promiseIndex];
    if (!poolsForPair) {
      console.log(`${workerName}[No pairs for ${pairToFetch.token0}-${pairToFetch.token1}`);
    } else {
      for (const pool of poolsForPair) {
        if (pool.LBPair == ethers.ZeroAddress) {
          console.log(`${workerName}[${pairToFetch.token0}-${pairToFetch.token1}: pool does not exist`);
        } else {
          poolsToFetch.push({
            pairToFetch,
            poolAddress: pool.LBPair,
            binStep: Number(pool.binStep)
          });
        }
      }
    }

    promiseIndex++;
  }

  return poolsToFetch;
}
