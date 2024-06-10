import BigNumber from 'bignumber.js';
import { MerchantMoeBin, MerchantMoeV2PoolData, SlippageMap } from '../models/datainterface/BlockData';
import { TokenData } from '../workers/configuration/TokenData';
import { MerchantMoeV2Constants } from '../workers/fetchers/merchantmoe/MerchantMoeV2Constants';

export class MerchantMoeV2Library {
  static findLiquidityDepth(
    currentBin: number,
    binStep: number,
    bins: { [binId: number]: MerchantMoeBin },
    token0Decimals: number,
    token1Decimals: number
  ) {
    const result: SlippageMap = {};
    const decimal0Factor = new BigNumber(10).pow(token0Decimals);
    const decimal1Factor = new BigNumber(10).pow(token1Decimals);

    // store tick [tickNumber]: slippageBps
    const relevantTicks: { [tick: number]: number } = {};
    for (
      let slippageBps = 50;
      slippageBps <= MerchantMoeV2Constants.CONSTANT_TARGET_SLIPPAGE * 100;
      slippageBps += 50
    ) {
      const ids = this.getIds(slippageBps, currentBin, binStep);
      const [binReservesX, binReservesY] = this.getAllReserves(ids, bins);
    }

    return result;
  }

  static getIds(percentDepth: number, currentBin: number, BinStep: number): number[] {
    /*
        Example: for bin_step = 10 to lower a price by 2%, active bin needs to be moved by 20 bins:
        1) clearing active bin liqudity
        2) trading away 19 bins below
        3) trade at least 1 token from next bin - this will be ignored
        So in this case, there will be 39 bins taken into consideration
        For case bin step = 15 bins amount gets rounded up
        */

    const binsToMovePrice: number = Math.ceil(percentDepth / BinStep);

    const startBin: number = currentBin - binsToMovePrice + 1;
    const endBin: number = currentBin + binsToMovePrice;

    const ids: number[] = [];
    for (let binId = startBin; binId < endBin; binId++) {
      ids.push(binId);
    }
    return ids;
  }

  static getAllReserves(ids: number[], bins: { [binId: number]: MerchantMoeBin }): [number[], number[]] {
    const binReservesX: number[] = [];
    const binReservesY: number[] = [];

    for (const id of ids) {
      const [reserveX, reserveY]: [BigNumber, BigNumber] = MerchantMoeV2Library.getBinValues(id, bins);
      binReservesX.push(reserveX.toNumber());
      binReservesY.push(reserveY.toNumber());
    }

    return [binReservesX, binReservesY];
  }

  static getBinValues(id: number, bins: { [binId: number]: MerchantMoeBin }): [BigNumber, BigNumber] {
    const tokenXLiquidity = bins[id].tokenX;
    const tokenYLiquidity = bins[id].tokenY;
    return [tokenXLiquidity, tokenYLiquidity];
  }

  static getPriceNormalized(currentBin: number, binStep: number, token0Decimals: number, token1Decimals: number) {
    const token0DecimalFactor = 10 ** token0Decimals;
    const token1DecimalFactor = 10 ** token1Decimals;
    const price = MerchantMoeV2Library.getBinPrice(currentBin, binStep);
    const priceToken0VsToken1 = (price * token0DecimalFactor) / token1DecimalFactor;
    return priceToken0VsToken1;
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
    token0Decimals: number,
    token1Decimals: number
  ) {
    const [token0Slippage, token1Slippage] = MerchantMoeV2Library.findLiquidityDepth(
      currentBin,
      BinStep,
      bins,
      token0Decimals,
      token1Decimals
    );

    return { token0Slippage, token1Slippage };
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
    token0: TokenData,
    token1: TokenData,
    latestData: MerchantMoeV2PoolData,
    token0Symbol: string,
    token1Symbol: string
  ): string {
    // Compute token0->token1 price
    const p0 = MerchantMoeV2Library.getPriceNormalized(
      latestData.currentBin,
      latestData.binStep,
      token0.decimals,
      token1.decimals
    );

    const slippages = MerchantMoeV2Library.getSlippages(
      latestData.currentBin,
      latestData.binStep,
      latestData.bins,
      token0.decimals,
      token1.decimals
    );

    const saveValue = {
      p0vs1: p0,
      p1vs0: 1 / p0,
      [token0Symbol + '-slippagemap']: slippages.token0Slippage,
      [token1Symbol + '-slippagemap']: slippages.token1Slippage
    };

    latestData.lastDataSave = latestData.blockNumber;
    return `${latestData.blockNumber},${JSON.stringify(saveValue)}\n`;
  }
}
