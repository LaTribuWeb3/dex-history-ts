import { BaseWorker } from '../../BaseWorker';
import * as ethers from 'ethers';
import * as fs from 'fs';
import * as Constants from '../../../utils/Constants';
import * as Web3Utils from '../../../utils/Web3Utils';
import retry from '../../../utils/Utils';
import { readLastLine } from '../../configuration/Helper';
import {
  generateUnifiedCSVFilePath,
  BalancerWorkerConfiguration,
  BalancerPoolConfiguration,
  generateRawCSVFilePathForBalancerPool,
  BalancerPoolTypeEnum,
  ensureBalancerPrecomputedPresent
} from '../../configuration/WorkerConfiguration';
import BigNumber from 'bignumber.js';
import { MulticallWrapper } from 'ethers-multicall-provider';
import {
  BalancerMetaStablePool__factory,
  BalancerVault__factory,
  BalancerWeightedPool2Tokens__factory
} from '../../../contracts/types';
import { BlockData } from '../../../models/datainterface/BlockData';
import { computeSlippageMapForBalancerPool } from '../../../library/BalancerLibrary';
import { WeightedPool } from '@balancer-labs/sor';
import { computeBalancerUnifiedDataForPair } from './BalancerUtils';
BigNumber.config({ EXPONENTIAL_AT: 1e9 }); // this is needed to interract with the balancer sor package

export class BalancerFetcher extends BaseWorker<BalancerWorkerConfiguration> {
  constructor(runEveryMinutes: number, workerName = 'balancer', monitoringName = 'Balancer Fetcher') {
    super(workerName, monitoringName, runEveryMinutes);
  }

  async runSpecific(): Promise<void> {
    const web3Provider: ethers.JsonRpcProvider = Web3Utils.getJsonRPCProvider();
    const endBlock: number = (await web3Provider.getBlockNumber()) - 10;

    // by default, fetch for the last 380 days (a bit more than 1 year)
    const startDate = Math.round(Date.now() / 1000) - 380 * 24 * 60 * 60;
    const minStartBlock = await Web3Utils.getBlocknumberForTimestamp(startDate);

    this.createDataDirForWorker();

    const promises = [];
    for (const balancerPoolConfig of this.workerConfiguration.pools) {
      console.log(`Start fetching pool data for ${balancerPoolConfig.name}`);
      const promise = this.fetchBalancerPool(balancerPoolConfig, web3Provider, endBlock, minStartBlock);
      // await promise;
      promises.push(promise);
    }

    await Promise.all(promises);

    ensureBalancerPrecomputedPresent();

    for (const balancerPoolConfig of this.workerConfiguration.pools) {
      console.log(`Start generating unified pool data for ${balancerPoolConfig.name}`);
      await this.generateUnifiedData(balancerPoolConfig);
    }
  }

  async fetchBalancerPool(
    balancerPoolConfig: BalancerPoolConfiguration,
    web3Provider: ethers.ethers.JsonRpcProvider,
    endBlock: number,
    minStartBlock: number
  ) {
    const logLabel = `fetchBalancerPool[${balancerPoolConfig.name}]`;

    const historyFileName = generateRawCSVFilePathForBalancerPool(this.workerName, balancerPoolConfig.name);
    let startBlock = Math.max(minStartBlock, balancerPoolConfig.deployBlock);

    if (fs.existsSync(historyFileName)) {
      const lastLine = await readLastLine(historyFileName);
      const lastLineBlock = Number(lastLine.split(',')[0]) + Constants.DEFAULT_STEP_BLOCK;
      if (!isNaN(lastLineBlock)) {
        startBlock = lastLineBlock;
      }
    } else {
      startBlock = minStartBlock;
    }

    if (balancerPoolConfig.minBlock && startBlock < balancerPoolConfig.minBlock) {
      startBlock = balancerPoolConfig.minBlock;
    }

    if (startBlock > endBlock) {
      console.log(`${logLabel}: No new data to fetch`);
      return 0;
    }

    console.log(`${logLabel}: starting since block ${startBlock} to block ${endBlock}`);

    let lineCounter = 0;
    switch (balancerPoolConfig.type) {
      default:
        throw new Error(`Unknown type: ${balancerPoolConfig.type}`);
      case BalancerPoolTypeEnum.META_STABLE_POOL:
      case BalancerPoolTypeEnum.COMPOSABLE_STABLE_POOL:
        lineCounter = await this.fetchMetaStablePool(
          balancerPoolConfig,
          historyFileName,
          web3Provider,
          startBlock,
          endBlock
        );
        break;
      case BalancerPoolTypeEnum.WEIGHTED_POOL_2_TOKENS:
        lineCounter = await this.fetchWeightedPool2Tokens(
          balancerPoolConfig,
          historyFileName,
          web3Provider,
          startBlock,
          endBlock
        );
        break;
    }

    console.log(`${logLabel}: ending. Fetched ${lineCounter} data since block ${startBlock}`);
  }

  async fetchMetaStablePool(
    balancerPoolConfig: BalancerPoolConfiguration,
    historyFileName: string,
    web3Provider: ethers.ethers.JsonRpcProvider,
    startBlock: number,
    endBlock: number
  ): Promise<number> {
    if (!fs.existsSync(historyFileName)) {
      // generate first line
      let tokenColumns = '';
      for (const token of balancerPoolConfig.tokenSymbols) {
        tokenColumns += `,${token}_balance,${token}_scale`;
      }
      fs.writeFileSync(historyFileName, `blocknumber,ampFactor,fee${tokenColumns}\n`);
    }
    let counter = 0;
    for (let block = startBlock; block <= endBlock; block += Constants.DEFAULT_STEP_BLOCK) {
      counter++;
      const fetchAndWriteData = async () => {
        const multicallProvider = MulticallWrapper.wrap(web3Provider);
        const vaultContract = BalancerVault__factory.connect(this.workerConfiguration.vaultAddress, multicallProvider);
        const poolContract = BalancerMetaStablePool__factory.connect(balancerPoolConfig.address, multicallProvider);

        const [poolTokensResult, scalingFactorsResult, ampResult, swapFeePercentageResult] = await Promise.all([
          vaultContract.getPoolTokens(balancerPoolConfig.poolId, { blockTag: block }),
          poolContract.getScalingFactors({ blockTag: block }),
          poolContract.getAmplificationParameter({ blockTag: block }),
          poolContract.getSwapFeePercentage({ blockTag: block })
        ]);

        let tokenValues = '';
        for (let i = 0; i < balancerPoolConfig.tokenSymbols.length; i++) {
          const tokenIndex = balancerPoolConfig.tokenIndexes[i];
          tokenValues += `,${poolTokensResult.balances[tokenIndex].toString(10)},${scalingFactorsResult[
            tokenIndex
          ].toString(10)}`;
        }
        fs.appendFileSync(
          historyFileName,
          `${block},${ampResult.value.toString(10)},${swapFeePercentageResult.toString(10)}${tokenValues}\n`
        );
      };

      await retry(fetchAndWriteData, [], 100);
    }

    return counter;
  }

  async fetchWeightedPool2Tokens(
    balancerPoolConfig: BalancerPoolConfiguration,
    historyFileName: string,
    web3Provider: ethers.ethers.JsonRpcProvider,
    startBlock: number,
    endBlock: number
  ): Promise<number> {
    if (!fs.existsSync(historyFileName)) {
      // generate first line
      let tokenColumns = '';
      for (const token of balancerPoolConfig.tokenSymbols) {
        tokenColumns += `,${token}_balance,${token}_weight`;
      }
      fs.writeFileSync(historyFileName, `blocknumber,fee${tokenColumns}\n`);
    }

    let counter = 0;
    for (let block = startBlock; block <= endBlock; block += Constants.DEFAULT_STEP_BLOCK) {
      counter++;
      const fetchAndWriteData = async () => {
        const multicallProvider = MulticallWrapper.wrap(web3Provider);
        const vaultContract = BalancerVault__factory.connect(this.workerConfiguration.vaultAddress, multicallProvider);
        const poolContract = BalancerWeightedPool2Tokens__factory.connect(
          balancerPoolConfig.address,
          multicallProvider
        );

        const [poolTokensResult, normalizedWeightResult, swapFeePercentageResult] = await Promise.all([
          vaultContract.getPoolTokens(balancerPoolConfig.poolId, { blockTag: block }),
          poolContract.getNormalizedWeights({ blockTag: block }),
          poolContract.getSwapFeePercentage({ blockTag: block })
        ]);

        let tokenValues = '';
        for (let i = 0; i < balancerPoolConfig.tokenSymbols.length; i++) {
          const tokenIndex = balancerPoolConfig.tokenIndexes[i];
          tokenValues += `,${poolTokensResult.balances[tokenIndex].toString(10)},${normalizedWeightResult[
            tokenIndex
          ].toString(10)}`;
        }
        fs.appendFileSync(historyFileName, `${block},${swapFeePercentageResult.toString(10)}${tokenValues}\n`);
      };

      await retry(fetchAndWriteData, [], 100);
    }

    return counter;
  }

  async generateUnifiedData(balancerPoolConfig: BalancerPoolConfiguration) {
    const rawDataFilePath = generateRawCSVFilePathForBalancerPool(this.workerName, balancerPoolConfig.name);
    if (!fs.existsSync(rawDataFilePath)) {
      console.warn(`Cannot find raw data history file: ${rawDataFilePath}`);
    }

    for (const base of balancerPoolConfig.tokenSymbols) {
      for (const quote of balancerPoolConfig.tokenSymbols) {
        if (base == quote) {
          continue;
        }

        await computeBalancerUnifiedDataForPair(base, quote, balancerPoolConfig, rawDataFilePath);
      }
    }
  }
}

// async function debug() {
//   const fetcher = new BalancerFetcher(0);
//   await fetcher.runSpecific();
// }

// debug();
