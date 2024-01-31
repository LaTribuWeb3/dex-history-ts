export interface TokenData {
  decimals: number;
  address: string;
  dustAmount: number;
}

export interface TokenList {
  [tokenSymbol: string]: TokenData;
}

export interface TokenWithReserve {
  [tokenSymbol: string]: number;
}
