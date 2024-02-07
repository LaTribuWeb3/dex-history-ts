import { BaseWorker } from '../../BaseWorker';
import {
  CurvePairConfiguration,
  CurveWorkerConfiguration,
  generateLastFetchFileName,
  generateUnifiedDataFileName
} from '../../configuration/WorkerConfiguration';
import * as ethers from 'ethers';
import * as Web3Utils from '../../../utils/Web3Utils';
import { getConfTokenBySymbol, sleep } from '../../../utils/Utils';
import { readLastLine } from '../../configuration/Helper';
import * as fs from 'fs';
import { normalize } from '../../../utils/Utils';
import { TokenData } from '../../configuration/TokenData';
import { CurveUtils, CurveContract } from './CurveContract';
import path from 'path';

export class CurvePriceFetcher extends BaseWorker<CurveWorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('curve', 'Curve Fetcher', runEveryMinutes);
  }

  async runSpecific(): Promise<void> {
    const web3Provider: ethers.JsonRpcProvider = Web3Utils.getJsonRPCProvider();

    const currentBlock = (await web3Provider.getBlockNumber()) - 10;
    for (const fetchConfig of this.workerConfiguration.pairs) {
      await this.FetchPriceHistory(fetchConfig, currentBlock, web3Provider, this.workerConfiguration.pairs);
    }
  }

  //    ___ ___ _____ ___ _  _   ___ _   _ _  _  ___ _____ ___ ___  _  _ ___
  //   | __| __|_   _/ __| || | | __| | | | \| |/ __|_   _|_ _/ _ \| \| / __|
  //   | _|| _|  | || (__| __ | | _|| |_| | .` | (__  | |  | | (_) | .` \__ \
  //   |_| |___| |_| \___|_||_| |_|  \___/|_|\_|\___| |_| |___\___/|_|\_|___/
  //

  /**
   * Takes a fetchConfig from curve.config.js and outputs liquidity file in /data
   * @param {{poolAddress: string, poolName: string, version: number, abi: string, ampFactor: number, additionnalTransferEvents: {[symbol: string]: string[]}}} fetchConfig
   * @param {number} currentBlock
   * @param {StaticJsonRpcProvider} web3Provider
   */
  async FetchPriceHistory(
    fetchConfig: CurvePairConfiguration,
    currentBlock: number,
    web3Provider: ethers.JsonRpcProvider,
    pairs: CurvePairConfiguration[]
  ) {
    console.log(`[${fetchConfig.poolName}]: Start fetching history`);
    const historyFileName = generateLastFetchFileName(this.workerName, fetchConfig.poolName);
    let startBlock = 0;

    if (fs.existsSync(historyFileName)) {
      const lastLine = await readLastLine(historyFileName);
      startBlock = Number(lastLine.split(',')[0]) + 1;
    } else {
      startBlock = await Web3Utils.GetContractCreationBlockNumber(fetchConfig.poolAddress, this.workerName);
    }

    // this is done for the tricryptoUSDC pool because the first liquidity values are too low for
    // the liquidity algorithm to work. Dunno why
    if (fetchConfig.minBlock && startBlock < fetchConfig.minBlock) {
      startBlock = fetchConfig.minBlock;
    }

    // fetch all blocks where an event occured since startBlock
    const curveContract: CurveContract = CurveUtils.getCurveContract(fetchConfig, web3Provider);

    let fromBlock = startBlock;
    let blockStep = 100000;
    let nextSaveBlock = fromBlock + 100_000; // save data every 100k blocks

    let priceData = this.initPriceData(pairs);

    while (fromBlock <= currentBlock) {
      const toBlock = Math.min(currentBlock, fromBlock + blockStep - 1);

      let events: (ethers.ethers.EventLog | ethers.ethers.Log)[];

      try {
        events = await curveContract.queryFilter('TokenExchange', fromBlock, toBlock);
      } catch (e) {
        // console.log('query filter error:', e);
        blockStep = Math.round(blockStep / 2);
        if (blockStep < 1000) {
          blockStep = 1000;
        }
        await sleep(2000);
        continue;
      }

      console.log(
        `${this.workerName}[${fetchConfig.poolName}]: [${fromBlock} - ${toBlock}] found ${
          events.length
        } events (fetched ${toBlock - fromBlock + 1} blocks)`
      );

      if (events.length != 0) {
        for (const e of events) {
          if (e instanceof ethers.ethers.EventLog) {
            const baseTokenSymbol = fetchConfig.tokens[e.args.sold_id].symbol;
            const baseToken: TokenData = getConfTokenBySymbol(baseTokenSymbol);
            const quoteTokenSymbol = fetchConfig.tokens[e.args.bought_id].symbol;
            const quoteToken: TokenData = getConfTokenBySymbol(quoteTokenSymbol);

            // check if in the list of pair to get
            // if baseToken = USDC and quoteToken = DAI
            // then we search for a pair token0:DAI,token1:USDC or token0:USDC,token1:DAI
            if (
              pairs.some(
                (_) =>
                  (_.tokens[0].symbol == baseTokenSymbol && _.tokens[1].symbol == quoteTokenSymbol) ||
                  (_.tokens[1].symbol == baseTokenSymbol && _.tokens[0].symbol == quoteTokenSymbol)
              )
            ) {
              const tokenSold = normalize(e.args.tokens_sold, baseToken.decimals);
              const tokenBought = normalize(e.args.tokens_bought, quoteToken.decimals);

              // ignore trades too low
              if (tokenSold < baseToken.dustAmount || tokenBought < quoteToken.dustAmount) {
                continue;
              }

              // Example for WETH/USDC
              // if I sell 1.3 WETH and get 1800 USDC
              // then WETH/USDC price is 1800/1.3 = 1384,6
              // and USDC/WETH is 1.3/1800 7,22...e-4
              const baseQuotePrice = tokenBought / tokenSold;
              const quoteBasePrice = tokenSold / tokenBought;

              priceData[`${baseTokenSymbol}-${quoteTokenSymbol}`].push({
                block: e.blockNumber,
                price: baseQuotePrice
              });
              priceData[`${quoteTokenSymbol}-${baseTokenSymbol}`].push({
                block: e.blockNumber,
                price: quoteBasePrice
              });
            }
          }
        }

        const newBlockStep = Math.min(1_000_000, Math.round((blockStep * 8000) / events.length));
        if (newBlockStep > blockStep * 2) {
          blockStep = blockStep * 2;
        } else {
          blockStep = newBlockStep;
        }
      } else {
        // if 0 events, multiply blockstep by 2
        blockStep = blockStep * 2;
      }

      fromBlock = toBlock + 1;

      if (nextSaveBlock <= fromBlock) {
        this.savePriceData(priceData);
        priceData = this.initPriceData(pairs);
        nextSaveBlock = fromBlock + 100_000;
      }
    }

    this.savePriceData(priceData);

    const lastFetchData = { lastBlockFetched: currentBlock };
    fs.writeFileSync(historyFileName, JSON.stringify(lastFetchData, null, 2));
  }

  savePriceData(priceData: PriceData) {
    for (const pair of Object.keys(priceData)) {
      const fileName = generateUnifiedDataFileName(this.workerName, pair);
      if (!fs.existsSync(path.dirname(fileName))) {
        fs.mkdirSync(path.dirname(fileName), { recursive: true });
      }

      if (!fs.existsSync(fileName)) {
        fs.writeFileSync(fileName, 'blocknumber,price\n');
      }

      const toWrite = [];
      for (const p of priceData[pair]) {
        toWrite.push(`${p.block},${p.price}\n`);
      }

      fs.appendFileSync(fileName, toWrite.join(''));
    }
  }

  initPriceData(pairs: CurvePairConfiguration[]) {
    const priceData: PriceData = {};
    for (const pair of pairs) {
      priceData[`${pair.tokens[0].symbol}-${pair.tokens[1].symbol}`] = [];
      priceData[`${pair.tokens[1].symbol}-${pair.tokens[0].symbol}`] = [];
    }

    return priceData;
  }
}

type BlockPrice = { block: number; price: number };

type PriceData = { [quoteBaseToken: string]: BlockPrice[] };
