import BigNumber from 'bignumber.js';
import { BLOCK_TIME } from '../../../utils/Constants';

export class MerchantMoeV2Constants {
  static CONSTANT_1e18 = new BigNumber(10).pow(18);
  static CONSTANT_TARGET_SLIPPAGE = 20;
  static CONSTANT_BLOCK_INTERVAL = 3600 / BLOCK_TIME;
  static CONSTANT_FACTORY_ADDRESS = '0xa6630671775c4EA2743840F9A5016dCf2A104054';
}
