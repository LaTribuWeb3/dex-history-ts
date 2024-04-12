import { getConfTokenBySymbol, normalize } from '../utils/Utils';
import { TokenData } from '../workers/configuration/TokenData';

const baseAmountMap: { [token: string]: bigint } = {
  DAI: 1000n * 10n ** 18n, // 1000 DAI ~= 1000$
  USDT: 1000n * 10n ** 6n, // 1000 USDT ~= 1000$
  sUSD: 1000n * 10n ** 18n, // 1000 sUSD ~= 1000$
  USDC: 1000n * 10n ** 6n, // 1000 USDC ~= 1000$
  WETH: 5n * 10n ** 17n, // 0.5 ETH ~= 1000$
  rETH: 5n * 10n ** 17n, // 0.5 ETH ~= 1000$
  stETH: 5n * 10n ** 17n, // 0.5 stETH ~= 1000$
  cbETH: 5n * 10n ** 17n, // 0.5 cbETH ~= 1000$
  WBTC: 4n * 10n ** 6n // 0.04 WBTC ~= 1000$
};

const bigIntMax = (...args: bigint[]) => args.reduce((m, e) => (e > m ? e : m));

const BIGINT_1e18 = BigInt(10) ** BigInt(18);

export function computePriceAndSlippageMapForReserveValueCryptoV2(
  fromSymbol: string,
  toSymbol: string,
  poolTokens: string[],
  ampFactorArg: bigint,
  reservesArgs: string[],
  precisions: bigint[],
  gammaArg: bigint,
  Darg: bigint,
  priceScaleArg: bigint[]
) {
  if (poolTokens.length != reservesArgs.length) {
    throw new Error('Tokens array must be same length as reserves array');
  }

  const reserves = reservesArgs.map((_) => BigInt(_));
  const priceScale = priceScaleArg.map((_) => BigInt(_));
  const ampFactor = BigInt(ampFactorArg);
  const gamma = BigInt(gammaArg);
  const D = BigInt(Darg);

  const indexFrom = poolTokens.indexOf(fromSymbol);
  const indexTo = poolTokens.indexOf(toSymbol);
  const fromConf = getConfTokenBySymbol(fromSymbol);
  const toConf = getConfTokenBySymbol(toSymbol);
  let baseAmount = baseAmountMap[fromSymbol];
  if (!baseAmount) {
    console.warn(`No base amount for ${fromSymbol}`);
    baseAmount = 10n ** BigInt(fromConf.decimals);
  }

  const returnVal = get_dy_v2(
    indexFrom,
    indexTo,
    baseAmount,
    reserves,
    BigInt(poolTokens.length),
    ampFactor,
    gamma,
    D,
    priceScale,
    precisions
  );
  const price = normalize(returnVal.toString(), toConf.decimals) / normalize(baseAmount, fromConf.decimals);
  // console.log(price);
  // const invPrice = 1 / price;
  // console.log(invPrice);
  const slippageMap: { [slippageBps: number]: { base: number; quote: number } } = {};
  let lastAmount = baseAmount;
  for (let slippageBps = 50; slippageBps <= 2000; slippageBps += 50) {
    const targetPrice = price - (price * slippageBps) / 10000;
    const liquidityObj = v2_computeLiquidityForSlippageCurvePoolCryptoV2(
      baseAmount,
      lastAmount,
      targetPrice,
      reserves,
      indexFrom,
      indexTo,
      ampFactor,
      gamma,
      D,
      priceScale,
      precisions,
      fromConf.decimals,
      toConf.decimals
    );
    const liquidityAtSlippage = normalize(liquidityObj.base.toString(), fromConf.decimals);
    const quoteObtainedAtSlippage = normalize(liquidityObj.quote.toString(), toConf.decimals);
    lastAmount = liquidityObj.base;

    slippageMap[slippageBps] = { base: liquidityAtSlippage, quote: quoteObtainedAtSlippage };
  }

  return { price, slippageMap };
}

function get_dy_v2(
  i: number,
  j: number,
  dx: bigint,
  reserves: bigint[],
  N_COINS: bigint,
  A: bigint,
  gamma: bigint,
  D: bigint,
  priceScale: bigint[],
  precisions: bigint[]
) {
  // xp: uint256[N_COINS] = empty(uint256[N_COINS])
  // for k in range(N_COINS):
  // xp[k] = Curve(msg.sender).balances(k)
  const xp = [];
  for (let k = 0; k < N_COINS; k++) {
    xp[k] = structuredClone(reserves[k]);
  }

  // xp[i] += dx
  // xp[0] *= precisions[0]
  xp[i] += dx;
  xp[0] *= precisions[0];

  // for k in range(N_COINS-1):
  // xp[k+1] = xp[k+1] * price_scale[k] * precisions[k+1] / PRECISION
  for (let k = 0; k < N_COINS - 1n; k++) {
    xp[k + 1] = BigInt(xp[k + 1] * priceScale[k] * precisions[k + 1]) / 10n ** 18n;
  }

  // y: uint256 = Math(self.math).newton_y(A, gamma, xp, Curve(msg.sender).D(), j)
  const y = get_newton_y(A, gamma, xp, D, j, N_COINS);

  // dy: uint256 = xp[j] - y - 1
  let dy = BigInt(xp[j]) - y - 1n;

  // if j > 0:
  // dy = dy * PRECISION / price_scale[j-1]
  if (j > 0) {
    dy = (dy * 10n ** 18n) / priceScale[j - 1];
  }

  // dy /= precisions[j]
  dy = dy / precisions[j];

  return dy;
}
const A_MULTIPLIER = 10000n;

function get_newton_y(ANN: bigint, gamma: bigint, reserves: bigint[], D: bigint, i: number, N_COINS: bigint) {
  // y: uint256 = D / N_COINS
  // K0_i: uint256 = 10**18
  // S_i: uint256 = 0
  let y = D / N_COINS;
  let K0_i = 10n ** 18n;
  let S_i = 0n;

  // x_sorted: uint256[N_COINS] = x
  // x_sorted[i] = 0
  // x_sorted = self.sort(x_sorted)  # From high to low
  const x_sorted = structuredClone(reserves);
  x_sorted[i] = 0n;
  x_sorted.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  //convergence_limit: uint256 = max(max(x_sorted[0] / 10**14, D / 10**14), 100)
  const convergence_limit = bigIntMax(bigIntMax(x_sorted[0] / 10n ** 14n, D / 10n ** 14n), 100n);

  // for j in range(2, N_COINS+1):
  //     _x: uint256 = x_sorted[N_COINS-j]
  //     y = y * D / (_x * N_COINS)  # Small _x first
  //     S_i += _x
  for (let j = 2n; j < N_COINS + 1n; j++) {
    const _x = x_sorted[Number(N_COINS - j)];
    y = (y * D) / (_x * N_COINS);
    S_i += _x;
  }

  // for j in range(N_COINS-1):
  //     K0_i = K0_i * x_sorted[j] * N_COINS / D  # Large _x first
  for (let j = 0; j < N_COINS - 1n; j++) {
    K0_i = (K0_i * x_sorted[j] * N_COINS) / D;
  }

  // for j in range(255):
  for (let j = 0; j < 255; j++) {
    // y_prev: uint256 = y
    const y_prev = y;

    // K0: uint256 = K0_i * y * N_COINS / D
    // S: uint256 = S_i + y
    const K0 = (K0_i * y * N_COINS) / D;
    const S = S_i + y;

    // _g1k0: uint256 = gamma + 10**18
    // if _g1k0 > K0:
    //     _g1k0 = _g1k0 - K0 + 1
    // else:
    //     _g1k0 = K0 - _g1k0 + 1
    let _g1k0 = gamma + 10n ** 18n;
    if (_g1k0 > K0) {
      _g1k0 = _g1k0 - K0 + 1n;
    } else {
      _g1k0 = K0 - _g1k0 + 1n;
    }

    // # D / (A * N**N) * _g1k0**2 / gamma**2
    // mul1: uint256 = 10**18 * D / gamma * _g1k0 / gamma * _g1k0 * A_MULTIPLIER / ANN
    const mul1 = (((((10n ** 18n * D) / gamma) * _g1k0) / gamma) * _g1k0 * A_MULTIPLIER) / ANN;

    // # 2*K0 / _g1k0
    // mul2: uint256 = 10**18 + (2 * 10**18) * K0 / _g1k0
    const mul2 = 10n ** 18n + (2n * 10n ** 18n * K0) / _g1k0;

    // yfprime: uint256 = 10**18 * y + S * mul2 + mul1
    // _dyfprime: uint256 = D * mul2
    let yfprime = 10n ** 18n * y + S * mul2 + mul1;
    const _dyfprime = D * mul2;

    // if yfprime < _dyfprime:
    //     y = y_prev / 2
    //     continue
    // else:
    //     yfprime -= _dyfprime
    if (yfprime < _dyfprime) {
      y = y_prev / BigInt(2);
      continue;
    } else {
      yfprime -= _dyfprime;
    }

    // fprime: uint256 = yfprime / y
    const fprime = yfprime / y;

    // # y -= f / f_prime;  y = (y * fprime - f) / fprime
    // # y = (yfprime + 10**18 * D - 10**18 * S) // fprime + mul1 // fprime * (10**18 - K0) // K0
    // y_minus: uint256 = mul1 / fprime
    // y_plus: uint256 = (yfprime + 10**18 * D) / fprime + y_minus * 10**18 / K0
    // y_minus += 10**18 * S / fprime
    let y_minus = mul1 / fprime;
    const y_plus = (yfprime + 10n ** 18n * D) / fprime + (y_minus * 10n ** 18n) / K0;
    y_minus += (10n ** 18n * S) / fprime;

    // if y_plus < y_minus:
    //     y = y_prev / 2
    // else:
    //     y = y_plus - y_minus
    if (y_plus < y_minus) {
      y = y_prev / BigInt(2);
    } else {
      y = y_plus - y_minus;
    }

    // diff: uint256 = 0
    // if y > y_prev:
    //     diff = y - y_prev
    // else:
    //     diff = y_prev - y
    let diff = 0n;
    if (y > y_prev) {
      diff = y - y_prev;
    } else {
      diff = y_prev - y;
    }

    // if diff < max(convergence_limit, y / 10**14):
    //     frac: uint256 = y * 10**18 / D
    //     assert (frac > 10**16 - 1) and (frac < 10**20 + 1)  # dev: unsafe value for y
    //     return y

    if (diff < bigIntMax(convergence_limit, y / 10n ** 14n)) {
      return y;
    }
  }

  throw new Error('Did not converge');
}

function v2_computeLiquidityForSlippageCurvePoolCryptoV2(
  baseAmountPrice: bigint,
  baseQty: bigint,
  targetPrice: number,
  baseReserves: bigint[],
  i: number,
  j: number,
  amplificationFactor: bigint,
  gamma: bigint,
  D: bigint,
  priceScale: bigint[],
  precisions: bigint[],
  decimalsFrom: number,
  decimalsTo: number
) {
  let low = undefined;
  let high = undefined;
  let lowTo = undefined;
  let highTo = undefined;
  let qtyFrom = baseQty * 2n;
  const exitBoundsDiff = 0.1 / 100; // exit binary search when low and high bound have less than this amount difference
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const qtyTo = get_dy_v2(
      i,
      j,
      qtyFrom,
      baseReserves,
      BigInt(baseReserves.length),
      amplificationFactor,
      gamma,
      D,
      priceScale,
      precisions
    );
    const newReserves = [];
    for (const reserve of baseReserves) {
      newReserves.push(reserve);
    }

    // selling i for j mean more i and less j
    newReserves[i] += qtyFrom;
    newReserves[j] -= qtyTo;

    // get the new price for one token
    const newQtyTo = get_dy_v2(
      i,
      j,
      baseAmountPrice,
      newReserves,
      BigInt(newReserves.length),
      amplificationFactor,
      gamma,
      D,
      priceScale,
      precisions
    );

    const normalizedFrom = normalize(baseAmountPrice.toString(), decimalsFrom);
    const normalizedTo = normalize(newQtyTo.toString(), decimalsTo);
    const currentPrice = normalizedTo / normalizedFrom;

    const variation = Number(high) / Number(low) - 1;
    // console.log(`WBTC Qty: [${low ? normalize(BigNumber.from(low), 18) : '0'} <-> ${high ? normalize(BigNumber.from(high), 18) : '+∞'}]. Current price: 1 WBTC = ${currentPrice} USDT, targetPrice: ${targetPrice}. Try qty: ${normalizedFrom} WBTC = ${normalizedTo} USDT. variation: ${variation * 100}%`);
    if (low && high && lowTo && highTo) {
      if (variation < exitBoundsDiff) {
        const base = (high + low) / 2n;
        const quote = (highTo + lowTo) / 2n;
        return { base, quote };
      }
    }

    if (currentPrice > targetPrice) {
      // current price too high, must increase qtyFrom
      low = qtyFrom;
      lowTo = qtyTo;
      if (!high) {
        // if high is undefined, just double next try qty
        qtyFrom = qtyFrom * 2n;
      } else {
        qtyFrom = qtyFrom + (high - low) / 2n;
      }
    } else {
      // current price too low, must decrease qtyFrom
      high = qtyFrom;
      highTo = qtyTo;

      if (!low) {
        // if low is undefined, next try qty = qty / 2
        qtyFrom = qtyFrom / 2n;
      } else {
        qtyFrom = qtyFrom - (high - low) / 2n;
      }
    }
  }
}

export function computePriceAndSlippageMapForReserveValue(
  fromSymbol: string,
  toSymbol: string,
  poolTokens: string[],
  ampFactor: bigint,
  reserves: string[]
) {
  if (poolTokens.length != reserves.length) {
    throw new Error('Tokens array must be same length as reserves array');
  }

  const tokenConfs = [];
  for (const poolToken of poolTokens) {
    tokenConfs.push(getConfTokenBySymbol(poolToken));
  }

  const reservesNorm18Dec = getReservesNormalizedTo18Decimals(tokenConfs, reserves);

  const indexFrom = poolTokens.indexOf(fromSymbol);
  const indexTo = poolTokens.indexOf(toSymbol);
  const returnVal = get_return(indexFrom, indexTo, BIGINT_1e18, reservesNorm18Dec, ampFactor);
  const price = normalize(returnVal.toString(), 18);
  const slippageMap: { [index: number]: { base: number; quote: number } } = {};
  let lastAmount = BIGINT_1e18;
  for (let slippageBps = 50; slippageBps <= 2000; slippageBps += 50) {
    const targetPrice = price - (price * slippageBps) / 10000;
    const liquidityObj = v2_computeLiquidityForSlippageCurvePool(
      lastAmount,
      targetPrice,
      reservesNorm18Dec,
      indexFrom,
      indexTo,
      ampFactor
    );
    const liquidityAtSlippage = normalize(liquidityObj.base.toString(), 18);
    const quoteObtainedAtSlippage = normalize(liquidityObj.quote.toString(), 18);
    lastAmount = liquidityObj.base;
    slippageMap[slippageBps] = { base: liquidityAtSlippage, quote: quoteObtainedAtSlippage };
  }

  return { price, slippageMap };
}
function getReservesNormalizedTo18Decimals(tokens: TokenData[], reserves: string[]) {
  if (tokens.length != reserves.length) {
    throw new Error('Tokens array must be same length as reserves array');
  }
  const reservesNorm = [];

  for (let i = 0; i < reserves.length; i++) {
    const tokenReserve18DecimalStr = reserves[i] + ''.padEnd(18 - tokens[i].decimals, '0');
    reservesNorm.push(BigInt(tokenReserve18DecimalStr));
  }

  return reservesNorm;
}
function get_return(i: number, j: number, x: bigint, balances: bigint[], A: bigint) {
  return get_y(i, j, x + balances[i], balances, BigInt(balances.length), A);
}

function get_y(i: number, j: number, x: bigint, _xp: bigint[], N_COINS: bigint, A: bigint) {
  // x in the input is converted to the same price/precision
  //assert (i != j) and (i >= 0) and (j >= 0) and (i < N_COINS) and (j < N_COINS)

  const D = get_D(_xp, N_COINS, A);
  let c = D;
  let S_ = 0n;
  const Ann = A * N_COINS;

  let _x = 0n;
  for (let _i = 0; _i < N_COINS; _i++) {
    if (_i == i) _x = x;
    else if (_i != j) _x = _xp[_i];
    else continue;
    S_ += _x;
    c = (c * D) / (_x * N_COINS);
  }
  c = (c * D) / (Ann * N_COINS);
  const b = S_ + D / Ann; // - D
  let y_prev = 0n;
  let y = D;
  for (let _i = 0; _i < 255; _i++) {
    y_prev = y;
    y = (y * y + c) / (2n * y + b - D);
    // Equality with the precision of 1
    if (y > y_prev)
      if (y - y_prev <= 1n) break;
      else if (y_prev - y <= 1n) break;
  }

  return _xp[j] - y;
}

function get_D(xp: bigint[], N_COINS: bigint, A: bigint) {
  let S = 0n;
  for (const _x of xp) {
    S += _x;
  }

  if (S == BigInt(0)) return 0n;

  let Dprev = BigInt(0);
  let D = S;
  const Ann = A * N_COINS;
  for (let _i = 0; _i < 255; _i++) {
    let D_P = D;
    for (const _x of xp) D_P = (D_P * D) / (_x * N_COINS + 1n); // +1 is to prevent /0
    Dprev = D;
    D = ((Ann * S + D_P * N_COINS) * D) / ((Ann - 1n) * D + (N_COINS + 1n) * D_P);
    // Equality with the precision of 1
    if (D > Dprev)
      if (D - Dprev <= 1n) break;
      else if (Dprev - D <= 1n) break;
  }
  return D;
}

/**
 * Find the liquidity for slippage using curve data
 * Use binary search to find the value
 * This is the new computing formula: find the amount to sell to bring the new price to the target
 * @param {BigInt} baseQty
 * @param {number} basePrice
 * @param {number} targetPrice
 * @param {BigInt[]} reserves
 * @param {number} i
 * @param {number} j
 * @param {number} amplificationFactor
 */
function v2_computeLiquidityForSlippageCurvePool(
  baseQty: bigint,
  targetPrice: number,
  baseReserves: bigint[],
  i: number,
  j: number,
  amplificationFactor: bigint
) {
  let low = undefined;
  let high = undefined;
  let lowTo = undefined;
  let highTo = undefined;
  let qtyFrom = baseQty * 2n;
  const exitBoundsDiff = 0.1 / 100; // exit binary search when low and high bound have less than this amount difference
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const qtyTo = get_return(i, j, qtyFrom, baseReserves, amplificationFactor);
    const newReserves = [];
    for (const reserve of baseReserves) {
      newReserves.push(reserve);
    }

    // selling i for j mean more i and less j
    newReserves[i] += qtyFrom;
    newReserves[j] -= qtyTo;

    // get the new price for 1e18 (the min value for curve pool)
    const newQtyTo = get_return(i, j, BIGINT_1e18, newReserves, amplificationFactor);
    const normalizedFrom = normalize(BIGINT_1e18.toString(), 18);
    const normalizedTo = normalize(newQtyTo.toString(), 18);
    const currentPrice = normalizedTo / normalizedFrom;

    const variation = Number(high) / Number(low) - 1;
    // console.log(`DAI Qty: [${low ? normalize(BigNumber.from(low), 18) : '0'} <-> ${high ? normalize(BigNumber.from(high), 18) : '+∞'}]. Current price: 1 ${fromSymbol} = ${currentPrice} ${toSymbol}, targetPrice: ${targetPrice}. Try qty: ${normalizedFrom} ${fromSymbol} = ${normalizedTo} ${toSymbol}. variation: ${variation * 100}%`);
    if (low && high && lowTo && highTo) {
      if (variation < exitBoundsDiff) {
        const base = (high + low) / 2n;
        const quote = (highTo + lowTo) / 2n;
        return { base, quote };
      }
    }

    if (currentPrice > targetPrice) {
      // current price too high, must increase qtyFrom
      low = qtyFrom;
      lowTo = qtyTo;

      if (!high) {
        // if high is undefined, just double next try qty
        qtyFrom = qtyFrom * 2n;
      } else {
        qtyFrom = qtyFrom + (high - low) / 2n;
      }
    } else {
      // current price too low, must decrease qtyFrom
      high = qtyFrom;
      highTo = qtyTo;

      if (!low) {
        // if low is undefined, next try qty = qty / 2
        qtyFrom = qtyFrom / 2n;
      } else {
        qtyFrom = qtyFrom - (high - low) / 2n;
      }
    }
  }
}
