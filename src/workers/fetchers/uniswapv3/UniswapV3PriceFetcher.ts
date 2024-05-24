import { BaseFetcher } from '../BaseFetcher';
import {
  CurvePricePairConfiguration,
  CurveWorkerConfiguration,
  UniSwapV3WorkerConfiguration,
  UniswapV3PairConfiguration,
  Univ3PairWithFeesAndPool,
  generatePriceCSVFilePath
} from '../../configuration/WorkerConfiguration';
import * as ethers from 'ethers';
import * as Web3Utils from '../../../utils/Web3Utils';
import { UniswapV3Factory__factory } from '../../../contracts/types/factories/uniswapv3/UniswapV3Factory__factory';
import { getAllPoolsToFetch, parseEvent, translateTopicFilters } from './UniswapV3Utils';
import { getConfTokenBySymbol, normalize, sleep } from '../../../utils/Utils';
import * as fs from 'fs';
import { readLastLine } from '../../configuration/Helper';
import { GetContractCreationBlockNumber } from '../../../utils/Web3Utils';
import { UniswapV3Pair, UniswapV3Pair__factory } from '../../../contracts/types';
import { TokenData } from '../../configuration/TokenData';

export class UniswapV3PriceFetcher extends BaseFetcher<UniSwapV3WorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('uniswapv3', 'UniswapV3 Price Fetcher', runEveryMinutes);
  }

  async runSpecific(): Promise<void> {
    const currentBlock = await Web3Utils.getCurrentBlock();

    console.log(`${this.workerName}: getting pools to fetch`);

    const poolsToFetch: Univ3PairWithFeesAndPool[] = await getAllPoolsToFetch(
      this.workerName,
      this.getConfiguration(),
      this.tokens
    );

    const poolsToFetchGroupedByPair: { [pair: string]: { pairToFetch: UniswapV3PairConfiguration; pools: string[] } } =
      {};
    for (const fetchConfig of poolsToFetch) {
      const pairKey = `${fetchConfig.pairToFetch.token0}-${fetchConfig.pairToFetch.token1}`;
      if (!poolsToFetchGroupedByPair[pairKey]) {
        poolsToFetchGroupedByPair[pairKey] = {
          pairToFetch: fetchConfig.pairToFetch,
          pools: []
        };
      }
      poolsToFetchGroupedByPair[pairKey].pools.push(fetchConfig.poolAddress);
    }

    const stalePairs = [];
    let promises = [];
    for (const groupedFetchConfig of Object.values(poolsToFetchGroupedByPair)) {
      promises.push(
        this.FetchUniswapV3PriceHistoryForPair(groupedFetchConfig.pairToFetch, groupedFetchConfig.pools, currentBlock)
      );

      await sleep(1000);
    }

    // const lastBlockWithData = await FetchUniswapV3PriceHistoryForPair(groupedFetchConfig.pairToFetch, groupedFetchConfig.pools, web3Provider, currentBlock);
    if (promises.length >= 0) {
      const results = await Promise.all(promises);
      for (const result of results) {
        if (currentBlock - result.lastBlockWithData > 500_000) {
          stalePairs.push(
            `no data since ${currentBlock - result.lastBlockWithData} blocks for ${result.token0}/${result.token1}`
          );
        }
      }

      promises = [];
    }

    for (const stalePair of stalePairs) {
      console.warn(stalePair);
    }
  }

  async FetchUniswapV3PriceHistoryForPair(
    pairToFetch: UniswapV3PairConfiguration,
    pools: string[],
    currentBlock: number
  ): Promise<{ lastBlockWithData: number; token0: string; token1: string }> {
    const token0Conf = this.tokens[pairToFetch.token0];
    const token1Conf = this.tokens[pairToFetch.token1];

    const label = `[${token0Conf.symbol}-${token1Conf.symbol}]`;

    // get the first block to fetch
    const priceHistoryFilename = generatePriceCSVFilePath(
      this.workerName,
      `${pairToFetch.token0}-${pairToFetch.token1}`
    );
    const priceHistoryReversedFilename = generatePriceCSVFilePath(
      this.workerName,
      `${pairToFetch.token1}-${pairToFetch.token0}`
    );

    let sinceBlock = 0;
    if (fs.existsSync(priceHistoryFilename) && fs.existsSync(priceHistoryReversedFilename)) {
      const lastLine = await readLastLine(priceHistoryFilename);
      sinceBlock = Number(lastLine.split(',')[0]) + 1;
      if (isNaN(sinceBlock)) {
        sinceBlock = 0;
      }

      // check same block for both files
      const lastLineReversed = await readLastLine(priceHistoryReversedFilename);
      let sinceBlockReversed = Number(lastLineReversed.split(',')[0]) + 1;
      if (isNaN(sinceBlockReversed)) {
        sinceBlockReversed = 0;
      }

      if (sinceBlockReversed != sinceBlock) {
        // inconsistency, throw
        throw new Error(`Both price files not the same block for ${pairToFetch.token1}-${pairToFetch.token0} ?`);
      }
    } else {
      fs.writeFileSync(priceHistoryFilename, 'blocknumber,price\n');
      fs.writeFileSync(priceHistoryReversedFilename, 'blocknumber,price\n');
    }

    if (sinceBlock == 0) {
      // find the oldest pool
      for (const poolAddress of pools) {
        const startBlock = await GetContractCreationBlockNumber(poolAddress, this.workerName);
        sinceBlock = sinceBlock == 0 ? startBlock + 100_000 : Math.min(sinceBlock, startBlock + 100_000); // leave 100k blocks ~2 weeks after pool creation because many pools starts with weird data
      }
    }

    let lastBlockWithData = sinceBlock;

    // initializes the pools contracts
    const contracts: { [address: string]: UniswapV3Pair } = {};
    for (const poolAddress of pools) {
      contracts[poolAddress] = UniswapV3Pair__factory.connect(poolAddress, this.web3Provider);
    }

    const step = 100_000;
    let fromBlock = sinceBlock;
    let toBlock = 0;

    while (toBlock < currentBlock) {
      toBlock = fromBlock + step - 1;
      if (toBlock > currentBlock) {
        toBlock = currentBlock;
      }

      const tradesByPool: { [poolAddress: string]: { block: number; price: number }[] } = {};
      console.log(`${label}: fetching events for blocks [${fromBlock}-${toBlock}]`);

      for (const poolAddress of pools) {
        const univ3PairContract: UniswapV3Pair = UniswapV3Pair__factory.connect(poolAddress, this.web3Provider);
        tradesByPool[poolAddress] = await fetchEvents(fromBlock, toBlock, univ3PairContract, token0Conf, token1Conf);
      }

      let mainPool = pools[0];
      let mainPoolTradeCount = 0;
      for (const poolAddress of pools) {
        const poolSwaps = tradesByPool[poolAddress];
        if (poolSwaps.length > mainPoolTradeCount) {
          mainPoolTradeCount = poolSwaps.length;
          mainPool = poolAddress;
        }
      }
      if (mainPoolTradeCount == 0) {
        console.log(`${label}: not a single swap, ignoring block interval`);
        fromBlock = toBlock + 1;
        continue;
      }

      let allSwaps: { block: number; price: number }[] = tradesByPool[mainPool];
      console.log(`${label}: [pool ${mainPool}]: ${mainPoolTradeCount} swaps`);

      for (const poolAddress of pools) {
        if (poolAddress == mainPool) {
          continue;
        }

        const poolSwaps = tradesByPool[poolAddress];
        if (poolSwaps.length < mainPoolTradeCount * 0.5) {
          console.log(`${label}: [pool ${poolAddress}]: ${poolSwaps.length} swaps | too few, swaps discarded`);
        } else {
          console.log(`${label}: [pool ${poolAddress}]: ${poolSwaps.length} swaps | enough, keeping swaps`);
          allSwaps = allSwaps.concat(poolSwaps);
        }
      }

      // sort by blocks
      allSwaps.sort((a, b) => a.block - b.block);

      const toWrite = [];
      const toWriteReversed = [];
      for (const priceData of allSwaps) {
        toWrite.push(`${priceData.block},${priceData.price}\n`);
        toWriteReversed.push(`${priceData.block},${1 / priceData.price}\n`);
        lastBlockWithData = priceData.block;
      }

      fs.appendFileSync(priceHistoryFilename, toWrite.join(''));
      fs.appendFileSync(priceHistoryReversedFilename, toWriteReversed.join(''));

      fromBlock = toBlock + 1;
    }

    return { lastBlockWithData, token0: token0Conf.symbol, token1: token1Conf.symbol };
  }
}

async function fetchEvents(
  startBlock: number,
  endBlock: number,
  contract: ethers.ethers.BaseContract,
  token0Conf: TokenData,
  token1Conf: TokenData
): Promise<{ block: number; price: number }[]> {
  const initBlockStep = 100000;
  let blockStep = initBlockStep;
  let fromBlock = startBlock;
  let toBlock = 0;
  const swapResults: { block: number; price: number }[] = [];
  while (toBlock < endBlock) {
    toBlock = fromBlock + blockStep - 1;
    if (toBlock > endBlock) {
      toBlock = endBlock;
    }

    let events = undefined;
    try {
      events = await contract.queryFilter('Swap', fromBlock, toBlock);
    } catch (e) {
      // console.log(`query filter error: ${e.toString()}`);
      blockStep = Math.round(blockStep / 2);
      if (blockStep < 1000) {
        blockStep = 1000;
      }
      toBlock = 0;
      continue;
    }

    // console.log(`${fnName()}[${fromBlock} - ${toBlock}]: found ${events.length} Swap events after ${cptError} errors (fetched ${toBlock-fromBlock+1} blocks)`);

    if (events.length != 0) {
      for (const e of events) {
        const parsedEvent: ethers.ethers.LogDescription = parseEvent(e);

        // for the wstETH/WETH pool, ignore block 15952167 because of 1.28 price that is an outlier
        if (e.blockNumber == 15952167 && token0Conf.symbol == 'wstETH' && token1Conf.symbol == 'WETH') {
          continue;
        }

        const token0Amount = Math.abs(normalize(parsedEvent.args.amount0, token0Conf.decimals));
        if (token0Amount < token0Conf.dustAmount) {
          continue;
        }
        const token1Amount = Math.abs(normalize(parsedEvent.args.amount1, token1Conf.decimals));
        if (token1Amount < token1Conf.dustAmount) {
          continue;
        }

        swapResults.push({
          block: e.blockNumber,
          price: token1Amount / token0Amount
        });
      }

      // try to find the blockstep to reach 9000 events per call as the RPC limit is 10 000,
      // this try to change the blockstep by increasing it when the pool is not very used
      // or decreasing it when the pool is very used
      blockStep = Math.min(1_000_000, Math.round((blockStep * 8000) / events.length));
    } else {
      // if 0 events, multiply blockstep by 4
      blockStep = blockStep * 4;
    }
    fromBlock = toBlock + 1;
  }

  return swapResults;
}
