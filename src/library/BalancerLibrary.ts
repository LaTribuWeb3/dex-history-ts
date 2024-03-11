import { ComposableStablePool, MetaStablePool, SwapTypes, WeightedPool } from '@balancer-labs/sor';
import { getConfTokenBySymbol, normalize } from '../utils/Utils';
import { BalancerPoolConfiguration, BalancerPoolTypeEnum } from '../workers/configuration/WorkerConfiguration';
import BigNumber from 'bignumber.js';
import { TokenData } from '../workers/configuration/TokenData';
import { BlockData, SlippageMap } from '../models/datainterface/BlockData';
BigNumber.config({ EXPONENTIAL_AT: 1e9 }); // this is needed to interract with the balancer sor package

const baseAmountMap: { [token: string]: BigNumber } = {
  DAI: new BigNumber((1000n * 10n ** 18n).toString(10)), // 1000 DAI ~= 1000$
  USDT: new BigNumber((1000n * 10n ** 6n).toString(10)), // 1000 USDT ~= 1000$
  sUSD: new BigNumber((1000n * 10n ** 18n).toString(10)), // 1000 sUSD ~= 1000$
  USDC: new BigNumber((1000n * 10n ** 6n).toString(10)), // 1000 USDC ~= 1000$
  WETH: new BigNumber((5n * 10n ** 17n).toString(10)), // 0.5 ETH ~= 1000$
  rETH: new BigNumber((5n * 10n ** 17n).toString(10)), // 0.5 rETH ~= 1000$
  stETH: new BigNumber((5n * 10n ** 17n).toString(10)), // 0.5 stETH ~= 1000$
  cbETH: new BigNumber((5n * 10n ** 17n).toString(10)), // 0.5 cbETH ~= 1000$
  WBTC: new BigNumber((4n * 10n ** 6n).toString(10)) // 0.04 WBTC ~= 1000$
};

export function computeSlippageMapForBalancerPool(
  balancerPoolConfig: BalancerPoolConfiguration,
  dataLine: string,
  indexFrom: number,
  indexTo: number
): BlockData {
  switch (balancerPoolConfig.type) {
    default:
      throw new Error(`Unknown type: ${balancerPoolConfig.type}`);
    case BalancerPoolTypeEnum.META_STABLE_POOL:
    case BalancerPoolTypeEnum.COMPOSABLE_STABLE_POOL:
      return computeSlippageMapForComposableStablePool(balancerPoolConfig, dataLine, indexFrom, indexTo);
    case BalancerPoolTypeEnum.WEIGHTED_POOL_2_TOKENS:
      return computeSlippageMapForWeightedPool2Tokens(balancerPoolConfig, dataLine, indexFrom, indexTo);
  }
}

function computeSlippageMapForComposableStablePool(
  balancerPoolConfig: BalancerPoolConfiguration,
  dataLine: string,
  indexFrom: number,
  indexTo: number
): BlockData {
  /* example line for a metastable pool:
    blocknumber,ampFactor,fee,rETH_balance,rETH_scale,WETH_balance,WETH_scale
    19382078,50000,400000000000000,12832601570293918646361,1100122216571627535,14876939679682766068291,1000000000000000000
  */

  const confTokenFrom = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[indexFrom]);
  const confTokenTo = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[indexTo]);

  const split = dataLine.split(',');
  // const blockNumber = Number(split[0]);
  const ampFactor = split[1];
  const fee = split[2];
  const balances: string[] = [];
  const scales: string[] = [];
  for (let i = 3; i < split.length; i += 2) {
    balances.push(split[i]);
    scales.push(split[i + 1]);
  }

  const { pool, poolPairData } = getPoolAndPairDataComposableStable(
    balancerPoolConfig,
    balances,
    scales,
    ampFactor,
    fee,
    confTokenFrom,
    confTokenTo
  );

  let baseAmountIn = baseAmountMap[confTokenFrom.symbol];
  if (!baseAmountIn) {
    baseAmountIn = new BigNumber(10).pow(confTokenFrom.decimals);
  }
  const amountOut = pool._exactTokenInForTokenOut(poolPairData, baseAmountIn);
  const basePrice =
    normalize(amountOut.toString(), confTokenTo.decimals) / normalize(baseAmountIn.toString(), confTokenFrom.decimals);
  const slippageMap: SlippageMap = {};

  let lastAmount = baseAmountIn;
  for (let slippageBps = 50; slippageBps <= 2000; slippageBps += 50) {
    const targetPrice = basePrice - (basePrice * slippageBps) / 10000;
    const liquidityObj = computeLiquidityForSlippageMetaStable(
      balancerPoolConfig,
      baseAmountIn,
      lastAmount,
      targetPrice,
      ampFactor,
      fee,
      balances,
      scales,
      indexFrom,
      confTokenFrom,
      indexTo,
      confTokenTo
    );

    // const checkAmountOut = pool._exactTokenInForTokenOut(poolPairData, liquidityObj.base);
    // const normOut = normalize(checkAmountOut.toString(10), confTokenTo.decimals);
    // console.log({ normOut });
    const liquidityAtSlippage = normalize(liquidityObj.base.toString(10), confTokenFrom.decimals);
    const quoteObtainedAtSlippage = normalize(liquidityObj.quote.toString(10), confTokenTo.decimals);
    // console.log({ quoteObtainedAtSlippage });
    lastAmount = liquidityObj.base;

    slippageMap[slippageBps] = { base: liquidityAtSlippage, quote: quoteObtainedAtSlippage };
  }
  return {
    price: basePrice,
    slippageMap: slippageMap
  };
}

function computeSlippageMapForWeightedPool2Tokens(
  balancerPoolConfig: BalancerPoolConfiguration,
  dataLine: string,
  indexFrom: number,
  indexTo: number
): BlockData {
  /* example line for a weighted pool 2 tokens:
    blocknumber,fee,WBTC_balance,WBTC_weight,WETH_balance,WETH_weight
    16683142,2500000000000000,4943965229,500000000000000000,726967649838511257622,500000000000000000
  */

  const confTokenFrom = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[indexFrom]);
  const confTokenTo = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[indexTo]);

  const split = dataLine.split(',');
  // const blockNumber = Number(split[0]);
  const fee = split[1];
  const balances: string[] = [];
  const weights: string[] = [];
  for (let i = 2; i < split.length; i += 2) {
    balances.push(split[i]);
    weights.push(split[i + 1]);
  }

  const { pool, poolPairData } = getPoolAndPairDataWeighted2Tokens(
    balancerPoolConfig,
    balances,
    weights,
    fee,
    confTokenFrom,
    confTokenTo
  );

  let baseAmountIn = baseAmountMap[confTokenFrom.symbol];
  if (!baseAmountIn) {
    baseAmountIn = new BigNumber(10).pow(confTokenFrom.decimals);
  }
  const amountOut = pool._exactTokenInForTokenOut(poolPairData, baseAmountIn);
  const basePrice =
    normalize(amountOut.toString(), confTokenTo.decimals) / normalize(baseAmountIn.toString(), confTokenFrom.decimals);
  const slippageMap: SlippageMap = {};

  let lastAmount = baseAmountIn;
  for (let slippageBps = 50; slippageBps <= 2000; slippageBps += 50) {
    const targetPrice = basePrice - (basePrice * slippageBps) / 10000;
    const liquidityObj = computeLiquidityForSlippageWeighted2Tokens(
      balancerPoolConfig,
      baseAmountIn,
      lastAmount,
      targetPrice,
      fee,
      balances,
      weights,
      indexFrom,
      confTokenFrom,
      indexTo,
      confTokenTo
    );

    // const checkAmountOut = pool._exactTokenInForTokenOut(poolPairData, liquidityObj.base);
    // const normOut = normalize(checkAmountOut.toString(10), confTokenTo.decimals);
    // console.log({ normOut });
    const liquidityAtSlippage = normalize(liquidityObj.base.toString(10), confTokenFrom.decimals);
    const quoteObtainedAtSlippage = normalize(liquidityObj.quote.toString(10), confTokenTo.decimals);
    // console.log({ quoteObtainedAtSlippage });
    lastAmount = liquidityObj.base;

    slippageMap[slippageBps] = { base: liquidityAtSlippage, quote: quoteObtainedAtSlippage };
  }
  return {
    price: basePrice,
    slippageMap: slippageMap
  };
}

function getPoolAndPairDataComposableStable(
  balancerPoolConfig: BalancerPoolConfiguration,
  balances: string[],
  scales: string[],
  ampFactor: string,
  fee: string,
  confTokenFrom: TokenData,
  confTokenTo: TokenData
) {
  const tokens: { address: string; balance: string; decimals: number; priceRate: string }[] = [];
  const tokenList: string[] = [];
  for (let i = 0; i < balancerPoolConfig.tokenSymbols.length; i++) {
    const confToken = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[i]);
    tokens.push({
      address: confToken.address,
      balance: balances[i],
      decimals: confToken.decimals,
      priceRate: scales[i]
    });

    tokenList.push(confToken.address);
  }

  const normalizedAmpFactor = normalize(ampFactor, MetaStablePool.AMP_DECIMALS).toString();
  const normalizedFees = normalize(fee, 18).toString();

  const pool = new ComposableStablePool(
    balancerPoolConfig.poolId,
    balancerPoolConfig.address,
    normalizedAmpFactor,
    normalizedFees,
    '0',
    tokens,
    tokenList
  );

  const poolPairData = pool.parsePoolPairData(confTokenFrom.address, confTokenTo.address);
  return { pool, poolPairData };
}

function getPoolAndPairDataWeighted2Tokens(
  balancerPoolConfig: BalancerPoolConfiguration,
  balances: string[],
  weights: string[],
  fee: string,
  confTokenFrom: TokenData,
  confTokenTo: TokenData
) {
  const tokens: { address: string; balance: string; decimals: number; weight: string }[] = [];
  const tokenList: string[] = [];
  let totalWeight = new BigNumber(0);
  for (let i = 0; i < balancerPoolConfig.tokenSymbols.length; i++) {
    const confToken = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[i]);
    tokens.push({
      address: confToken.address,
      balance: balances[i],
      decimals: confToken.decimals,
      weight: weights[i]
    });

    totalWeight = totalWeight.plus(new BigNumber(weights[i]));

    tokenList.push(confToken.address);
  }

  const normalizedFees = normalize(fee, 18).toString();

  const pool = new WeightedPool(
    balancerPoolConfig.poolId,
    balancerPoolConfig.address,
    normalizedFees,
    totalWeight.toString(10),
    '0',
    tokens,
    tokenList
  );

  const poolPairData = pool.parsePoolPairData(confTokenFrom.address, confTokenTo.address);
  return { pool, poolPairData };
}

function computeLiquidityForSlippageMetaStable(
  balancerPoolConfig: BalancerPoolConfiguration,
  baseAmountIn: BigNumber,
  baseQty: BigNumber,
  targetPrice: number,
  ampFactor: string,
  fee: string,
  balances: string[],
  scales: string[],
  indexFrom: number,
  confTokenFrom: TokenData,
  indexTo: number,
  confTokenTo: TokenData
): { base: BigNumber; quote: BigNumber } {
  let low = undefined;
  let high = undefined;
  let lowTo = undefined;
  let highTo = undefined;
  let qtyFrom = baseQty.times(2);
  const exitBoundsDiff = 0.1 / 100; // exit binary search when low and high bound have less than this amount difference
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { pool, poolPairData } = getPoolAndPairDataComposableStable(
      balancerPoolConfig,
      balances,
      scales,
      ampFactor,
      fee,
      confTokenFrom,
      confTokenTo
    );

    const qtyTo = pool._exactTokenInForTokenOut(poolPairData, qtyFrom);

    const newBalances: string[] = [];
    for (const balance of balances) {
      newBalances.push(balance);
    }

    // selling i for j mean more i and less j
    newBalances[indexFrom] = new BigNumber(newBalances[indexFrom]).plus(new BigNumber(qtyFrom)).toFixed(6);
    newBalances[indexTo] = new BigNumber(newBalances[indexTo]).minus(new BigNumber(qtyTo)).toFixed(6);

    const newPoolData = getPoolAndPairDataComposableStable(
      balancerPoolConfig,
      newBalances,
      scales,
      ampFactor,
      fee,
      confTokenFrom,
      confTokenTo
    );
    // get the new price for one token
    const newQtyTo = newPoolData.pool._exactTokenInForTokenOut(newPoolData.poolPairData, baseAmountIn);

    const normalizedFrom = normalize(baseAmountIn.toString(), confTokenFrom.decimals);
    const normalizedTo = normalize(newQtyTo.toString(), confTokenTo.decimals);
    const currentPrice = normalizedTo / normalizedFrom;

    const variation = high && low ? high.toNumber() / low.toNumber() - 1 : 0;
    // console.log(
    //   `Qty: [${low ? normalize(low.toString(), 18) : '0'} <-> ${
    //     high ? normalize(high.toString(), 18) : '+∞'
    //   }]. Current price: 1 rETH = ${currentPrice} WETH, targetPrice: ${targetPrice}. Try qty: ${normalizedFrom} rETH = ${normalizedTo} WETH. variation: ${
    //     variation * 100
    //   }%`
    // );
    if (low && high && lowTo && highTo) {
      if (variation < exitBoundsDiff) {
        const base = high.plus(low).div(2);
        const quote = highTo.plus(lowTo).div(2);
        return { base, quote };
      }
    }

    if (currentPrice > targetPrice) {
      // current price too high, must increase qtyFrom
      low = qtyFrom;
      lowTo = qtyTo;
      if (!high) {
        // if high is undefined, just double next try qty
        qtyFrom = qtyFrom.times(2);
      } else {
        qtyFrom = qtyFrom.plus(high.minus(low).div(2));
      }
    } else {
      // current price too low, must decrease qtyFrom
      high = qtyFrom;
      highTo = qtyTo;

      if (!low) {
        // if low is undefined, next try qty = qty / 2
        qtyFrom = qtyFrom.div(2);
      } else {
        qtyFrom = qtyFrom.minus(high.minus(low).div(2));
      }
    }
  }
}

function computeLiquidityForSlippageWeighted2Tokens(
  balancerPoolConfig: BalancerPoolConfiguration,
  baseAmountIn: BigNumber,
  baseQty: BigNumber,
  targetPrice: number,
  fee: string,
  balances: string[],
  weights: string[],
  indexFrom: number,
  confTokenFrom: TokenData,
  indexTo: number,
  confTokenTo: TokenData
): { base: BigNumber; quote: BigNumber } {
  let low = undefined;
  let high = undefined;
  let lowTo = undefined;
  let highTo = undefined;
  let qtyFrom = baseQty.times(2);
  const exitBoundsDiff = 0.1 / 100; // exit binary search when low and high bound have less than this amount difference
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { pool, poolPairData } = getPoolAndPairDataWeighted2Tokens(
      balancerPoolConfig,
      balances,
      weights,
      fee,
      confTokenFrom,
      confTokenTo
    );

    const qtyTo = pool._exactTokenInForTokenOut(poolPairData, qtyFrom);

    const newBalances: string[] = [];
    for (const balance of balances) {
      newBalances.push(balance);
    }

    // selling i for j mean more i and less j
    newBalances[indexFrom] = new BigNumber(newBalances[indexFrom]).plus(new BigNumber(qtyFrom)).toFixed(6);
    newBalances[indexTo] = new BigNumber(newBalances[indexTo]).minus(new BigNumber(qtyTo)).toFixed(6);

    const newPoolData = getPoolAndPairDataWeighted2Tokens(
      balancerPoolConfig,
      newBalances,
      weights,
      fee,
      confTokenFrom,
      confTokenTo
    );
    // get the new price for one token
    const newQtyTo = newPoolData.pool._exactTokenInForTokenOut(newPoolData.poolPairData, baseAmountIn);

    const normalizedFrom = normalize(baseAmountIn.toString(), confTokenFrom.decimals);
    const normalizedTo = normalize(newQtyTo.toString(), confTokenTo.decimals);
    const currentPrice = normalizedTo / normalizedFrom;

    const variation = high && low ? high.toNumber() / low.toNumber() - 1 : 0;
    // console.log(
    //   `Qty: [${low ? normalize(low.toString(), 18) : '0'} <-> ${
    //     high ? normalize(high.toString(), 18) : '+∞'
    //   }]. Current price: 1 rETH = ${currentPrice} WETH, targetPrice: ${targetPrice}. Try qty: ${normalizedFrom} rETH = ${normalizedTo} WETH. variation: ${
    //     variation * 100
    //   }%`
    // );
    if (low && high && lowTo && highTo) {
      if (variation < exitBoundsDiff) {
        const base = high.plus(low).div(2);
        const quote = highTo.plus(lowTo).div(2);
        return { base, quote };
      }
    }

    if (currentPrice > targetPrice) {
      // current price too high, must increase qtyFrom
      low = qtyFrom;
      lowTo = qtyTo;
      if (!high) {
        // if high is undefined, just double next try qty
        qtyFrom = qtyFrom.times(2);
      } else {
        qtyFrom = qtyFrom.plus(high.minus(low).div(2));
      }
    } else {
      // current price too low, must decrease qtyFrom
      high = qtyFrom;
      highTo = qtyTo;

      if (!low) {
        // if low is undefined, next try qty = qty / 2
        qtyFrom = qtyFrom.div(2);
      } else {
        qtyFrom = qtyFrom.minus(high.minus(low).div(2));
      }
    }
  }
}

function debugMetaStable() {
  const line =
    '19382278,50000,400000000000000,12832620643215285273092,1100122216571627535,14876918683946300279941,1000000000000000000';
  const cfg: BalancerPoolConfiguration = {
    name: 'Balancer-rETH-Stable-Pool',
    deployBlock: 13846138,
    address: '0x1E19CF2D73a72Ef1332C882F20534B6519Be0276',
    poolId: '0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112',
    type: BalancerPoolTypeEnum.META_STABLE_POOL,
    tokenSymbols: ['rETH', 'WETH'],
    tokenIndexes: [0, 1]
  };
  const result = computeSlippageMapForComposableStablePool(cfg, line, 1, 0);
  console.log(result);
}
// debugMetaStable();

function debugWeightedPoolTwoTokens() {
  const line = '16683142,2500000000000000,4943965229,500000000000000000,726967649838511257622,500000000000000000';
  const cfg: BalancerPoolConfiguration = {
    name: 'Balancer-50-WBTC-50-WETH',
    deployBlock: 12368025,
    address: '0xa6f548df93de924d73be7d25dc02554c6bd66db5',
    poolId: '0xa6f548df93de924d73be7d25dc02554c6bd66db500020000000000000000000e',
    type: BalancerPoolTypeEnum.WEIGHTED_POOL_2_TOKENS,
    tokenSymbols: ['WBTC', 'WETH'],
    tokenIndexes: [0, 1]
  };

  const result = computeSlippageMapForBalancerPool(cfg, line, 0, 1);
  console.log(result);
}

// debugWeightedPoolTwoTokens();
