import { BaseFetcher } from '../BaseFetcher';
import * as ethers from 'ethers';
import * as fs from 'fs';
import * as Web3Utils from '../../../utils/Web3Utils';
import { getConfTokenByAddress, normalize } from '../../../utils/Utils';
import {
  BalancerWorkerConfiguration,
  BalancerPoolConfiguration,
  generatePriceCSVFilePath,
  generateLastFetchFileName
} from '../../configuration/WorkerConfiguration';
import BigNumber from 'bignumber.js';
import { BalancerVault__factory } from '../../../contracts/types';
import { TypedContractEvent, TypedEventLog } from '../../../contracts/types/common';
import { SwapEvent } from '../../../contracts/types/balancer/BalancerVault';
BigNumber.config({ EXPONENTIAL_AT: 1e9 }); // this is needed to interract with the balancer sor package

export class BalancerPriceFetcher extends BaseFetcher<BalancerWorkerConfiguration> {
  constructor(
    runEveryMinutes: number,
    configVersion: string,
    workerName = 'balancer',
    monitoringName = 'Balancer Price Fetcher'
  ) {
    super(workerName, monitoringName, runEveryMinutes, configVersion);
  }

  async runSpecific(): Promise<void> {
    const web3Provider: ethers.JsonRpcProvider = Web3Utils.getJsonRPCProvider();
    const endBlock: number = (await web3Provider.getBlockNumber()) - 10;

    this.createPriceDataDirForWorker();

    const promises = [];
    for (const balancerPoolConfig of this.getConfiguration().pools) {
      if (!balancerPoolConfig.computePrice) {
        continue;
      }
      console.log(`[${this.monitoringName}] | Start fetching pool data for ${balancerPoolConfig.name}`);
      const promise = this.fetchPriceBalancerPool(balancerPoolConfig, web3Provider, endBlock);
      // await promise;
      promises.push(promise);
    }

    await Promise.all(promises);
  }

  async fetchPriceBalancerPool(
    balancerPoolConfig: BalancerPoolConfiguration,
    web3Provider: ethers.ethers.JsonRpcProvider,
    endBlock: number
  ) {
    const logLabel = `[${this.monitoringName}] | [${balancerPoolConfig.name}] |`;
    const balancerVaultContract = BalancerVault__factory.connect(this.getConfiguration().vaultAddress, web3Provider);

    const lastFetchPoolFilename = generateLastFetchFileName(this.workerName, balancerPoolConfig.name);

    // find start block
    let startBlock = balancerPoolConfig.deployBlock;

    if (fs.existsSync(lastFetchPoolFilename)) {
      const lastFetchData: { lastBlockFetched: number } = JSON.parse(fs.readFileSync(lastFetchPoolFilename, 'utf-8'));
      startBlock = lastFetchData.lastBlockFetched + 1;
    } else {
      // if the lastFetched data does not exists, write/overwrite price files
      for (const base of balancerPoolConfig.tokenSymbols) {
        for (const quote of balancerPoolConfig.tokenSymbols) {
          if (base == quote) continue;
          const fileName = generatePriceCSVFilePath(this.workerName, `${base}-${quote}`);
          fs.writeFileSync(fileName, 'blocknumber,price\n');
        }
      }
    }

    if (balancerPoolConfig.minBlock && startBlock < balancerPoolConfig.minBlock) {
      startBlock = balancerPoolConfig.minBlock;
    }

    if (startBlock > endBlock) {
      console.log(`${logLabel} No new data to fetch`);
      return 0;
    }

    console.log(`${logLabel} Starting since block ${startBlock} to block ${endBlock}`);

    const initBlockStep = 500000;
    let priceCounter = 0;
    let blockStep = initBlockStep;
    let fromBlock = startBlock;
    let toBlock = 0;
    let cptError = 0;

    while (toBlock < endBlock) {
      toBlock = fromBlock + blockStep - 1;
      if (toBlock > endBlock) {
        toBlock = endBlock;
      }

      let events: TypedEventLog<
        TypedContractEvent<SwapEvent.InputTuple, SwapEvent.OutputTuple, SwapEvent.OutputObject>
      >[] = [];
      try {
        events = await balancerVaultContract.queryFilter(
          balancerVaultContract.filters.Swap(balancerPoolConfig.poolId),
          fromBlock,
          toBlock
        );
      } catch (e) {
        // console.log(`query filter error: ${e.toString()}`);
        blockStep = Math.max(10, Math.round(blockStep / 2));
        toBlock = 0;
        cptError++;
        if (cptError >= 100) {
          throw new Error('Too many errors');
        }
        continue;
      }

      console.log(
        `${logLabel} [${fromBlock} - ${toBlock}] found ${events.length} Swap events after ${cptError} errors (fetched ${
          toBlock - fromBlock + 1
        } blocks)`
      );
      cptError = 0;

      for (const swapEvent of events) {
        // ignore swap events if one token is the BPT token
        if (
          swapEvent.args.tokenIn.toLowerCase() == balancerPoolConfig.address.toLowerCase() ||
          swapEvent.args.tokenOut.toLowerCase() == balancerPoolConfig.address.toLowerCase()
        ) {
          continue;
        }
        const baseToken = await getConfTokenByAddress(swapEvent.args.tokenIn, this.tokens);
        const quoteToken = await getConfTokenByAddress(swapEvent.args.tokenOut, this.tokens);

        const amountSold = normalize(swapEvent.args.amountIn, baseToken.decimals);
        const amountBought = normalize(swapEvent.args.amountOut, quoteToken.decimals);

        // ignore trades too low
        if (amountSold < baseToken.dustAmount || amountBought < quoteToken.dustAmount) {
          continue;
        }

        const baseQuotePrice = amountBought / amountSold;
        const quoteBasePrice = amountSold / amountBought;

        const fileName = generatePriceCSVFilePath(this.workerName, `${baseToken.symbol}-${quoteToken.symbol}`);
        const fileNameReverse = generatePriceCSVFilePath(this.workerName, `${quoteToken.symbol}-${baseToken.symbol}`);

        fs.appendFileSync(fileName, `${swapEvent.blockNumber},${baseQuotePrice}\n`);
        fs.appendFileSync(fileNameReverse, `${swapEvent.blockNumber},${quoteBasePrice}\n`);
        priceCounter++;
      }

      // try to find the blockstep to reach 8000 events per call as the RPC limit is 10 000,
      // this try to change the blockstep by increasing it when the pool is not very used
      // or decreasing it when the pool is very used
      blockStep = Math.min(1000000, Math.round((blockStep * 8000) / events.length));

      fromBlock = toBlock + 1;
    }

    console.log(`${logLabel} Ending. Fetched ${priceCounter} prices since block ${startBlock}`);
    const lastFetchData = { lastBlockFetched: endBlock };
    fs.writeFileSync(lastFetchPoolFilename, JSON.stringify(lastFetchData, null, 2));
  }
}

// async function debug() {
//   const fetcher = new BalancerPriceFetcher(0);
//   await fetcher.runSpecific();
// }

// debug();
