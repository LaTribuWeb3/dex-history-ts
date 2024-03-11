export interface PoolData {
  tokens: string[]; // symbols
  address: string; // of the pool
  label?: string; // of the pool, if needed
}

export interface FetcherResults {
  dataSourceName: string;
  lastBlockFetched: number;
  lastRunTimestampMs: number;
  poolsFetched: PoolData[];
}
