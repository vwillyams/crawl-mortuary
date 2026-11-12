import { z } from "zod";
import { KillerKey, PlaceKey, SeriesKey, Variant } from "./keys.ts";

/**
 * Aggregate output: the single file the webapp's prepare-data step consumes.
 * Written to data/aggregate/aggregate.json. All counts are ADDITIVE across series, so the browser
 * can sum any version range and then compute the ratios. See docs/research/00-plan.md §3, §4, §6.
 */

export const ReachedMethod = z.enum(["implied", "milestones", "ratio"]);
export const ReachedGrade = z.enum(["main", "lowerBound"]);

/** One (series, place) row. */
export const PlaceRow = z.object({
  series: SeriesKey,
  place: PlaceKey,
  /** Estimated number of characters that reached this place. Can be fractional (heuristic credit). */
  reached: z.number(),
  reachedMethod: ReachedMethod,
  /** "main" means accurate enough. "lowerBound" means the UI must label it as a strict lower bound. */
  reachedGrade: ReachedGrade,
  /** Optional human-readable explanation of how `reached` was estimated for this place (shown in the UI tooltip). */
  reachedNote: z.string().optional(),
  /** All deaths here, from any cause, excluding wins. */
  deathsTotal: z.number().int(),
});
export type PlaceRow = z.infer<typeof PlaceRow>;

/**
 * How a killer relates to the generation tables at this place.
 * - native: in this branch's spawn tables at this depth.
 * - ood: in this branch's tables, but at a shallower-than-allowed depth.
 * - unexpected: never generated here (summons, followers, polymorph, etc.).
 *   TODO: split out "summon" once a source records ikiller.
 * - cause: a non-monster cause (@poison and so on).
 * - unresolved: the killer string didn't resolve.
 */
export const KillerClass = z.enum(["native", "ood", "unexpected", "cause", "unresolved"]);

/** One (series, place, killer, variant) row. Present if deaths > 0 OR levelgen generated it there. */
export const KillerRow = z.object({
  series: SeriesKey,
  place: PlaceKey,
  key: KillerKey,
  variant: Variant,
  class: KillerClass,
  deaths: z.number().int(),
  /** reached × mean generated per visit. Derive mean = exposure / reached. Absent if there's no levelgen data. */
  exposure: z.number().optional(),
  /** reached × P(at least one present). Derive pAny = presentExposure / reached. */
  presentExposure: z.number().optional(),
  firewood: z.boolean().optional(),
  hostileFraction: z.number().optional(),
});
export type KillerRow = z.infer<typeof KillerRow>;

export const SeriesInfo = z.object({
  series: SeriesKey,
  /** Releases folded into this series, e.g. ["0.34.0", "0.34.1"]. */
  releases: z.array(z.string()),
  /** Release whose catalog/levelgen data was used. */
  catalogRelease: z.string(),
  games: z.number().int(),
  wins: z.number().int(),
  firstGame: z.string(),
  lastGame: z.string(),
});
export type SeriesInfo = z.infer<typeof SeriesInfo>;

export const AggregateFile = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string(),
  series: z.array(SeriesInfo),
  places: z.array(PlaceRow),
  killers: z.array(KillerRow),
  /** Labels for cause keys: { "@poison": "poison" }. */
  causes: z.record(z.string(), z.string()),
  /** Optional: the tunable parameters the "reached" estimate was computed with (for the methodology page). */
  reachedParams: z.record(z.string(), z.unknown()).optional(),
});
export type AggregateFile = z.infer<typeof AggregateFile>;
