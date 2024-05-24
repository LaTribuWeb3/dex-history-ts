export interface Runnable {
  init(): Promise<void>;
  run(): Promise<void>;
  runSpecific(): Promise<void>;
}
