import { BaseWorker } from '../../BaseWorker';
import * as ethers from 'ethers';
import * as fs from 'fs';
import * as Constants from '../../../utils/Constants';
import * as Web3Utils from '../../../utils/Web3Utils';
import * as Sync from '../../../utils/Sync';
import retry, { normalize } from '../../../utils/Utils';
import { UniswapV2Factory__factory } from '../../../contracts/types/factories/uniswapv2/UniswapV2Factory__factory';
import { UniswapV2Pair__factory } from '../../../contracts/types/factories/uniswapv2/UniswapV2Pair__factory';
import * as Helper from '../../configuration/Helper';
import path, { dirname } from 'path';
import { readLastLine } from '../../configuration/Helper';
import {
  getAllPreComputed,
  generatePriceCSVFilePath,
  generateRawCSVFilePathForPair,
  generateUnifiedCSVFilePath,
  listAllExistingRawPairs,
  BalancerWorkerConfiguration,
  BalancerPoolConfiguration,
  generateRawCSVFilePathForBalancerPool,
  BalancerPoolTypeEnum
} from '../../configuration/WorkerConfiguration';
import { ComputeLiquidityXYKPool, ComputeXYKPrice } from '../../../library/XYKLibrary';
import { MetaStablePool, PoolPairBase, SwapTypes, WeightedPool } from '@balancer-labs/sor';
import BigNumber from 'bignumber.js';
import { MulticallWrapper } from 'ethers-multicall-provider';
import { BalancerMetaStablePool__factory, BalancerVault__factory } from '../../../contracts/types';
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

    for (const balancerPoolConfig of this.workerConfiguration.pools) {
      console.log(`Start fetching pool data for ${balancerPoolConfig.name}`);
      await this.fetchBalancerPool(balancerPoolConfig, web3Provider, endBlock, minStartBlock);
    }
  }

  //    ___ ___ _____ ___ _  _   ___ _   _ _  _  ___ _____ ___ ___  _  _ ___
  //   | __| __|_   _/ __| || | | __| | | | \| |/ __|_   _|_ _/ _ \| \| / __|
  //   | _|| _|  | || (__| __ | | _|| |_| | .` | (__  | |  | | (_) | .` \__ \
  //   |_| |___| |_| \___|_||_| |_|  \___/|_|\_|\___| |_| |___\___/|_|\_|___/
  //

  // async fetchBalancerPool(
  //   balancerPoolConfig: BalancerPoolConfiguration,
  //   web3Provider: ethers.ethers.JsonRpcProvider,
  //   endBlock: number
  // ) {
  //   const pool = new MetaStablePool(
  //     '0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112',
  //     '0x1E19CF2D73a72Ef1332C882F20534B6519Be0276',
  //     '50000',
  //     '0',
  //     '0',
  //     [
  //       {
  //         address: '0xae78736Cd615f374D3085123A210448E74Fc6393',
  //         balance: '12852449785184751241973',
  //         decimals: 18,
  //         priceRate: '1099951859460781392'
  //       },
  //       {
  //         address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  //         balance: '14797956126696750242677',
  //         decimals: 18,
  //         priceRate: '1000000000000000000'
  //       }
  //     ],
  //     ['0xae78736Cd615f374D3085123A210448E74Fc6393', '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2']
  //   );

  //   const poolPairData = pool.parsePoolPairData(
  //     '0xae78736Cd615f374D3085123A210448E74Fc6393',
  //     '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  //   );

  //   const _1e18 = new BigNumber(10).pow(18);

  //   const limit = pool.getLimitAmountSwap(poolPairData, SwapTypes.SwapExactIn);
  //   console.log(`limit: ${limit.div(_1e18).toNumber()}`);

  //   const baseAmountOut = pool._exactTokenInForTokenOut(poolPairData, new BigNumber(1).times(_1e18));
  //   const basePrice = baseAmountOut.div(_1e18).toNumber();

  //   console.log(`basePrice: 1 rETH = ${basePrice} WETH`);
  //   for (let i = 1000; i < 50000; i += 1000) {
  //     const amountIn = new BigNumber(i).times(_1e18);
  //     const amountInNorm = amountIn.div(_1e18).toNumber();
  //     console.log(`amountIn: ${amountInNorm}`);
  //     const amountOut = pool._exactTokenInForTokenOut(poolPairData, amountIn);
  //     const amountOutNorm = amountOut.div(_1e18).toNumber();
  //     console.log(`amountOut: ${amountOutNorm}`);

  //     const price = amountOutNorm / amountInNorm;

  //     const slippage = (basePrice - price) / basePrice;
  //     console.log(slippage);

  //     console.log(`for ${i} rETH | price: 1 rETH = ${price} WETH`);
  //   }
  //   // const spotPriceBefore = pool._spotPriceAfterSwapExactTokenInForTokenOut(poolPairData, new BigNumber(0));
  //   // console.log(spotPriceBefore.toString(10));
  //   // const spotPriceAfter = pool._spotPriceAfterSwapExactTokenInForTokenOut(poolPairData, new BigNumber(100));
  //   // console.log(spotPriceAfter.toString(10));
  // }

  async fetchBalancerPool(
    balancerPoolConfig: BalancerPoolConfiguration,
    web3Provider: ethers.ethers.JsonRpcProvider,
    endBlock: number,
    minStartBlock: number
  ) {
    const historyFileName = generateRawCSVFilePathForBalancerPool(this.workerName, balancerPoolConfig.name);
    console.log(historyFileName);
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

    switch (balancerPoolConfig.type) {
      default:
        throw new Error(`Unknown type: ${balancerPoolConfig.type}`);
      case BalancerPoolTypeEnum.META_STABLE_POOL:
        await this.fetchMetaStablePool(balancerPoolConfig, historyFileName, web3Provider, startBlock, endBlock);
    }
  }

  async fetchMetaStablePool(
    balancerPoolConfig: BalancerPoolConfiguration,
    historyFileName: string,
    web3Provider: ethers.ethers.JsonRpcProvider,
    startBlock: number,
    endBlock: number
  ) {
    if (!fs.existsSync(historyFileName)) {
      // generate first line
      let tokenColumns = '';
      for (const token of balancerPoolConfig.tokenSymbols) {
        tokenColumns += `,${token}_balance,${token}_scale`;
      }
      fs.writeFileSync(historyFileName, `blocknumber,ampFactor${tokenColumns}\n`);
    }

    const multicallProvider = MulticallWrapper.wrap(web3Provider);
    const vaultContract = BalancerVault__factory.connect(this.workerConfiguration.vaultAddress, multicallProvider);
    const poolContract = BalancerMetaStablePool__factory.connect(balancerPoolConfig.address, multicallProvider);

    for (let block = startBlock; block <= endBlock; block += Constants.DEFAULT_STEP_BLOCK) {
      const fetchAndWriteData = async () => {
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

      await retry(fetchAndWriteData, []);
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
