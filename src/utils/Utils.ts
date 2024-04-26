import BigNumber from 'bignumber.js';
import * as fs from 'fs';
import path from 'path';
import { TokenData } from '../workers/configuration/TokenData';
import { Configuration } from '../config/Configuration';

/**
 * Retries a function n number of times before giving up
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function retry<T extends (...arg0: any[]) => any>(
  fn: T,
  args: Parameters<T>,
  maxTry = 10,
  incrSleepDelay = 10000,
  retryCount = 1
): Promise<Awaited<ReturnType<T>>> {
  const currRetry = typeof retryCount === 'number' ? retryCount : 1;
  try {
    const result = await fn(...args);
    if (currRetry > 1) console.log(`Success after ${retryCount - 1} retries.`);
    return result;
  } catch (e) {
    if (currRetry >= maxTry) {
      console.log(`Retry ${currRetry} failed. All ${maxTry} retry attempts exhausted`);
      throw e;
    }
    console.log(`Retry ${currRetry} failed: ${e}`);
    // console.log(e);
    console.log(`Waiting ${retryCount} second(s) before retrying... `);
    await sleep(incrSleepDelay * retryCount);
    return retry(fn, args, maxTry, incrSleepDelay, currRetry + 1);
  }
}

export async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function normalize(amount: string | bigint, decimals: number): number {
  const bn = new BigNumber(amount.toString());
  const factor = new BigNumber(10).pow(decimals);
  return bn.div(factor).toNumber();
}

export function roundTo(num: number, dec = 2): number {
  const pow = Math.pow(10, dec);
  return Math.round((num + Number.EPSILON) * pow) / pow;
}

export function writeContentToFile(syncFilename: string, content: string) {
  if (!fs.existsSync(path.dirname(syncFilename))) {
    fs.mkdirSync(path.dirname(syncFilename), { recursive: true });
  }
  fs.writeFileSync(syncFilename, content);
}

export async function getConfTokenBySymbol(symbol: string): Promise<TokenData> {
  const tokens = await Configuration.getTokensConfiguration();
  const tokenConf = tokens[symbol] as TokenData;
  if (!tokenConf) {
    throw new Error(`Cannot find token with symbol ${symbol}`);
  }

  return tokenConf;
}

export async function getConfTokenByAddress(address: string): Promise<TokenData> {
  const tokens = await Configuration.getTokensConfiguration();
  for (const token of Object.values(tokens)) {
    if (address.toLowerCase() == token.address.toLowerCase()) {
      return token as TokenData;
    }
  }

  throw new Error(`Could not find token with address ${address}`);
}

export function readDataFromFile(fullFilename: string) {
  return fs.readFileSync(fullFilename, 'utf-8').split('\n');
}
