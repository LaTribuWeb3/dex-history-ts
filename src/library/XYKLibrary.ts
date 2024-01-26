/**
 * Formula from
 * https://ethereum.stackexchange.com/a/107170/105194
 * TL;DR:
 * a = sqrt(pxy)/p - x
 * where p is the target price to be maintained and x and y
 * are the quantities of the two tokens in the pool before the trade takes place.
 * and a is the amount of x I can sell to reach the price p
 * @param {string} fromSymbol
 * @param {number} fromReserve must be normalized with the correct decimal place
 * @param {string} toSymbol
 * @param {number} toReserve must be normalized with the correct decimal place
 * @param {number} targetSlippage
 * @returns {{ base: number, quote: number }} base amount of token exchangeable for defined slippage, quote amount obtained
 */
export function ComputeLiquidityXYKPool(
  fromReserve: number,
  toReserve: number,
  targetSlippage: number
): { base: number; quote: number } {
  if (fromReserve === 0) {
    return { base: 0, quote: 0 };
  }

  const initPrice = toReserve / fromReserve;
  const targetPrice = initPrice - initPrice * targetSlippage;
  const amountOfFromToSell = Math.sqrt(targetPrice * fromReserve * toReserve) / targetPrice - fromReserve;
  const amountOfToObtained = calculateYReceived(fromReserve, toReserve, amountOfFromToSell);

  return { base: amountOfFromToSell, quote: amountOfToObtained };
}

function calculateYReceived(x0: number, y0: number, xSell: number): number {
  // Initial state of the liquidity pool
  const k0: number = x0 * y0;
  // Calculate the new quantity of asset X after the sale (it increases)
  const x1: number = x0 + xSell;
  // Calculate the new quantity of asset Y using the x * y = k formula
  const y1: number = k0 / x1;
  // Calculate the difference in asset Y received
  const deltaY: number = y0 - y1;
  return deltaY;
}

/**
 * Compute price from normalized reserves
 * @param {number} normalizedFrom
 * @param {number} normalizedTo
 * @returns {number} calculated price
 */
export function ComputeXYKPrice(normalizedFrom: number, normalizedTo: number): number {
  if (normalizedFrom === 0) {
    return 0;
  }
  return normalizedTo / normalizedFrom;
}
