// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * The web's internal data shapes, written by scripts/prepare-data.ts into public/data/ and read at
 * build time by the pages (and, later, fetched client-side). Counts stay ADDITIVE per series so any
 * version selection can be summed in the browser; see lib/select.ts.
 */
import type { KillerKey, PlaceKey, SeriesKey, Variant } from "@mortuary/contract";

export type KillerClass = "native" | "ood" | "unexpected" | "cause" | "unresolved";
export type ReachedGrade = "main" | "lowerBound";
export type ReachedMethod = "implied" | "milestones" | "ratio";

export interface BranchMeta {
  abbrev: string;
  name: string;
  longName: string;
  depth: number;
  parent: string | null;
  entryMin: number | null;
  entryMax: number | null;
  kind: "main" | "portal" | "hell" | "special";
  /** Series in which this branch exists (from that series' catalog). */
  series: SeriesKey[];
}

export interface MonsterMeta {
  key: string;
  name: string;
  plural: string;
  unique: boolean;
  glyph: { char: string; colour: string };
  group?: string;
  variantDims?: string[];
  /** Total deaths per series (for the index page). */
  deaths: Record<SeriesKey, number>;
}

export interface SeriesMeta {
  series: SeriesKey;
  releases: string[];
  catalogRelease: string;
  games: number;
  wins: number;
  firstGame: string;
  lastGame: string;
}

export interface Meta {
  schemaVersion: 1;
  generatedAt: string;
  /** Where the inputs came from, e.g. "fixture" or "data/". Shown on /about. */
  dataSource: { aggregate: string; catalogs: Record<SeriesKey, string> };
  /** Newest first. */
  series: SeriesMeta[];
  defaultSeries: SeriesKey;
  /** Union of branches over all series, in catalog order. */
  branches: BranchMeta[];
  /** Every place that appears in the aggregate or catalog, in navigation order. */
  places: PlaceKey[];
  monsters: Record<string, MonsterMeta>;
  causes: Record<string, string>;
}

/** One killer row at one place in one series. */
export interface KillerCounts {
  key: KillerKey;
  variant: Variant;
  class: KillerClass;
  deaths: number;
  exposure?: number;
  presentExposure?: number;
  firewood?: boolean;
}

export interface PlaceSeriesCounts {
  reached: number;
  reachedMethod: ReachedMethod;
  reachedGrade: ReachedGrade;
  reachedNote?: string;
  deathsTotal: number;
  killers: KillerCounts[];
}

export interface PlaceShard {
  place: PlaceKey;
  bySeries: Record<SeriesKey, PlaceSeriesCounts>;
}

/** One place row in a monster shard; carries the place totals so the shard is self-contained. */
export interface MonsterPlaceCounts {
  place: PlaceKey;
  variant: Variant;
  class: KillerClass;
  deaths: number;
  exposure?: number;
  presentExposure?: number;
  reached: number;
  reachedGrade: ReachedGrade;
  deathsTotal: number;
}

export interface MonsterShard {
  key: string;
  bySeries: Record<SeriesKey, MonsterPlaceCounts[]>;
}

/** File-name-safe encoding of a place key: "Lair:2" -> "Lair_2". */
export function placeFile(place: PlaceKey): string {
  return place.replace(":", "_");
}
