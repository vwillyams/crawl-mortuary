import { z } from "zod";

/**
 * Shared identifiers. See docs/research/00-plan.md §5.
 *
 * - Release: an exact crawl release tag, e.g. "0.34.1".
 * - SeriesKey: a major release line, e.g. "0.34". This is the version bucket the UI filters on.
 * - PlaceKey: "D:3", "Lair:5", or "Temple" for single-floor places.
 * - MonsterKey: crawl's MONS_* enum name, lowercased and without the prefix: "orc_warrior".
 * - Variant: a canonical sorted "k=v;k=v" string, or "" for none. Examples:
 *   "colour=red", "heads=7", "base=orc".
 * - CauseKey: a non-monster death cause, prefixed with "@": "@poison", "@starvation", "@zot", "@quit".
 * - KillerKey: either of the above, or "unresolved:<raw killer string>".
 */

export const Release = z.string().regex(/^\d+\.\d+(\.\d+)?(-[a-z]\d+)?$/);
export type Release = z.infer<typeof Release>;

export const SeriesKey = z.string().regex(/^\d+\.\d+$/);
export type SeriesKey = z.infer<typeof SeriesKey>;

export const PlaceKey = z.string().regex(/^[A-Za-z]+(:\d+)?$/);
export type PlaceKey = z.infer<typeof PlaceKey>;

export const MonsterKey = z.string().regex(/^[a-z0-9_]+$/);
export type MonsterKey = z.infer<typeof MonsterKey>;

export const CauseKey = z.string().regex(/^@[a-z0-9_]+$/);
export type CauseKey = z.infer<typeof CauseKey>;

export const UnresolvedKey = z.string().regex(/^unresolved:.+$/);

export const KillerKey = z.union([MonsterKey, CauseKey, UnresolvedKey]);
export type KillerKey = z.infer<typeof KillerKey>;

export const Variant = z.string().regex(/^$|^[a-z]+=[a-z0-9_]+(;[a-z]+=[a-z0-9_]+)*$/);
export type Variant = z.infer<typeof Variant>;

/** "0.34.1" -> "0.34"; "0.35-a0" -> "0.35". */
export function seriesOf(release: string): SeriesKey {
  const m = /^(\d+)\.(\d+)/.exec(release);
  if (!m) throw new Error(`not a crawl version: ${release}`);
  return `${m[1]}.${m[2]}`;
}

/** Sortable integer for a release: major*10000 + minor*100 + patch. This is dcss-stats' versionInteger idea. */
export function releaseInteger(release: string): number {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(release);
  if (!m) throw new Error(`not a crawl version: ${release}`);
  return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] ?? 0);
}

/** True for trunk/alpha/beta builds ("0.35-a0", "0.34-b1"), which are excluded from series buckets in v1. */
export function isPrerelease(release: string): boolean {
  return /-[ab]\d+/.test(release);
}

export function placeKey(branch: string, depth: number | null): PlaceKey {
  return depth == null ? branch : `${branch}:${depth}`;
}

export function parsePlace(place: PlaceKey): { branch: string; depth: number | null } {
  const [branch, d] = place.split(":");
  return { branch: branch!, depth: d === undefined ? null : Number(d) };
}

/** Canonical variant string: keys sorted, values lowercased, spaces replaced with "_". */
export function variantKey(parts: Record<string, string | number | undefined>): Variant {
  return Object.entries(parts)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => [k, String(v).toLowerCase().replace(/[^a-z0-9]+/g, "_")] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(";");
}
