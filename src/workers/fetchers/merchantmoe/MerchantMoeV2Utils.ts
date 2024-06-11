import { TokenList } from '../../configuration/TokenData';
import * as Web3Utils from '../../../utils/Web3Utils';
import { MerchantMoeFactory__factory, MerchantMoeLBPair__factory } from '../../../contracts/types';
import * as ethers from 'ethers';
import { MerchantMoeV2WorkerConfiguration } from '../../configuration/WorkerConfiguration';
import { getConfTokenByAddress } from '../../../utils/Utils';

export async function getAllPoolsToFetch(
  workerName: string,
  workerConfiguration: MerchantMoeV2WorkerConfiguration,
  tokens: TokenList
) {
  const merchantMoeV2Factory = MerchantMoeFactory__factory.connect(
    workerConfiguration.factoryAddress,
    Web3Utils.getMulticallProvider()
  );
  const web3Provider = Web3Utils.getJsonRPCProvider();

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
          const merchantMoeV2PairContract = MerchantMoeLBPair__factory.connect(pool.LBPair, web3Provider);
          const tokenXAddress = await merchantMoeV2PairContract.getTokenX();
          const tokenYAddress = await merchantMoeV2PairContract.getTokenY();
          const tokenXSymbol = (await getConfTokenByAddress(tokenXAddress, tokens)).symbol;
          const tokenYSymbol = (await getConfTokenByAddress(tokenYAddress, tokens)).symbol;
          poolsToFetch.push({
            pairToFetch: { token0: tokenXSymbol, token1: tokenYSymbol },
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
