import { AbstractRunner } from './AbstractRunner';
import { BscDataFetch } from './bsc/BscDataFetch';
import { EthereumDataFetch } from './ethereum/EthereumDataFetch';

const currentNetwork = process.env.NETWORK || 'ETH';

let runner: AbstractRunner;
switch (currentNetwork) {
  case 'ETH':
    runner = new EthereumDataFetch();
    break;
  case 'BSC':
    runner = new BscDataFetch();
    break;
  default:
    throw new Error(`Unknown network: ${currentNetwork}`);
}

console.log(`NetworkRunner: starting ${currentNetwork}: ${runner.name}`);
runner.run();
