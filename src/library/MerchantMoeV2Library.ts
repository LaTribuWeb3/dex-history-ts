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
      /// computing for token X
      //// I'm selling X for Y, I need to get the Y bins to see how much Y I can buy
      let totalXDumpable = 0;
      let totalYObtained = 0;
      for (let binId = currentBin; binId >= currentBin - slippageBps / binStep; binId--) {
        if (bins[binId]) {
          const binReserve = bins[binId];
          const amountYAvailable = binReserve.tokenY;
          const binPrice = this.getPriceNormalized(binId, binStep, tokenX.decimals, tokenY.decimals);
          const dumpableAmountOfX = amountYAvailable / binPrice;
          totalXDumpable += dumpableAmountOfX;
          totalYObtained += amountYAvailable;
        }
      }
      tokenXSlippageMap[slippageBps] = {
        base: totalXDumpable,
        quote: totalYObtained
      };
    }
    for (
      let slippageBps = 50;
      slippageBps <= MerchantMoeV2Constants.CONSTANT_TARGET_SLIPPAGE * 100;
      slippageBps += 50
    ) {
      /// computing for token Y
      //// I'm selling Y for X, I need to get the X bins to see how much Y I can buy
      let totalYDumpable = 0;
      let totalXObtained = 0;
      for (let binId = currentBin; binId <= currentBin + slippageBps / binStep; binId++) {
        if (bins[binId]) {
          const binReserve = bins[binId];
          const amountXAvailable = binReserve.tokenX;
          const binPrice = this.getPriceNormalized(binId, binStep, tokenX.decimals, tokenY.decimals);
          const dumpableAmountOfY = amountXAvailable * binPrice;
          totalYDumpable += dumpableAmountOfY;
          totalXObtained += amountXAvailable;
        }
      }
      tokenYSlippageMap[slippageBps] = {
        base: totalYDumpable,
        quote: totalXObtained
      };
    }

    return [tokenXSlippageMap, tokenYSlippageMap];
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
