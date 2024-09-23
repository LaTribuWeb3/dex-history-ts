import { TokenList } from '../../configuration/TokenData';
import * as Web3Utils from '../../../utils/Web3Utils';
import { MerchantMoeFactory__factory, MerchantMoeLBPair__factory } from '../../../contracts/types';
import * as ethers from 'ethers';
import { MerchantMoeV2WorkerConfiguration } from '../../configuration/WorkerConfiguration';
import retry, { getConfTokenByAddress, sleep } from '../../../utils/Utils';

export async function getAllPoolsToFetch(
  workerName: string,
  workerConfiguration: MerchantMoeV2WorkerConfiguration,
  tokens: TokenList
) {
  const multicallProvider = Web3Utils.getMulticallProvider();
  const merchantMoeV2Factory = MerchantMoeFactory__factory.connect(
    workerConfiguration.factoryAddress,
    multicallProvider
  );

  const poolsToFetch = [];
  // find existing pools via multicall
  const promises = [];
  for (const pairToFetch of workerConfiguration.pairs) {
    const token0 = tokens[pairToFetch.token0];
    const token1 = tokens[pairToFetch.token1];
    promises.push(merchantMoeV2Factory.getAllLBPairs(token0.address, token1.address));
  }

  let promiseIndex = 0;
  const results = await Promise.all(promises);
  for (const pairToFetch of workerConfiguration.pairs) {
    const poolsForPair = results[promiseIndex];
    if (poolsForPair.length == 0) {
      console.log(`${workerName}[No pairs for ${pairToFetch.token0}-${pairToFetch.token1}]`);
    } else {
      if (poolsForPair.length > 1) {
        console.log(`many pools for ${pairToFetch.token0}-${pairToFetch.token1}`);
      }
      for (const pool of poolsForPair) {
        if (pool.LBPair == ethers.ZeroAddress) {
          console.log(`${workerName}[${pairToFetch.token0}-${pairToFetch.token1}: pool does not exist`);
        } else {
          const merchantMoeV2PairContract = MerchantMoeLBPair__factory.connect(pool.LBPair, multicallProvider);
          const [tokenXAddress, tokenYAddress] = await Promise.all([
            merchantMoeV2PairContract.getTokenX(),
            merchantMoeV2PairContract.getTokenY()
          ]);
          const tokenXSymbol = (await getConfTokenByAddress(tokenXAddress, tokens)).symbol;
          const tokenYSymbol = (await getConfTokenByAddress(tokenYAddress, tokens)).symbol;
          if (pairToFetch.token0 != tokenXSymbol || pairToFetch.token1 != tokenYSymbol) {
            console.warn(
              `token mismatch between config and pair ${pairToFetch.token0} != ${tokenXSymbol} or ${pairToFetch.token1} != ${tokenYSymbol}`
            );
            continue;
          }
          poolsToFetch.push({
            pairToFetch: { token0: tokenXSymbol, token1: tokenYSymbol },
            poolAddress: pool.LBPair,
            binStep: Number(pool.binStep)
          });
          await sleep(200);
        }
      }
    }

    promiseIndex++;
  }

  return poolsToFetch;
}
