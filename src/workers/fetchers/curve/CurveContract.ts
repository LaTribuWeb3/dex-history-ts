import * as ethers from 'ethers';
import { TypedContractMethod } from 'ethers-multicall-provider/lib/types/common';
import {
  CryptoV2,
  CryptoV2__factory,
  CurvePool,
  CurvePool__factory,
  StableSwap,
  StableSwapFactory,
  StableSwapFactory__factory,
  StableSwap__factory,
  SusDCurve,
  SusDCurve__factory,
  TriCryptoFactory,
  TriCryptoFactory__factory,
  TriCryptoV2,
  TriCryptoV2__factory
} from '../../../contracts/types';
import { CurvePairConfiguration } from '../../configuration/WorkerConfiguration';

export interface CurveContract extends ethers.BaseContract {
  A: TypedContractMethod<[], [bigint], 'view'>;
  gamma?: TypedContractMethod<[], [bigint], 'view'>;
  D?: TypedContractMethod<[], [bigint], 'view'>;
  balances?: TypedContractMethod<[arg0: ethers.BigNumberish], [bigint], 'view'>;
  price_scale?:
    | TypedContractMethod<[k?: ethers.BigNumberish], [bigint], 'view'>
    | TypedContractMethod<[], [bigint], 'view'>;
}

export class CurveUtils {
  static getCurveContract(
    fetchConfig: CurvePairConfiguration,
    web3Provider: ethers.JsonRpcProvider
  ): StableSwap | StableSwapFactory | CurvePool | SusDCurve | TriCryptoV2 | TriCryptoFactory | CryptoV2 {
    const abi = fetchConfig.abi;
    return CurveUtils.getCurveContractFromABIAsString(abi, fetchConfig.poolAddress, web3Provider);
  }

  static getCurveContractFromABIAsString(
    abi: string,
    poolAddress: string,
    web3Provider: ethers.ethers.JsonRpcProvider
  ) {
    switch (abi.toLowerCase()) {
      case 'stableswap':
        return StableSwap__factory.connect(poolAddress, web3Provider);
      case 'stableswapfactory':
        return StableSwapFactory__factory.connect(poolAddress, web3Provider);
      case 'curvepool':
        return CurvePool__factory.connect(poolAddress, web3Provider);
      case 'susdpool':
      case 'susdcurvepool':
        return SusDCurve__factory.connect(poolAddress, web3Provider);
      case 'tricryptov2':
        return TriCryptoV2__factory.connect(poolAddress, web3Provider);
      case 'tricryptov2factory':
      case 'tricryptofactory':
        return TriCryptoFactory__factory.connect(poolAddress, web3Provider);
      case 'cryptov2':
        return CryptoV2__factory.connect(poolAddress, web3Provider);
      default:
        throw new Error(`Unknown abi: ${abi}`);
    }
  }

  static getCurveTopics(
    curveContract: ethers.BaseContract,
    fetchConfig: CurvePairConfiguration
  ): Promise<ethers.ethers.TopicFilter>[] {
    switch (fetchConfig.abi.toLowerCase()) {
      case 'stableswap':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.TokenExchangeUnderlying().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.RampA().getTopicFilter(),
          curveContract.filters.StopRampA().getTopicFilter()
        ];
      case 'stableswapfactory':
        return [
          curveContract.filters.Transfer().getTopicFilter(),
          curveContract.filters.Approval().getTopicFilter(),
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.RampA().getTopicFilter()
        ];
      case 'curvepool':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.RampA().getTopicFilter(),
          curveContract.filters.StopRampA().getTopicFilter()
        ];
      case 'susdpool':
      case 'susdcurvepool':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.TokenExchangeUnderlying().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityImbalance().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter()
        ];
      case 'tricryptov2':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter(),
          curveContract.filters.RampAgamma().getTopicFilter()
        ];
      case 'tricryptov2factory':
      case 'tricryptofactory':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter(),
          curveContract.filters.RampAgamma().getTopicFilter()
        ];
      case 'cryptov2':
        return [
          curveContract.filters.TokenExchange().getTopicFilter(),
          curveContract.filters.AddLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidity().getTopicFilter(),
          curveContract.filters.RemoveLiquidityOne().getTopicFilter(),
          curveContract.filters.NewParameters().getTopicFilter(),
          curveContract.filters.CommitNewParameters().getTopicFilter(),
          curveContract.filters.RampAgamma().getTopicFilter()
        ];
      default:
        throw new Error(`Unknown abi: ${fetchConfig.abi}`);
    }
  }
}
