// Multi-period split: a transaction's service ages it through periods. With log-normal
// service per transaction we can compute, analytically, how CPU and completions fall
// into each period.

import { lognormCdf, lognormLimitedMean } from '../core/math';

export interface PeriodShare {
  /** Fraction of total CPU consumed while in this period. */
  cpuFrac: number;
  /** Fraction of transactions that complete in this period. */
  endFrac: number;
  /** Mean service (SU) of transactions that complete in this period. */
  meanSuOfEnders: number;
}

export function splitPeriods(
  durationsSu: readonly (number | null)[],
  meanSu: number,
  sigma: number,
): PeriodShare[] {
  const out: PeriodShare[] = [];
  let lo = 0;
  let loLimited = 0;
  let loCdf = 0;
  for (let i = 0; i < durationsSu.length; i++) {
    const d = durationsSu[i];
    const hi = d == null || i === durationsSu.length - 1 ? Infinity : lo + d;
    const hiLimited = lognormLimitedMean(hi, meanSu, sigma);
    const hiCdf = hi === Infinity ? 1 : lognormCdf(hi, meanSu, sigma);
    const endFrac = Math.max(0, hiCdf - loCdf);
    // E[X; lo < X <= hi] = (E[min(X,hi)] - hi(1-F(hi))) - (E[min(X,lo)] - lo(1-F(lo)))
    const tailHi = hi === Infinity ? 0 : hi * (1 - hiCdf);
    const tailLo = lo * (1 - loCdf);
    const partial = hiLimited - tailHi - (loLimited - tailLo);
    out.push({
      cpuFrac: meanSu > 0 ? Math.max(0, (hiLimited - loLimited) / meanSu) : i === 0 ? 1 : 0,
      endFrac,
      meanSuOfEnders: endFrac > 1e-12 ? partial / endFrac : 0,
    });
    if (hi === Infinity) break;
    lo = hi;
    loLimited = hiLimited;
    loCdf = hiCdf;
  }
  return out;
}

/** Period a unit of work is in after consuming `serviceSu`: each DUR is the service spent in
 * that period before moving on (SG24-7621 §3.6). Service is CPU time only: since z/OS V2R5 the
 * coefficients and I/O/MSO service no longer count (MVS Planning: WLM, "Calculating the amount of
 * service consumed"). Long-running address spaces never end a transaction, so they accumulate
 * service and age into the last period. */
export function periodAtService(durationsSu: readonly (number | null)[], serviceSu: number): number {
  let lo = 0;
  for (let i = 0; i < durationsSu.length - 1; i++) {
    const d = durationsSu[i];
    if (d == null) return i;
    lo += d;
    if (serviceSu < lo) return i;
  }
  return Math.max(0, durationsSu.length - 1);
}
