export class DataPairUtils {
  static GetPairToUse(
    from: string | undefined,
    to: string | undefined
  ): { actualFrom: string | undefined; actualTo: string | undefined } {
    let actualFrom = from;
    let actualTo = to;

    if (from == 'sDAI') {
      actualFrom = 'DAI';
    }
    if (to == 'sDAI') {
      actualTo = 'DAI';
    }
    if (from == 'sUSDS') {
      actualFrom = 'USDS';
    }
    if (to == 'sUSDS') {
      actualTo = 'USDS';
    }

    return { actualFrom, actualTo };
  }
}
