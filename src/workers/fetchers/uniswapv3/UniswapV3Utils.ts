import { UniswapV3Factory__factory } from '../../../contracts/types/factories/uniswapv3/UniswapV3Factory__factory';
import { UniSwapV3WorkerConfiguration } from '../../configuration/WorkerConfiguration';
import * as Web3Utils from '../../../utils/Web3Utils';
import * as ethers from 'ethers';
import { TokenList } from '../../configuration/TokenData';

export async function getAllPoolsToFetch(
  workerName: string,
  workerConfiguration: UniSwapV3WorkerConfiguration,
  tokens: TokenList
) {
  const univ3Factory = UniswapV3Factory__factory.connect(
    workerConfiguration.factoryAddress,
    Web3Utils.getMulticallProvider()
  );

  const poolsToFetch = [];
  // find existing pools via multicall
  const promises = [];
  for (const pairToFetch of workerConfiguration.pairs) {
    for (const fee of workerConfiguration.fees) {
      const token0 = tokens[pairToFetch.token0];
      const token1 = tokens[pairToFetch.token1];

      promises.push(univ3Factory.getPool(token0.address, token1.address, fee));
    }
  }

  let promiseIndex = 0;
  for (const pairToFetch of workerConfiguration.pairs) {
    for (const fee of workerConfiguration.fees) {
      const poolAddress = await promises[promiseIndex];
      if (poolAddress == ethers.ZeroAddress) {
        console.log(`${workerName}[${pairToFetch.token0}-${pairToFetch.token1}-${fee}]: pool does not exist`);
      } else {
        poolsToFetch.push({
          pairToFetch,
          fee,
          poolAddress
        });
      }

      promiseIndex++;
    }
  }

  return poolsToFetch;
}

export async function translateTopicFilters(topicFilters: Promise<ethers.ethers.TopicFilter>[]) {
  const allTopics: ethers.ethers.TopicFilter[] = await Promise.all(topicFilters);

  const topics: ethers.TopicFilter = [
    allTopics
      .filter((_) => _.length != 0)
      .filter((_) => _[0] != null)
      .flatMap((_) => {
        if (_.length == 0) return [];
        if (_[0] == null) return [];
        else return _[0].toString();
      })
  ];
  return topics;
}
