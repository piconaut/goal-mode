// Numerical helpers.

/** erf via W. J. Cody-style rational approximation (Numerical Recipes erfc, |err| < 1.2e-7). */
export function erf(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? 1 - r : r - 1;
}

/** Standard normal CDF Φ. */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** P(X ≤ b) for a log-normal X with the given mean and log-σ. */
export function lognormCdf(b: number, mean: number, sigma: number): number {
  if (b <= 0) return 0;
  if (!(mean > 0)) return 1;
  if (sigma <= 1e-9) return b >= mean ? 1 : 0;
  const mu = Math.log(mean) - (sigma * sigma) / 2;
  return normCdf((Math.log(b) - mu) / sigma);
}

/** E[min(X, d)] for log-normal X (partial expectation), used to split CPU across periods. */
export function lognormLimitedMean(d: number, mean: number, sigma: number): number {
  if (d <= 0) return 0;
  if (!Number.isFinite(d)) return mean;
  if (sigma <= 1e-9) return Math.min(d, mean);
  const mu = Math.log(mean) - (sigma * sigma) / 2;
  const z = (Math.log(d) - mu) / sigma;
  return mean * normCdf(z - sigma) + d * (1 - normCdf(z));
}

/** Value of a log-normal at quantile q (0..1). */
export function lognormQuantile(q: number, mean: number, sigma: number): number {
  const mu = Math.log(mean) - (sigma * sigma) / 2;
  return Math.exp(mu + sigma * normInv(q));
}

/** Inverse standard normal CDF (Acklam's approximation). */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.928510446969, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  let q: number;
  let r: number;
  if (p < pl) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - pl) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  q = p - 0.5;
  r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}
