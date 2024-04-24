export class BlockUtils {
  static findNearestBlockBefore(targetBlock: number, blocks: number[], startIndex: number) {
    let block = blocks[startIndex];
    let selectedIndex = startIndex;
    for (let i = startIndex + 1; i < blocks.length; i++) {
      const nextBlock = blocks[i];
      if (nextBlock > targetBlock) {
        block = blocks[i - 1];
        selectedIndex = i - 1;
        break;
      }

      block = blocks[i];
      selectedIndex = i;
    }

    if (block > targetBlock) {
      return null;
    }

    return { block, selectedIndex };
  }
}
