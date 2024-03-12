import BigNumber from 'bignumber.js';
import { BlockWithTick, SlippageMap } from '../models/datainterface/BlockData';
import { TokenData } from '../workers/configuration/TokenData';
import { UniswapV3Constants } from '../workers/fetchers/uniswapv3/UniswapV3Constants';

export class Uniswapv3Library {
  static GetAmountYDumpable(
    currentTick: number,
    tickSpacing: number,
    liquidities: { [tick: number]: number },
    token0Decimals: number,
    token1Decimals: number,
    sqrtPriceX96: string
  ) {
    /**
     * @param {number} currentTick
     * @param {number} tickSpacing
     * @param {{[tick: number]: number}} liquidities
     * @param {number} tokenDecimals
     * @param {string} sqrtPriceX96
     * @returns {[slippageBps: number]: number}
     */
    const result: SlippageMap = {};
    const _96bits = new BigNumber(2).pow(new BigNumber(96));
    const sqrtP = new BigNumber(sqrtPriceX96).div(_96bits);
    const P = sqrtP.times(sqrtP).toNumber();
    const decimal0Factor = new BigNumber(10).pow(token0Decimals);
    const decimal1Factor = new BigNumber(10).pow(token1Decimals);

    let workingTick = Uniswapv3Library.getNextLowerTick(currentTick, tickSpacing);
    let totalX = 0;
    let totalY = 0;

    // store tick [tickNumber]: slippageBps
    const relevantTicks: { [tick: number]: number } = {};
    for (let slippageBps = 50; slippageBps <= UniswapV3Constants.CONSTANT_TARGET_SLIPPAGE * 100; slippageBps += 50) {
      const targetPrice = (P * (10000 + slippageBps)) / 10000;
      const targetPriceTick = Uniswapv3Library.getTickForPrice(targetPrice);
      const spacingTargetPriceTick = Uniswapv3Library.getNextLowerTick(targetPriceTick, tickSpacing);
      if (!relevantTicks[spacingTargetPriceTick] && spacingTargetPriceTick > workingTick) {
        relevantTicks[spacingTargetPriceTick] = slippageBps;
      }
    }

    const maxTarget = Math.max(...Object.keys(relevantTicks).map((_) => Number(_)));

    while (workingTick <= maxTarget) {
      const L = new BigNumber(liquidities[workingTick]).times(UniswapV3Constants.CONSTANT_1e18);

      // if (workingTick === 760) {
      //   console.log('L = new BigNumber(liquidities[workingTick]).times(CONSTANT_1e18)');
      //   console.log(`${L} = new BigNumber(${liquidities[workingTick]}).times(${UniswapV3Constants.CONSTANT_1e18})`);
      // }

      if (!L.isNaN()) {
        // pa = lower bound price range
        const lowerBoundTick = Uniswapv3Library.getNextLowerTick(workingTick, tickSpacing);
        const pa = Uniswapv3Library.getTickPrice(lowerBoundTick);
        const sqrtPa = Math.sqrt(pa);
        // pb = upper bound price range
        const upperBoundTick = lowerBoundTick + Number(tickSpacing);
        const pb = Uniswapv3Library.getTickPrice(upperBoundTick);
        const sqrtPb = Math.sqrt(pb);
        let xLiquidityInTick = new BigNumber(0);

        // Assuming P ≤ pa, the position is fully in X, so y = 0
        if (P <= pa) {
          const x = L.times(sqrtPb - sqrtPa).div(sqrtPa * sqrtPb);
          xLiquidityInTick = x;
        }
        // Assuming P ≥ pb, the position is fully in Y , so x = 0:
        else if (P >= pb) {
          // We want X so don't care for this case
        }
        // If the current price is in the range: pa < P < pb. mix of x and y
        else {
          const x = L.times(sqrtPb - sqrtP.toNumber()).div(sqrtP.toNumber() * sqrtPb);
          // if (workingTick === 760) {
          //   console.log('Adding x = L x (sqrtPb - sqrtP) / (sqrtP * sqrtPb) to xLiquidityInTick');
          //   console.log(`Adding ${x} = ${L} x (${sqrtPb} - ${sqrtP})  / (${sqrtP} * ${sqrtPb}) to ${xLiquidityInTick}`);
          // }
          xLiquidityInTick = x;
        }

        // here we have the amount of X liquidity in the tick
        // we can compute how much Y we have to sell to buy this liquidity
        const yAmountToSell = xLiquidityInTick.div(decimal1Factor).toNumber() * pa;
        totalX += xLiquidityInTick.div(decimal0Factor).toNumber();
        totalY += yAmountToSell;

        // if (workingTick === 760) {
        //   console.log(
        //     `[${workingTick}]: liquidity at tick: ${xLiquidityInTick} x. Sold ${yAmountToSell} y to buy it all. New total sold: ${totalY}`
        //   );
        // }

        if (relevantTicks[workingTick]) {
          result[relevantTicks[workingTick]] = { base: totalY, quote: totalX };
          // result[relevantTicks[workingTick]] = {
          //     totalXAvailable: totalX,
          //     totalYToSell: totalY,
          // };
        }
      }

      workingTick += Number(tickSpacing);
    }

    return result;
  }

  static GetAmountXDumpable(
    currentTick: number,
    tickSpacing: number,
    liquidities: { [tick: number]: number },
    token0Decimals: number,
    token1Decimals: number,
    sqrtPriceX96: string
  ) {
    const result: SlippageMap = {};
    const _96bits = new BigNumber(2).pow(new BigNumber(96));
    const sqrtP = new BigNumber(sqrtPriceX96).div(_96bits);
    const P = sqrtP.times(sqrtP).toNumber();
    const decimal0Factor = new BigNumber(10).pow(token0Decimals);
    const decimal1Factor = new BigNumber(10).pow(token1Decimals);

    let workingTick = Uniswapv3Library.getNextLowerTick(Number(currentTick), tickSpacing);
    let totalY = 0;
    let totalX = 0;

    // store tick [tickNumber]: slippageBps
    const relevantTicks: { [tick: number]: number } = {};
    for (let slippageBps = 50; slippageBps <= UniswapV3Constants.CONSTANT_TARGET_SLIPPAGE * 100; slippageBps += 50) {
      const targetPrice = P * ((10000 - slippageBps) / 10000);
      const targetPriceTick = Uniswapv3Library.getTickForPrice(targetPrice);
      const spacingTargetPriceTick = Uniswapv3Library.getNextLowerTick(targetPriceTick, tickSpacing);
      if (!relevantTicks[spacingTargetPriceTick] && spacingTargetPriceTick < workingTick) {
        relevantTicks[spacingTargetPriceTick] = slippageBps;
      }
    }

    const minTarget = Math.min(...Object.keys(relevantTicks).map((_) => Number(_)));

    while (workingTick >= minTarget) {
      const L = new BigNumber(liquidities[workingTick]).times(UniswapV3Constants.CONSTANT_1e18);
      if (!L.isNaN()) {
        // pa = lower bound price range
        const lowerBoundTick = Uniswapv3Library.getNextLowerTick(workingTick, tickSpacing);
        const pa = Uniswapv3Library.getTickPrice(lowerBoundTick);
        const sqrtPa = Math.sqrt(pa);
        // pb = upper bound price range
        const upperBoundTick = lowerBoundTick + tickSpacing;
        const pb = Uniswapv3Library.getTickPrice(upperBoundTick);
        const sqrtPb = Math.sqrt(pb);
        let yLiquidityInTick = new BigNumber(0);

        // Assuming P ≤ pa, the position is fully in X, so y = 0
        if (P <= pa) {
          // We want X so don't care for this case
        }
        // Assuming P ≥ pb, the position is fully in Y , so x = 0:
        else if (P >= pb) {
          const y = L.times(sqrtPb - sqrtPa);
          // if (workingTick === 760) {
          //   console.log('Adding y = L x (sqrtPb - sqrtPa) to yLiquidityInTick');
          //   console.log(`Adding ${y} = ${L} x (${sqrtPb} - ${sqrtPa}) to ${yLiquidityInTick}`);
          // }
          yLiquidityInTick = y;
        }
        // If the current price is in the range: pa < P < pb. mix of x and y
        else {
          const sqrtPminusSqrtPa = sqrtP.toNumber() - sqrtPa;
          const y = L.times(sqrtPminusSqrtPa);
          // if (workingTick === 760) {
          //   console.log('Adding y = L x (sqrtP - sqrtPa) to yLiquidityInTick');
          //   console.log(`Adding ${y} = ${L} x (${sqrtP} - ${sqrtPa}) to ${yLiquidityInTick}`);
          // }
          /* Something weird is happening here */
          yLiquidityInTick = y;
        }

        // here we have the amount of Y liquidity in the tick
        // we can compute how much X we have to sell to buy this liquidity
        const xAmountToSell = yLiquidityInTick.div(decimal0Factor).toNumber() / pa;
        totalX += xAmountToSell;
        totalY += yLiquidityInTick.div(decimal1Factor).toNumber();
        // if (workingTick === 760) {
        //   console.log(
        //     `[${workingTick}]: liquidity at tick: ${yLiquidityInTick} y. Sold ${xAmountToSell} x to buy it all. New total sold: ${totalX}`
        //   );
        // }
        if (relevantTicks[workingTick]) {
          result[relevantTicks[workingTick]] = { base: totalX, quote: totalY };
          // result[relevantTicks[workingTick]] = {
          //     totalYAvailable: totalY,
          //     totalXToSell: totalX,
          // };
        }
      }

      workingTick -= Number(tickSpacing);
    }

    return result;
  }

  static getNextLowerTick(currentTick: number, tickSpacing: number): number {
    return Math.floor(Number(currentTick) / Number(tickSpacing)) * Number(tickSpacing);
  }

  static getPriceNormalized(currentTick: number, token0Decimals: number, token1Decimals: number) {
    const token0DecimalFactor = 10 ** token0Decimals;
    const token1DecimalFactor = 10 ** token1Decimals;
    const price = Uniswapv3Library.getTickPrice(Number(currentTick));
    const priceToken0VsToken1 = (price * token0DecimalFactor) / token1DecimalFactor;
    return priceToken0VsToken1;
  }

  static getTickPrice(tick: number) {
    return 1.0001 ** tick;
  }

  static getTickForPrice(price: number) {
    // price = 1.0001 ^ tick
    // tick = ln(price) / ln(1.0001)
    return Math.log(price) / Math.log(1.0001);
  }

  static getSlippages(
    currentTick: number,
    tickSpacing: number,
    sqrtPriceX96: string,
    liquidity: { [tick: number]: number },
    token0Decimals: number,
    token1Decimals: number
  ) {
    const token0Slippage = Uniswapv3Library.GetAmountXDumpable(
      currentTick,
      tickSpacing,
      liquidity,
      token0Decimals,
      token1Decimals,
      sqrtPriceX96
    );

    const token1Slippage = Uniswapv3Library.GetAmountYDumpable(
      currentTick,
      tickSpacing,
      liquidity,
      token0Decimals,
      token1Decimals,
      sqrtPriceX96
    );

    return { token0Slippage, token1Slippage };
  }

  static updateLatestDataLiquidity(
    latestData: BlockWithTick,
    blockNumber: number,
    tickLower: number,
    tickUpper: number,
    amount: BigNumber
  ) {
    // console.log(`Adding ${amount} from ${tickLower} to ${tickUpper}`);
    const amountNorm = amount.div(UniswapV3Constants.CONSTANT_1e18).toNumber();

    if (blockNumber == 17853406) {
      console.log(`before: ${latestData.ticks[760]}`);
    }

    for (let tick = Number(tickLower); tick < tickUpper; tick += Number(latestData.tickSpacing)) {
      if (!latestData.ticks[tick]) {
        latestData.ticks[tick] = 0;
      }

      // always add because for burn events, amount value will be < 0
      latestData.ticks[tick] += amountNorm;
    }

    if (blockNumber == 17853406) {
      console.log(`after: ${latestData.ticks[760]}`);
    }

    latestData.blockNumber = blockNumber;
  }

  static getSaveDataFromLatestData(
    token0: TokenData,
    token1: TokenData,
    latestData: BlockWithTick,
    token0Symbol: string,
    token1Symbol: string
  ): string {
    // Compute token0->token1 price
    const p0 = Uniswapv3Library.getPriceNormalized(latestData.currentTick, token0.decimals, token1.decimals);

    const slippages = Uniswapv3Library.getSlippages(
      latestData.currentTick,
      latestData.tickSpacing,
      latestData.currentSqrtPriceX96,
      latestData.ticks,
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
