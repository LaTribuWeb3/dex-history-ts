/**
 * Represents a data for a given block
 * Should always be linked to a block number somehow
 */
export interface BlockData {
  price: number;
  slippageMap: SlippageMap;
}

/**
 * Represents the slippage map of a token
 * From 50 to 2000 bps, give the amount of base you can to sell
 * to reach 'slippageBps'% slippage
 * the quote field gives the amount of quote received
 */
export interface SlippageMap {
  [slippageBps: string]: { base: number; quote: number };
}

export type BlockWithTick = {
  currentTick: number;
  currentSqrtPriceX96: string;
  blockNumber: number;
  tickSpacing: number;
  lastCheckpoint: number;
  lastDataSave: number;
  ticks: { [tick: number]: number };
  poolAddress: string;
};
