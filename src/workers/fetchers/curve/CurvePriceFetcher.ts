import * as ethers from 'ethers';
import * as fs from 'fs';
import path from 'path';
import { getConfTokenBySymbol, normalize, sleep } from '../../../utils/Utils';
import * as Web3Utils from '../../../utils/Web3Utils';
import { BaseWorker } from '../../BaseWorker';
import { readLastLine } from '../../configuration/Helper';
import { TokenData } from '../../configuration/TokenData';
import {
  CurvePricePairConfiguration,
  CurveTokenPair,
  CurveWorkerConfiguration,
  generateLastFetchFileName,
  generateUnifiedDataFileName
} from '../../configuration/WorkerConfiguration';
import { CurveContract, CurveUtils } from './CurveContract';

export class CurvePriceFetcher extends BaseWorker<CurveWorkerConfiguration> {
  constructor(runEveryMinutes: number) {
    super('curve', 'Curve Price Fetcher', runEveryMinutes);
  }

  async runSpecific(): Promise<void> {
    const currentBlock = (await this.web3Provider.getBlockNumber()) - 10;
    let i = 1;
    for (const fetchConfig of this.workerConfiguration.pricePairs) {
      console.log(
        `[${fetchConfig.poolName}] (${i++}/${this.workerConfiguration.pricePairs.length}): Start fetching history`
      );
      await this.FetchPriceHistory(fetchConfig, currentBlock, this.web3Provider);
    }
  }

  //    ___ ___ _____ ___ _  _   ___ _   _ _  _  ___ _____ ___ ___  _  _ ___
  //   | __| __|_   _/ __| || | | __| | | | \| |/ __|_   _|_ _/ _ \| \| / __|
  //   | _|| _|  | || (__| __ | | _|| |_| | .` | (__  | |  | | (_) | .` \__ \
  //   |_| |___| |_| \___|_||_| |_|  \___/|_|\_|\___| |_| |___\___/|_|\_|___/
  //

  /**
   * Takes a fetchConfig from curve.config.js and outputs liquidity file in /data
   * @param {{poolAddress: string, poolName: string, version: number, abi: string, ampFactor: number, additionnalTransferEvents: {[symbol: string]: string[]}}} curvePricePairConfiguration
   * @param {number} currentBlock
   */
  async FetchPriceHistory(curvePricePairConfiguration: CurvePricePairConfiguration, currentBlock: number) {
    const historyFileName = generateLastFetchFileName(this.workerName, curvePricePairConfiguration.poolName);
    let startBlock = 0;

    if (fs.existsSync(historyFileName)) {
      const historyFile: HistoryFile = JSON.parse(fs.readFileSync(historyFileName, 'utf-8'));
      startBlock = historyFile.lastBlockFetched + 1;
    } else {
      startBlock =
        (await Web3Utils.GetContractCreationBlockNumber(curvePricePairConfiguration.poolAddress, this.workerName)) +
        100_000;
    }

    // fetch all blocks where an event occured since startBlock
    const curveContract: CurveContract = CurveUtils.getCurveContractFromABIAsString(
      curvePricePairConfiguration.abi,
      curvePricePairConfiguration.poolAddress,
      this.web3Provider
    );

    let fromBlock = startBlock;
    let blockStep = 100000;
    let nextSaveBlock = fromBlock + 100_000; // save data every 100k blocks

    let priceData = this.initPriceData(curvePricePairConfiguration.pairs);

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
        `${this.workerName}[${curvePricePairConfiguration.poolName}]: [${fromBlock} - ${toBlock}] found ${
          events.length
        } events (fetched ${toBlock - fromBlock + 1} blocks)`
      );

      if (events.length != 0) {
        for (const e of events) {
          if (e instanceof ethers.ethers.EventLog) {
            const baseTokenSymbol = curvePricePairConfiguration.tokens[e.args.sold_id].symbol;
            const baseToken: TokenData = getConfTokenBySymbol(baseTokenSymbol);
            const quoteTokenSymbol = curvePricePairConfiguration.tokens[e.args.bought_id].symbol;
            const quoteToken: TokenData = getConfTokenBySymbol(quoteTokenSymbol);

            // check if in the list of pair to get
            // if baseToken = USDC and quoteToken = DAI
            // then we search for a pair token0:DAI,token1:USDC or token0:USDC,token1:DAI
            if (
              curvePricePairConfiguration.pairs.some(
                (_) =>
                  (_.token0 == baseTokenSymbol && _.token1 == quoteTokenSymbol) ||
                  (_.token1 == baseTokenSymbol && _.token0 == quoteTokenSymbol)
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
        priceData = this.initPriceData(curvePricePairConfiguration.pairs);
        nextSaveBlock = fromBlock + 100_000;
      }
    }

    this.savePriceData(priceData);

    const lastFetchData: HistoryFile = { lastBlockFetched: currentBlock };
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

  initPriceData(pairs: CurveTokenPair[]) {
    const priceData: PriceData = {};
    for (const pair of pairs) {
      priceData[`${pair.token0}-${pair.token1}`] = [];
      priceData[`${pair.token1}-${pair.token0}`] = [];
    }

    return priceData;
  }
}

type HistoryFile = { lastBlockFetched: number };

type BlockPrice = { block: number; price: number };

type PriceData = { [quoteBaseToken: string]: BlockPrice[] };

// async function debug() {
//   const fetcher = new CurvePriceFetcher(0);
//   await fetcher.runSpecific();
// }

// debug();
