import { readFileSync } from 'fs';
import axios, { AxiosResponse } from 'axios';
import retry from '../utils/Utils';

export class Configuration {
  static async loadConfig<T>(fileOrURL: string): Promise<T> {
    // Log(`LoadConfiguration: loading tokens data from ${TOKENS_FILE}`);
    if (fileOrURL.startsWith('http')) {
      // load via http
      return await Configuration.HttpGet<T>(fileOrURL);
    } else {
      // read from filesystem
      return JSON.parse(readFileSync(fileOrURL, 'utf-8')) as T;
    }
  }

  static async HttpGet<T>(url: string, config?: any): Promise<T> {
    const axiosResp: AxiosResponse<T> = (await retry(axios.get, [url, config])) as AxiosResponse<T>;

    return axiosResp.data;
  }
}
