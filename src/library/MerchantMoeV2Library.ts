import { MerchantMoeBin, MerchantMoeV2PoolData, SlippageMap } from '../models/datainterface/BlockData';
import { TokenData } from '../workers/configuration/TokenData';
import { MerchantMoeV2Constants } from '../workers/fetchers/merchantmoe/MerchantMoeV2Constants';
import { normalize } from '../utils/Utils';

export class MerchantMoeV2Library {
  static getLiquidityDepth(
    currentBin: number,
    binStep: number,
    bins: { [binId: number]: MerchantMoeBin },
    tokenX: TokenData,
    tokenY: TokenData
  ) {
    const tokenXSlippageMap: SlippageMap = {};
    const tokenYSlippageMap: SlippageMap = {};

    for (
      let slippageBps = 50;
      slippageBps <= MerchantMoeV2Constants.CONSTANT_TARGET_SLIPPAGE * 100;
      slippageBps += 50
    ) {
      const tokenXIds = this.getTokenXIds(slippageBps, currentBin, binStep);
      const tokenYIds = this.getTokenYIds(slippageBps, currentBin, binStep);

      /// computing for token X
      const [binReservesXForX, binReservesYForX] = this.getAllReserves(tokenXIds, bins);
      const tokenXacc = binReservesXForX.reduce((acc, value) => {
        return acc + value;
      }, 0);
      let tokenYacc = 0;
      for (let i = 0; i < tokenXIds.length; i++) {
        const tokenYPrice = this.getPriceNormalized(tokenXIds[i], binStep, tokenX.decimals, tokenY.decimals);
        tokenYacc += binReservesYForX[i] / tokenYPrice;
      }
      tokenXSlippageMap[slippageBps] = {
        base: tokenXacc,
        quote: tokenYacc
      };
      /// computing for token Y
      const [binReservesXForY, binReservesYForY] = this.getAllReserves(tokenXIds, bins);
      const tokenYAccumulator = binReservesYForY.reduce((acc, value) => {
        return acc + value;
      }, 0);
      let tokenXAccumulator = 0;
      for (let i = 0; i < tokenXIds.length; i++) {
        const tokenXPrice = this.getPriceNormalized(tokenYIds[i], binStep, tokenX.decimals, tokenY.decimals);
        tokenXAccumulator += binReservesXForY[i] * tokenXPrice;
      }
      tokenYSlippageMap[slippageBps] = {
        base: tokenYAccumulator,
        quote: tokenXAccumulator
      };
    }

    return [tokenXSlippageMap, tokenYSlippageMap];
  }

  static getTokenXIds(percentDepth: number, currentBin: number, BinStep: number): number[] {
    const binsToMovePrice: number = Math.ceil(percentDepth / BinStep);

    const startBin: number = currentBin;
    const endBin: number = currentBin + binsToMovePrice;

    const ids: number[] = [];
    for (let binId = startBin; binId < endBin; binId++) {
      ids.push(binId);
    }
    return ids;
  }

  static getTokenYIds(percentDepth: number, currentBin: number, BinStep: number): number[] {
    const binsToMovePrice: number = Math.ceil(percentDepth / BinStep);

    const startBin: number = currentBin;
    const endBin: number = currentBin - binsToMovePrice;

    const ids: number[] = [];
    for (let binId = startBin; binId < endBin; binId++) {
      ids.push(binId);
    }
    return ids;
  }

  static decodeAmounts(amounts: string, tokenX: TokenData, tokenY: TokenData) {
    const amountsBigInt = BigInt(amounts);
    // Read the right 128 bits of the 256 bits
    const amountsX = amountsBigInt & (BigInt(2) ** BigInt(128) - BigInt(1));
    // Read the left 128 bits of the 256 bits
    const amountsY = amountsBigInt >> BigInt(128);
    const tokenXNormalized = normalize(amountsX.toString(10), tokenX.decimals);
    const tokenYNormalized = normalize(amountsY.toString(10), tokenY.decimals);
    return { tokenXNormalized, tokenYNormalized };
  }

  static getAllReserves(ids: number[], bins: { [binId: number]: MerchantMoeBin }): [number[], number[]] {
    const binReservesX: number[] = [];
    const binReservesY: number[] = [];

    for (const id of ids) {
      const [reserveX, reserveY]: [number, number] = MerchantMoeV2Library.getBinValues(id, bins);
      binReservesX.push(reserveX);
      binReservesY.push(reserveY);
    }

    return [binReservesX, binReservesY];
  }

  static getBinValues(id: number, bins: { [binId: number]: MerchantMoeBin }): [number, number] {
    let tokenXLiquidity = 0;
    let tokenYLiquidity = 0;
    if (bins[id] && bins[id].tokenX) {
      tokenXLiquidity = bins[id].tokenX;
    }
    if (bins[id] && bins[id].tokenX) {
      tokenYLiquidity = bins[id].tokenY;
    }
    return [tokenXLiquidity, tokenYLiquidity];
  }

  static getPriceNormalized(currentBin: number, binStep: number, tokenXDecimals: number, tokenYDecimals: number) {
    const tokenXDecimalFactor = 10 ** tokenXDecimals;
    const tokenYDecimalFactor = 10 ** tokenYDecimals;
    const price = MerchantMoeV2Library.getBinPrice(currentBin, binStep);
    const pricetokenXVstokenY = (price * tokenXDecimalFactor) / tokenYDecimalFactor;
    return pricetokenXVstokenY;
  }

  static getBinPrice(bin: number, binStep: number) {
    return (1 + binStep / 10_000) ** (bin - 8388608);
  }

  //   static getTickForPrice(price: number) {
  //     // price = 1.0001 ^ tick
  //     // tick = ln(price) / ln(1.0001)
  //     return Math.log(price) / Math.log(1.0001);
  //   }

  static getSlippages(
    currentBin: number,
    BinStep: number,
    bins: { [binId: number]: MerchantMoeBin },
    tokenX: TokenData,
    tokenY: TokenData
  ) {
    const [tokenXSlippageMap, tokenYSlippageMap] = MerchantMoeV2Library.getLiquidityDepth(
      currentBin,
      BinStep,
      bins,
      tokenX,
      tokenY
    );

    return { tokenXSlippageMap, tokenYSlippageMap };
  }

  //   static updateLatestDataLiquidity(
  //     latestData: BlockWithTick,
  //     blockNumber: number,
  //     tickLower: number,
  //     tickUpper: number,
  //     amount: BigNumber
  //   ) {
  //     // console.log(`Adding ${amount} from ${tickLower} to ${tickUpper}`);
  //     const amountNorm = amount.div(UniswapV3Constants.CONSTANT_1e18).toNumber();

  //     for (let tick = Number(tickLower); tick < tickUpper; tick += Number(latestData.tickSpacing)) {
  //       if (!latestData.ticks[tick]) {
  //         latestData.ticks[tick] = 0;
  //       }

  //       // always add because for burn events, amount value will be < 0
  //       latestData.ticks[tick] += amountNorm;
  //     }

  //     latestData.blockNumber = blockNumber;
  //   }

  static getSaveDataFromLatestData(
    tokenX: TokenData,
    tokenY: TokenData,
    latestData: MerchantMoeV2PoolData,
    tokenXSymbol: string,
    tokenYSymbol: string
  ): string {
    // Compute tokenX->tokenY price
    let p0, slippages;
    if (latestData.currentBin) {
      p0 = MerchantMoeV2Library.getPriceNormalized(
        latestData.currentBin,
        latestData.binStep,
        tokenX.decimals,
        tokenY.decimals
      );

      slippages = MerchantMoeV2Library.getSlippages(
        latestData.currentBin,
        latestData.binStep,
        latestData.bins,
        tokenX,
        tokenY
      );

      const saveValue = {
        p0vs1: p0,
        p1vs0: 1 / p0,
        [tokenXSymbol + '-slippagemap']: slippages.tokenXSlippageMap,
        [tokenYSymbol + '-slippagemap']: slippages.tokenYSlippageMap
      };
      latestData.lastDataSave = latestData.blockNumber;
      return `${latestData.blockNumber},${JSON.stringify(saveValue)}\n`;
    } else {
      return `${latestData.blockNumber},${JSON.stringify('error')}\n`;
    }
  }
}
