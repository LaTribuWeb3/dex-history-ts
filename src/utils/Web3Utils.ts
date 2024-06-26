import axios from 'axios';
import * as ethers from 'ethers';
import { MulticallProvider, MulticallWrapper } from 'ethers-multicall-provider';
import retry, { sleep } from './Utils';

let lastCallEtherscan = 0;

/**
 * Get the contract creation blocknumber using etherscan api
 * WILL ONLY WORK ON MAINNET
 * @param {string} contractAddress
 * @returns {Promise<number>} blocknumber where the contract was created
 */
export async function GetContractCreationBlockNumber(contractAddress: string, workerName: string): Promise<number> {
  const web3Provider = getJsonRPCProvider();
  console.log(`${workerName}: fetching data for contract ${contractAddress}`);
  const msToWait = 10000 - (Date.now() - lastCallEtherscan);
  if (msToWait > 0) {
    console.log(`${workerName}: Sleeping ${msToWait} ms before calling etherscan`);
    await sleep(msToWait);
  }
  // call etherscan to get the tx receipt of contract creation
  const txHash = await retry(getTxHash, [contractAddress]);
  lastCallEtherscan = Date.now();
  const nullableTransactionReceipt = await web3Provider.getTransactionReceipt(txHash);

  if (nullableTransactionReceipt == null) {
    throw new Error('Transaction receipt for etherscan is null');
  }
  console.log(`${workerName}: returning blocknumber: ${nullableTransactionReceipt.blockNumber}`);
  return nullableTransactionReceipt.blockNumber;
}

async function getTxHash(contractAddress: string): Promise<string> {
  if (process.env.NETWORK == 'MANTLE') {
    return await getTxHashFromMantlescan(contractAddress);
  } else {
    return await getTxHashFromEtherscan(contractAddress);
  }
}

async function getTxHashFromEtherscan(contractAddress: string): Promise<string> {
  const etherscanUrl = `https://api.etherscan.io/api?module=contract&action=getcontractcreation&contractaddresses=${contractAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
  const etherscanResponse = await axios.get(etherscanUrl);

  if (etherscanResponse.data.message == 'NOTOK') {
    throw new Error(`getTxHashFromEtherscan: Error: ${etherscanResponse.data.result}`);
  } else if (etherscanResponse.data.result[0].txHash) {
    return etherscanResponse.data.result[0].txHash;
  } else {
    console.error(etherscanResponse);
    throw new Error('`getTxHashFromEtherscan: unknown error');
  }
}

async function getTxHashFromMantlescan(contractAddress: string): Promise<string> {
  const mantleScanUrl = `https://explorer.mantle.xyz/api/v2/addresses/${contractAddress}`;
  const mantleScanResponse = await axios.get(mantleScanUrl);

  if (!mantleScanResponse.data.creation_tx_hash) {
    throw new Error(`getTxHashFromMantlescan: Error: ${mantleScanResponse.data}`);
  }

  return mantleScanResponse.data.creation_tx_hash;
}
export function getJsonRPCProvider(): ethers.JsonRpcProvider {
  if (!process.env.RPC_URL) {
    throw new Error('Cannot find RPC_URL in env');
  }

  return new ethers.JsonRpcProvider(process.env.RPC_URL);
}

export function getMulticallProvider(): MulticallProvider {
  if (!process.env.RPC_URL) {
    throw new Error('Cannot find RPC_URL in env');
  }

  return MulticallWrapper.wrap(getJsonRPCProvider());
}

export async function getBlocknumberForTimestamp(timestamp: number): Promise<number> {
  let networkKey = 'ethereum';
  if (process.env.NETWORK == 'MANTLE') {
    if (timestamp < 1688644299) {
      return 1;
    }
    networkKey = 'mantle';
  }
  const resp = await axios.get(`https://coins.llama.fi/block/${networkKey}/${timestamp}`);

  if (!resp.data.height) {
    throw Error('No data height in defi lama response');
  } else {
    return resp.data.height as number;
  }
}

export async function getCurrentBlock() {
  const web3Provider = getJsonRPCProvider();
  return (await web3Provider.getBlockNumber()) - 10;
}
