import { median } from 'simple-statistics';
import { MEDIAN_OVER_BLOCK } from '../DataInterfaceConstants';
import { BlockUtils } from '../../../../utils/BlockUtils';

export class DataMedianer {
  static medianPricesOverBlocks(pricesAtBlock: { block: number; price: number }[], baseBlock: number | undefined) {
    let currBlock = baseBlock || pricesAtBlock[0].block;
    const lastPrice = pricesAtBlock.at(-1);
    if (lastPrice == undefined) {
      throw 'Block ' + baseBlock + ' is undefined.';
    }
    console.log(`starting median prices since block ${currBlock} to ${lastPrice.block}`);
    const medianPricesAtBlock = [];
    while (currBlock <= lastPrice.block) {
      const stepTargetBlock = currBlock + MEDIAN_OVER_BLOCK;
      // only median full block ranges
      if (stepTargetBlock > lastPrice.block) {
        break;
      }
      const blocksToMedian = pricesAtBlock.filter((_) => _.block >= currBlock && _.block < stepTargetBlock);
      if (blocksToMedian.length > 0) {
        const medianPrice = median(blocksToMedian.map((_) => _.price));
        if (medianPrice > 0) {
          medianPricesAtBlock.push({
            block: currBlock,
            price: medianPrice
          });
        }
      }

      currBlock = stepTargetBlock;
    }

    return medianPricesAtBlock;
  }

  // TODO rewrite this with list comprehension
  static generateFakePriceForStETHWETHUniswapV3(fromBlock: number, toBlock: number) {
    const pricesAtBlock = [];
    let currBlock = fromBlock;
    while (currBlock <= toBlock) {
      pricesAtBlock.push({
        block: currBlock,
        price: 1
      });

      currBlock += MEDIAN_OVER_BLOCK;
    }

    return pricesAtBlock;
  }

  static ComputePriceViaPivot(
    dataSegment1: {
      block: number;
      price: number;
    }[],
    dataSegment2: {
      block: number;
      price: number;
    }[]
  ) {
    const priceAtBlock = [];
    const keysSegment2 = dataSegment2.map((_) => _.block);
    let currentBlockOtherSegmentIndex = 0;

    for (const priceAtBlockData of dataSegment1) {
      // for(const [blockNumber, priceSegment1] of Object.entries(dataSegment1)) {
      const blockNumber = priceAtBlockData.block;
      const priceSegment1 = priceAtBlockData.price;
      const nearestBlockDataBefore = BlockUtils.findNearestBlockBefore(
        blockNumber,
        keysSegment2,
        currentBlockOtherSegmentIndex
      );
      if (!nearestBlockDataBefore) {
        // console.log(`ignoring block ${blockNumber}`);
        continue;
      }

      currentBlockOtherSegmentIndex = nearestBlockDataBefore.selectedIndex;

      const priceSegment2 = dataSegment2[currentBlockOtherSegmentIndex].price;
      const computedPrice = priceSegment1 * priceSegment2;
      priceAtBlock.push({
        block: blockNumber,
        price: computedPrice
      });
    }

    return priceAtBlock;
  }
}
