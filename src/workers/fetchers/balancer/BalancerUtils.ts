import { computeSlippageMapForBalancerPool } from '../../../library/BalancerLibrary';
import { BlockData } from '../../../models/datainterface/BlockData';
import { readLastLine } from '../../configuration/Helper';
import { BalancerPoolConfiguration, generateUnifiedCSVFilePath } from '../../configuration/WorkerConfiguration';
import fs from 'fs';

export async function computeBalancerUnifiedDataForPair(
  base: string,
  quote: string,
  balancerPoolConfig: BalancerPoolConfiguration,
  rawDataFilePath: string
) {
  const unifiedFullFilename = generateUnifiedCSVFilePath(
    'balancer',
    base + '-' + quote + '-' + balancerPoolConfig.name
  );

  if (!fs.existsSync(unifiedFullFilename)) {
    fs.writeFileSync(unifiedFullFilename, 'blocknumber,price,slippagemap\n');
  }

  const fileContent = fs.readFileSync(rawDataFilePath, 'utf-8').split('\n');
  let sinceBlock = Number(fileContent[1].split(',')[0]);
  const lastLine = await readLastLine(unifiedFullFilename);
  const precomputedMinBlock = Number(lastLine.split(',')[0]) + 1;
  if (!isNaN(precomputedMinBlock)) {
    sinceBlock = precomputedMinBlock;
  }

  let lineBefore = '';
  for (let i = 1; i < fileContent.length - 1; i++) {
    const dataLine = fileContent[i];

    const blockNumber = Number(dataLine.split(',')[0]);
    if (blockNumber < sinceBlock) {
      lineBefore = dataLine;
      continue;
    }

    // ignore duplicated from source file
    if (dataLine == lineBefore) {
      continue;
    }

    const dataToWrite: BlockData = computeSlippageMapForBalancerPool(
      balancerPoolConfig,
      dataLine,
      balancerPoolConfig.tokenSymbols.indexOf(base),
      balancerPoolConfig.tokenSymbols.indexOf(quote)
    );

    const lineToWrite = `${blockNumber},${dataToWrite.price},${JSON.stringify(dataToWrite.slippageMap)}\n`;
    fs.appendFileSync(unifiedFullFilename, lineToWrite);
    lineBefore = dataLine;
  }
}
