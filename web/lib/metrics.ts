// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Display metrics (plan §4), computed from summed additive counts:
 *   1. share of deaths on this floor     = deaths / deathsTotal       (primary; needs no "reached")
 *   2. expected per visit / P(any)       = exposure / reached, presentExposure / reached
 *   3. deaths per 1,000 reaching floor   = 1000 · deaths / reached    (asterisked)
 *   4. deaths per monster generated      = deaths / exposure          (asterisked; lower bound on per-encounter danger)
 */
import { jeffreys, MIN_DEATHS, type Interval } from "./stats";

export interface Counts {
  deaths: number;
  deathsTotal: number;
  reached: number;
  exposure?: number;
  presentExposure?: number;
  /** Reached summed over only the series that had exposure. Defaults to reached. */
  exposureReached?: number;
}

export interface Metrics {
  share: Interval | null;
  per1000: Interval | null;
  expected: number | null;
  pAny: number | null;
  perGenerated: number | null;
  lowData: boolean;
}

export function metrics(c: Counts): Metrics {
  const er = c.exposureReached ?? c.reached;
  const per = jeffreys(c.deaths, c.reached);
  return {
    share: jeffreys(c.deaths, c.deathsTotal),
    per1000: per && { estimate: per.estimate * 1000, lower: per.lower * 1000, upper: per.upper * 1000 },
    expected: c.exposure !== undefined && er > 0 ? c.exposure / er : null,
    pAny: c.presentExposure !== undefined && er > 0 ? c.presentExposure / er : null,
    // TODO(web): Poisson/Gamma interval for deaths-per-generated; point estimate only for now.
    perGenerated: c.exposure !== undefined && c.exposure > 0 ? c.deaths / c.exposure : null,
    lowData: c.deaths < MIN_DEATHS,
  };
}

export const fmtPct = (x: number | null | undefined, digits = 1) =>
  x == null || !Number.isFinite(x) ? "—" : `${(x * 100).toFixed(digits)}%`;

export function fmtNum(x: number | null | undefined, digits = 2): string {
  if (x == null || !Number.isFinite(x)) return "—";
  if (x !== 0 && Math.abs(x) < 0.01) return x.toExponential(1);
  return x.toFixed(digits);
}

export const fmtInt = (x: number | null | undefined) =>
  x == null || !Number.isFinite(x) ? "—" : Math.round(x).toLocaleString("en-US");

/** "1 in N" phrasing for small rates. */
export function oneIn(rate: number | null): string {
  if (rate == null || !(rate > 0)) return "—";
  const n = 1 / rate;
  return n < 10 ? `1 in ${n.toFixed(1)}` : `1 in ${Math.round(n).toLocaleString("en-US")}`;
}
