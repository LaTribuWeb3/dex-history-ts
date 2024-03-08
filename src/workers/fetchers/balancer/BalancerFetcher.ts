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
import { BalancerMetaStablePool__factory, BalancerVault__factory } from '../../../contracts/types';
import { BlockData } from '../../../models/datainterface/BlockData';
import { computeSlippageMapForBalancerPool } from '../../../library/BalancerLibrary';
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
      promises.push(this.fetchBalancerPool(balancerPoolConfig, web3Provider, endBlock, minStartBlock));
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
    let startBlock = 0;

    if (fs.existsSync(historyFileName)) {
      const lastLine = await readLastLine(historyFileName);
      startBlock = Number(lastLine.split(',')[0]) + Constants.DEFAULT_STEP_BLOCK;
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
        lineCounter = await this.fetchMetaStablePool(
          balancerPoolConfig,
          historyFileName,
          web3Provider,
          startBlock,
          endBlock
        );
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
      fs.writeFileSync(historyFileName, `blocknumber,ampFactor${tokenColumns}\n`);
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

  async generateUnifiedData(balancerPoolConfig: BalancerPoolConfiguration) {
    const rawDataFilePath = generateRawCSVFilePathForBalancerPool(this.workerName, balancerPoolConfig.name);
    if (!fs.existsSync(rawDataFilePath)) {
      console.warn(`Cannot raw data history file: ${rawDataFilePath}`);
    }

    const fileContent = fs.readFileSync(rawDataFilePath, 'utf-8').split('\n');
    let sinceBlock = Number(fileContent[1].split(',')[0]);

    for (const base of balancerPoolConfig.tokenSymbols) {
      for (const quote of balancerPoolConfig.tokenSymbols) {
        if (base == quote) {
          continue;
        }
        const unifiedFullFilename = generateUnifiedCSVFilePath(
          'balancer',
          base + '-' + quote + '-' + balancerPoolConfig.name
        );

        if (!fs.existsSync(unifiedFullFilename)) {
          fs.writeFileSync(unifiedFullFilename, 'blocknumber,price,slippagemap\n');
        }

        const lastLine = await readLastLine(unifiedFullFilename);
        const precomputedMinBlock = Number(lastLine.split(',')[0]) + 1;
        if (!isNaN(precomputedMinBlock)) {
          sinceBlock = precomputedMinBlock;
        }

        let toWrite = [];
        for (let i = 1; i < fileContent.length - 1; i++) {
          const blockNumber = Number(fileContent[i].split(',')[0]);
          if (blockNumber < sinceBlock) {
            continue;
          }

          const dataLine = fileContent[i];

          const dataToWrite: BlockData = computeSlippageMapForBalancerPool(
            balancerPoolConfig,
            dataLine,
            balancerPoolConfig.tokenSymbols.indexOf(base),
            balancerPoolConfig.tokenSymbols.indexOf(quote)
          );

          toWrite.push(`${blockNumber},${dataToWrite.price},${JSON.stringify(dataToWrite.slippageMap)}\n`);

          if (toWrite.length >= 50) {
            fs.appendFileSync(unifiedFullFilename, toWrite.join(''));
            toWrite = [];
          }
        }

        if (toWrite.length >= 0) {
          fs.appendFileSync(unifiedFullFilename, toWrite.join(''));
        }
      }
    }
  }

  // async fetchBalancerPool(
  //   balancerPoolConfig: BalancerPoolConfiguration,
  //   web3Provider: ethers.ethers.JsonRpcProvider,
  //   endBlock: number,
  //   minStartBlock: number
  // ) {
  //   const pool = new WeightedPool(
  //     '',
  //     '',
  //     '0',
  //     '1000000000000000000',
  //     '0',
  //     [
  //       {
  //         address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  //         balance: '6406258014055556522256',
  //         decimals: 18,
  //         weight: '200000000000000000'
  //       },
  //       {
  //         address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  //         balance: '943649833164774214585305',
  //         decimals: 18,
  //         weight: '800000000000000000'
  //       }
  //     ],
  //     ['0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9']
  //   );

  //   const poolPairData = pool.parsePoolPairData(
  //     '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  //     '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
  //   );

  //   const _1e18 = new BigNumber(10).pow(18);

  //   const baseAmountOut = pool._exactTokenInForTokenOut(poolPairData, new BigNumber(1).times(_1e18));
  //   const basePrice = baseAmountOut.div(_1e18).toNumber();
  //   console.log(`basePrice: 1 wstETH = ${basePrice} AAVE`);
  //   for (let i = 100; i < 15000; i += 100) {
  //     const amountIn = new BigNumber(i).times(_1e18);
  //     const amountInNorm = amountIn.div(_1e18).toNumber();
  //     console.log(`amountIn: ${amountInNorm}`);
  //     const amountOut = pool._exactTokenInForTokenOut(poolPairData, amountIn);
  //     const amountOutNorm = amountOut.div(_1e18).toNumber();
  //     console.log(`amountOut: ${amountOutNorm}`);

  //     const price = amountOutNorm / amountInNorm;

  //     // console.log(`for ${i} wstETH | price: 1 wstETH = ${price} AAVE`);

  //     const newPoolAfterSwap = new WeightedPool(
  //       '',
  //       '',
  //       '0',
  //       '1000000000000000000',
  //       '0',
  //       [
  //         {
  //           address: '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  //           balance: new BigNumber('6406258014055556522256').plus(amountIn).toString(10),
  //           decimals: 18,
  //           weight: '200000000000000000'
  //         },
  //         {
  //           address: '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
  //           balance: new BigNumber('943649833164774214585305').minus(amountOut).toString(10),
  //           decimals: 18,
  //           weight: '800000000000000000'
  //         }
  //       ],
  //       ['0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0', '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9']
  //     );

  //     const newPoolPairData = newPoolAfterSwap.parsePoolPairData(
  //       '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0',
  //       '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9'
  //     );

  //     const afterAmountOut = newPoolAfterSwap._exactTokenInForTokenOut(newPoolPairData, _1e18);
  //     const afterAmountOutNormPrice = afterAmountOut.div(_1e18).toNumber();

  //     console.log(`basePrice: 1 wstETH = ${basePrice} AAVE`);
  //     console.log(`afterPrice: 1 wstETH = ${afterAmountOutNormPrice} AAVE`);

  //     const avgSlippage = (basePrice - price) / basePrice;
  //     console.log(`AvgSlippage: ${avgSlippage}`);
  //     const slippageLast$ = (basePrice - afterAmountOutNormPrice) / basePrice;
  //     console.log(`slippageLast$: ${slippageLast$}`);
  //   }
  //   // const spotPriceBefore = pool._spotPriceAfterSwapExactTokenInForTokenOut(poolPairData, new BigNumber(0));
  //   // console.log(spotPriceBefore.toString(10));
  //   // const spotPriceAfter = pool._spotPriceAfterSwapExactTokenInForTokenOut(poolPairData, new BigNumber(100));
  //   // console.log(spotPriceAfter.toString(10));
  // }
}

async function debug() {
  const fetcher = new BalancerFetcher(0);
  await fetcher.runSpecific();
}

debug();
