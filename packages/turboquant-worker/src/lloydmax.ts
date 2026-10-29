/**
 * Lloyd–Max 8-level optimal scalar quantizer for N(0,1).
 *
 * The optimal quantizer satisfies the two classic fixed-point conditions
 * (Max 1960): thresholds sit at midpoints of adjacent reconstruction levels,
 * and each level is the conditional mean of its region under the standard
 * normal density. Using the identities φ'(x) = −x·φ(x) and
 * ∫ x φ(x) dx = φ(a) − φ(b):
 *
 *   t_k = (c_k + c_{k+1}) / 2
 *   c_k = (φ(t_{k−1}) − φ(t_k)) / (Φ(t_k) − Φ(t_{k−1}))
 *
 * Initialized at equal-spaced Gaussian quantiles c_k = Φ⁻¹((2k+1)/16),
 * iterated to convergence (Δ < 1e-9) or 200 iterations. Computed lazily once
 * and cached — the tables are shared by every record.
 *
 * Known optimum (symmetric, 8 levels): thresholds ≈ ±0.5006, ±1.0500, ±1.7481
 * (plus the central 0 boundary), centroids ≈ ±0.2451, ±0.7560, ±1.3439,
 * ±2.1520. The tests assert these to loose tolerances.
 */

export interface LloydMax8 {
  /** 7 interior thresholds, ascending (thresholds[3] === 0 by symmetry). */
  readonly thresholds: Float64Array;
  /** 8 reconstruction centroids, ascending, symmetric around 0. */
  readonly centroids: Float64Array;
}

/** Standard normal density φ(x). */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) * 0.3989422804014327; // 1/√(2π)
}

/** erf via the alternating Taylor series (accurate double precision for |x| ≤ 3). */
function erfSeries(x: number): number {
  const x2 = x * x;
  let term = x; // n = 0 term: x^1 / (0!·1)
  let sum = x;
  for (let n = 1; n < 200; n++) {
    term *= -x2 / n;
    const t = term / (2 * n + 1);
    sum += t;
    if (Math.abs(t) <= 1e-18 * Math.abs(sum)) break;
  }
  return (2 / Math.sqrt(Math.PI)) * sum;
}

export function erf(x: number): number {
  return x >= 0 ? erfSeries(x) : -erfSeries(-x);
}

/** Standard normal CDF Φ(x). */
export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/** Inverse standard normal CDF (Acklam's rational approximation, |err| < 1.15e-9). */
export function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

let cached: LloydMax8 | null = null;

/** Get (compute once, cache) the optimal 8-level Lloyd–Max quantizer for N(0,1). */
export function getLloydMax8(): LloydMax8 {
  if (cached !== null) return cached;
  const centroids = new Float64Array(8);
  const thresholds = new Float64Array(7);
  for (let k = 0; k < 8; k++) centroids[k] = probit((2 * k + 1) / 16);

  const next = new Float64Array(8);
  for (let iter = 0; iter < 200; iter++) {
    for (let k = 0; k < 7; k++) thresholds[k] = 0.5 * (centroids[k] + centroids[k + 1]);
    for (let k = 0; k < 8; k++) {
      const plo = k === 0 ? 0 : normPdf(thresholds[k - 1]);
      const phi = k === 7 ? 0 : normPdf(thresholds[k]);
      const clo = k === 0 ? 0 : normCdf(thresholds[k - 1]);
      const chi = k === 7 ? 1 : normCdf(thresholds[k]);
      const prob = chi - clo;
      next[k] = prob > 1e-300 ? (plo - phi) / prob : centroids[k];
    }
    let maxDelta = 0;
    for (let k = 0; k < 8; k++) {
      const d = Math.abs(next[k] - centroids[k]);
      if (d > maxDelta) maxDelta = d;
      centroids[k] = next[k];
    }
    if (maxDelta < 1e-9) break;
  }
  for (let k = 0; k < 7; k++) thresholds[k] = 0.5 * (centroids[k] + centroids[k + 1]);
  cached = { thresholds, centroids };
  return cached;
}

/**
 * Quantize a N(0,1)-distributed scalar to its index 0..7.
 * Convention: index k for t_{k−1} < v ≤ t_k (ties at exact thresholds are
 * measure-zero and resolve deterministically to the lower region's index).
 */
export function quantizeScalarIndex(v: number): number {
  const t = getLloydMax8().thresholds;
  if (v <= t[0]) return 0;
  if (v <= t[1]) return 1;
  if (v <= t[2]) return 2;
  if (v <= t[3]) return 3;
  if (v <= t[4]) return 4;
  if (v <= t[5]) return 5;
  if (v <= t[6]) return 6;
  return 7;
}

/** Reconstruct the centroid value for code index i (0..7). */
export function decodeIndex(i: number): number {
  return getLloydMax8().centroids[i];
}
