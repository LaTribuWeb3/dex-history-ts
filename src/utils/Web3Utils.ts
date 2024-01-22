import * as ethers from 'ethers';
import { retry, sleep } from './Utils';
import axios, { AxiosResponse } from 'axios';

/**
 * Get the contract creation blocknumber using etherscan api
 * WILL ONLY WORK ON MAINNET
 * @param {string} contractAddress
 * @returns {Promise<number>} blocknumber where the contract was created
 */
export async function GetContractCreationBlockNumber(contractAddress: string, workerName: string): Promise<number> {
  let lastCallEtherscan = 0;
  const web3Provider = getJsonRPCProvider();
  console.log(`${workerName}: fetching data for contract ${contractAddress}`);
  const msToWait = 10000 - (Date.now() - lastCallEtherscan);
  if (msToWait > 0) {
    console.log(`${workerName}: Sleeping ${msToWait} before calling etherscan`);
    await sleep(msToWait);
  }
  // call etherscan to get the tx receipt of contract creation
  const etherscanUrl = `https://api.etherscan.io/api?module=contract&action=getcontractcreation&contractaddresses=${contractAddress}&apikey=${process.env.ETHERSCAN_API_KEY}`;
  const etherscanResponse = await retry(axios.get, [etherscanUrl]);
  lastCallEtherscan = Date.now();

  const receipt: ethers.ethers.TransactionReceipt = await getReceiptOrCrash(await web3Provider, etherscanResponse);
  // console.log(receipt);
  console.log(`${workerName}: returning blocknumber: ${receipt.blockNumber}`);
  return receipt.blockNumber;
}

export async function getJsonRPCProvider(): Promise<ethers.JsonRpcProvider> {
  for (let i = 0; i < 10; i++) {
    try {
      return new ethers.JsonRpcProvider(process.env.RPC_URL);
    } catch (e) {
      console.log('Could not open JSON RPC because ' + e);
      await sleep(1 ** i * 1000);
    }
  }
  throw new Error('Could not instantiate JSON RPC');
}

export async function getReceiptOrCrash(
  web3Provider: ethers.ethers.JsonRpcProvider,
  etherscanResponse: any
): Promise<ethers.ethers.TransactionReceipt> {
  const nullableTransactionReceipt = await web3Provider.getTransactionReceipt(etherscanResponse.data.result[0].txHash);
  if (nullableTransactionReceipt == null) throw new Error('Transaction receipt for etherscan is null');
  return nullableTransactionReceipt;
}
