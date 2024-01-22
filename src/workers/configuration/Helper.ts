import { TokenList } from './TokenData';
import { UniSwapV2WorkerConfiguration } from './WorkerConfiguration';
import * as fs from 'fs';

/**
 * Read the last line of a file, without reading full file
 * @param {string} file filepath
 * @returns
 */
export async function readLastLine(file: string) {
  const fileSize = (await fs.promises.stat(file)).size;
  const bufferSize = 1024 * 1024;
  let lastLine = '';
  let bytesRead = 0;
  let fileOffset = fileSize - bufferSize;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const start = Math.max(fileOffset, 0);
    const stream = fs.createReadStream(file, {
      start: start,
      highWaterMark: bufferSize
    });
    bytesRead = 0;

    for await (const chunk of stream) {
      let i = chunk.length - 1;
      for (; i >= 0; --i) {
        if (chunk[i] === 10) {
          // '\n'
          lastLine = chunk.slice(i + 1).toString('utf8') + lastLine;

          // don't return last empty line
          if (lastLine.trim()) {
            return lastLine.trim();
          }
        }
      }

      lastLine = chunk.toString('utf8') + lastLine;
      bytesRead += chunk.length;
    }
    fileOffset -= bytesRead;
    if (fileOffset < 0) {
      return lastLine;
    }
  }
}
