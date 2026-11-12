// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Small-sample statistics for the UI (plan §4): Jeffreys intervals for binomial proportions.
 * Pure functions, no dependencies, so they run identically at build time and in the browser.
 */

/** ln Γ(x) via the Lanczos approximation (g = 7, n = 9). Accurate to ~1e-15 for x > 0. */
export function lnGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  x -= 1;
  let a = c[0]!;
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += c[i]! / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta (Numerical Recipes `betacf`, modified Lentz). */
function betacf(a: number, b: number, x: number): number {
  const MAXIT = 300;
  const EPS = 1e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a, b). */
export function incBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  // Use the continued fraction where it converges fast; otherwise use the symmetry relation.
  if (x < (a + 1) / (a + b + 2)) return (front * betacf(a, b, x)) / a;
  return 1 - (front * betacf(b, a, 1 - x)) / b;
}

/** Quantile of Beta(a, b): the x with I_x(a, b) = p. Bisection, so it's robust for tiny a or b. */
export function betaQuantile(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (incBeta(mid, a, b) < p) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  return (lo + hi) / 2;
}

export interface Interval {
  estimate: number;
  lower: number;
  upper: number;
}

/**
 * Jeffreys interval for a binomial proportion x/n: the Beta(x + ½, n − x + ½) quantiles, with the
 * usual boundary fix (lower = 0 when x = 0, upper = 1 when x = n). n can be fractional, since
 * "reached" is a heuristic estimate. Returns null when n <= 0.
 */
export function jeffreys(x: number, n: number, level = 0.95): Interval | null {
  if (!(n > 0)) return null;
  const xx = Math.min(Math.max(x, 0), n);
  const alpha = 1 - level;
  const a = xx + 0.5;
  const b = n - xx + 0.5;
  return {
    estimate: xx / n,
    lower: xx <= 0 ? 0 : betaQuantile(alpha / 2, a, b),
    upper: xx >= n ? 1 : betaQuantile(1 - alpha / 2, a, b),
  };
}

// TODO(web): empirical-Bayes shrinkage toward the floor mean for rank order (plan §4); for now we sort
// by the raw estimate and grey out rows with fewer than MIN_DEATHS deaths.
export const MIN_DEATHS = 3;
