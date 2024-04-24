/**
 * Logs the duration of a function
 * @param {number} dtStart unix timestamp ms
 * @param {number} jobCount the number of job done, to be displayed as nbjob/sec if set
 * @param {number} jobName the name for the jobs done
 */
export function logFnDurationWithLabel(workerName: string, dtStart: number, label: string) {
  const secDuration = (Date.now() - dtStart) / 1000;
  console.log(`${workerName} | ${label} | duration: ${roundTo(secDuration, 2)} s`);
}

/**
 * round a number to 'dec' decimals
 * @param {number} num to round
 * @param {number} dec how many decimals
 * @returns num rounded at dec decimals
 */
function roundTo(num: number, dec = 2) {
  const pow = Math.pow(10, dec);
  return Math.round((num + Number.EPSILON) * pow) / pow;
}
