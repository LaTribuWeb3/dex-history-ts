export class DataPairUtils {
  // TODO rewrite this with a map of exceptions in the configuration
  static GetPairToUse(
    from: string | undefined,
    to: string | undefined
  ): { actualFrom: string | undefined; actualTo: string | undefined; } {
    let actualFrom = from;
    let actualTo = to;

    if (from == 'sDAI') {
      actualFrom = 'DAI';
    }
    if (to == 'sDAI') {
      actualTo = 'DAI';
    }

    return { actualFrom, actualTo };
  }
}
