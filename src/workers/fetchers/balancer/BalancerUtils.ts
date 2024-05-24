import { computeSlippageMapForBalancerPool } from '../../../library/BalancerLibrary';
import { BlockData } from '../../../models/datainterface/BlockData';
import { readLastLine } from '../../configuration/Helper';
import { TokenList } from '../../configuration/TokenData';
import { BalancerPoolConfiguration, generateUnifiedCSVFilePath } from '../../configuration/WorkerConfiguration';
import fs from 'fs';

export async function computeBalancerUnifiedDataForPair(
  base: string,
  quote: string,
  balancerPoolConfig: BalancerPoolConfiguration,
  rawDataFilePath: string,
  tokens: TokenList
) {
  const unifiedFullFilename = generateUnifiedCSVFilePath(
    'balancer',
    base + '-' + quote + '-' + balancerPoolConfig.name
  );

  if (!fs.existsSync(unifiedFullFilename)) {
    fs.writeFileSync(unifiedFullFilename, 'blocknumber,price,slippagemap\n');
  }

  const fileContent = fs.readFileSync(rawDataFilePath, 'utf-8').split('\n');
  if (fileContent.length < 2) {
    return;
  }

  let sinceBlock = Number(fileContent[1].split(',')[0]);
  const lastLine = await readLastLine(unifiedFullFilename);
  const precomputedMinBlock = Number(lastLine.split(',')[0]) + 1;
  if (!isNaN(precomputedMinBlock)) {
    sinceBlock = precomputedMinBlock;
  }

  let lineBefore = '';
  let genCount = 0;
  for (let i = 1; i < fileContent.length - 1; i++) {
    const dataLine = fileContent[i];

    const blockNumber = Number(dataLine.split(',')[0]);
    if (blockNumber < sinceBlock) {
      lineBefore = dataLine;
      continue;
    }

    // ignore duplicated from source file
    // splitting and slicing is done to ignore first item of the csv: the blocknumber (which changes every line)
    // the comparison is done only on the other field: to deduplicate when balances/weights etc are the same
    if (dataLine.split(',').slice(1).join(',') == lineBefore.split(',').slice(1).join(',')) {
      continue;
    }

    const dataToWrite: BlockData = await computeSlippageMapForBalancerPool(
      balancerPoolConfig,
      dataLine,
      balancerPoolConfig.tokenSymbols.indexOf(base),
      balancerPoolConfig.tokenSymbols.indexOf(quote),
      tokens
    );

    const lineToWrite = `${blockNumber},${dataToWrite.price},${JSON.stringify(dataToWrite.slippageMap)}\n`;
    fs.appendFileSync(unifiedFullFilename, lineToWrite);
    lineBefore = dataLine;
    genCount++;
  }

  console.log(`End generating unified pool data for ${balancerPoolConfig.name}. Generated ${genCount} new data`);
}
