import { MetaStablePool } from '@balancer-labs/sor';
import { UnifiedData } from '../models/datainterface/UnifiedData';
import { getConfTokenBySymbol } from '../utils/Utils';
import { BalancerPoolConfiguration, BalancerPoolTypeEnum } from '../workers/configuration/WorkerConfiguration';
import BigNumber from 'bignumber.js';

export function computeSlippageMapForBalancerPool(
  balancerPoolConfig: BalancerPoolConfiguration,
  dataLine: string,
  indexFrom: number,
  indexTo: number
): UnifiedData {
  switch (balancerPoolConfig.type) {
    default:
      throw new Error(`Unknown type: ${balancerPoolConfig.type}`);
    case BalancerPoolTypeEnum.META_STABLE_POOL:
      return computeSlippageMapForMetaStablePool(balancerPoolConfig, dataLine, indexFrom, indexTo);
  }
}

function computeSlippageMapForMetaStablePool(
  balancerPoolConfig: BalancerPoolConfiguration,
  dataLine: string,
  indexFrom: number,
  indexTo: number
): UnifiedData {
  /* example line for a metastable pool:
    blocknumber,ampFactor,rETH_balance,rETH_scale,WETH_balance,WETH_scale
    16670778,50000,15145080991001155170056,1059447380272712939,29144285930602955529639,1000000000000000000
  */

  const confTokenFrom = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[indexFrom]);
  const confTokenTo = getConfTokenBySymbol(balancerPoolConfig.tokenSymbols[indexTo]);

  const split = dataLine.split(',');
  const blockNumber = Number(split[0]);
  const ampFactor = split[1];
  const balances: string[] = [];
  const scales: string[] = [];
  for (let i = 2; i < split.length; i += 2) {
    balances.push(split[i]);
    scales.push(split[i + 1]);
  }

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

  const pool = new MetaStablePool(
    balancerPoolConfig.poolId,
    balancerPoolConfig.address,
    ampFactor,
    '0',
    '0',
    tokens,
    tokenList
  );

  const poolPairData = pool.parsePoolPairData(confTokenFrom.address, confTokenTo.address);

  const baseAmountIn = new BigNumber(10).pow(confTokenFrom.decimals);
  const amountOut = pool._exactTokenInForTokenOut(poolPairData, baseAmountIn);
  const basePrice = amountOut.div(new BigNumber(10).pow(confTokenTo.decimals)).toNumber();

  return {
    price: basePrice,
    slippageMap: {}
  };
}

const line = '16670778,50000,15145080991001155170056,1059447380272712939,29144285930602955529639,1000000000000000000';
const cfg: BalancerPoolConfiguration = {
  name: 'Balancer-rETH-Stable-Pool',
  deployBlock: 13846138,
  address: '0x1E19CF2D73a72Ef1332C882F20534B6519Be0276',
  poolId: '0x1e19cf2d73a72ef1332c882f20534b6519be0276000200000000000000000112',
  type: BalancerPoolTypeEnum.META_STABLE_POOL,
  tokenSymbols: ['rETH', 'WETH'],
  tokenIndexes: [0, 1]
};

computeSlippageMapForMetaStablePool(cfg, line, 0, 1);
