// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Version selection (`?v=`) and client-side summing of additive per-series counts.
 *
 *   ?v=0.34          one series
 *   ?v=0.30..0.34    inclusive range (either order)
 *   ?v=all           every series
 *   (absent/invalid) the default (latest) series
 */
import type {
  KillerClass,
  KillerCounts,
  MonsterPlaceCounts,
  MonsterShard,
  PlaceSeriesCounts,
  PlaceShard,
  ReachedGrade,
  ReachedMethod,
} from "./shards";

export type Selection =
  | { kind: "one"; v: string }
  | { kind: "range"; from: string; to: string }
  | { kind: "all" };

function seriesNum(s: string): number {
  const [a, b] = s.split(".");
  return Number(a) * 1000 + Number(b);
}

export function parseSelection(v: string | null | undefined, available: string[], fallback: string): Selection {
  if (!v) return { kind: "one", v: fallback };
  if (v === "all") return { kind: "all" };
  const range = /^(\d+\.\d+)\.\.(\d+\.\d+)$/.exec(v);
  if (range) return { kind: "range", from: range[1]!, to: range[2]! };
  if (available.includes(v)) return { kind: "one", v };
  return { kind: "one", v: fallback };
}

export function selectionToParam(sel: Selection): string {
  if (sel.kind === "all") return "all";
  if (sel.kind === "range") return `${sel.from}..${sel.to}`;
  return sel.v;
}

/** The series keys covered by a selection, newest first. */
export function resolveSelection(sel: Selection, available: string[]): string[] {
  const sorted = [...available].sort((a, b) => seriesNum(b) - seriesNum(a));
  if (sel.kind === "all") return sorted;
  if (sel.kind === "one") return sorted.filter((s) => s === sel.v);
  const lo = Math.min(seriesNum(sel.from), seriesNum(sel.to));
  const hi = Math.max(seriesNum(sel.from), seriesNum(sel.to));
  return sorted.filter((s) => seriesNum(s) >= lo && seriesNum(s) <= hi);
}

export function selectionLabel(sel: Selection): string {
  if (sel.kind === "all") return "all versions";
  if (sel.kind === "range") return `${sel.from}–${sel.to}`;
  return sel.v;
}

const worseGrade = (a: ReachedGrade, b: ReachedGrade): ReachedGrade =>
  a === "lowerBound" || b === "lowerBound" ? "lowerBound" : "main";

/** A killer row summed over series. `exposureReached` is the reached count for the series that had exposure. */
export interface CombinedKiller {
  key: string;
  variant: string;
  class: KillerClass;
  deaths: number;
  exposure?: number;
  presentExposure?: number;
  /** Σ reached over the series where this row had levelgen exposure, which is the denominator for mean/pAny. */
  exposureReached: number;
  firewood: boolean;
}

export interface CombinedPlace {
  reached: number;
  reachedMethods: ReachedMethod[];
  reachedGrade: ReachedGrade;
  reachedNotes: string[];
  deathsTotal: number;
  killers: CombinedKiller[];
  /** Series that actually had data for this place. */
  series: string[];
}

function addKiller(acc: Map<string, CombinedKiller>, k: KillerCounts, reached: number) {
  const id = `${k.key}\u0000${k.variant}`;
  let row = acc.get(id);
  if (!row) {
    row = { key: k.key, variant: k.variant, class: k.class, deaths: 0, exposureReached: 0, firewood: false };
    acc.set(id, row);
  }
  row.deaths += k.deaths;
  if (k.exposure !== undefined) {
    row.exposure = (row.exposure ?? 0) + k.exposure;
    row.presentExposure = (row.presentExposure ?? 0) + (k.presentExposure ?? 0);
    row.exposureReached += reached;
  }
  if (k.firewood) row.firewood = true;
  // TODO(web): a killer can be "native" in one series and "ood" in another; we keep the first seen.
}

export function combinePlace(shard: PlaceShard, series: string[]): CombinedPlace | null {
  const parts = series.map((s) => [s, shard.bySeries[s]] as const).filter((p): p is [string, PlaceSeriesCounts] => !!p[1]);
  if (parts.length === 0) return null;
  const acc = new Map<string, CombinedKiller>();
  const out: CombinedPlace = {
    reached: 0,
    reachedMethods: [],
    reachedGrade: "main",
    reachedNotes: [],
    deathsTotal: 0,
    killers: [],
    series: parts.map(([s]) => s),
  };
  for (const [, p] of parts) {
    out.reached += p.reached;
    out.deathsTotal += p.deathsTotal;
    out.reachedGrade = worseGrade(out.reachedGrade, p.reachedGrade);
    if (!out.reachedMethods.includes(p.reachedMethod)) out.reachedMethods.push(p.reachedMethod);
    if (p.reachedNote && !out.reachedNotes.includes(p.reachedNote)) out.reachedNotes.push(p.reachedNote);
    for (const k of p.killers) addKiller(acc, k, p.reached);
  }
  out.killers = [...acc.values()];
  return out;
}

export interface CombinedMonsterPlace {
  place: string;
  variant: string;
  class: KillerClass;
  deaths: number;
  exposure?: number;
  presentExposure?: number;
  exposureReached: number;
  reached: number;
  reachedGrade: ReachedGrade;
  deathsTotal: number;
}

export function combineMonster(shard: MonsterShard, series: string[]): CombinedMonsterPlace[] {
  const acc = new Map<string, CombinedMonsterPlace>();
  for (const s of series) {
    for (const r of shard.bySeries[s] ?? ([] as MonsterPlaceCounts[])) {
      const id = `${r.place}\u0000${r.variant}`;
      let row = acc.get(id);
      if (!row) {
        row = {
          place: r.place,
          variant: r.variant,
          class: r.class,
          deaths: 0,
          exposureReached: 0,
          reached: 0,
          reachedGrade: "main",
          deathsTotal: 0,
        };
        acc.set(id, row);
      }
      row.deaths += r.deaths;
      row.reached += r.reached;
      row.deathsTotal += r.deathsTotal;
      row.reachedGrade = worseGrade(row.reachedGrade, r.reachedGrade);
      if (r.exposure !== undefined) {
        row.exposure = (row.exposure ?? 0) + r.exposure;
        row.presentExposure = (row.presentExposure ?? 0) + (r.presentExposure ?? 0);
        row.exposureReached += r.reached;
      }
    }
  }
  return [...acc.values()];
}
