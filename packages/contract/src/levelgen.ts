import { z } from "zod";
import { MonsterKey, PlaceKey, Release, Variant } from "./keys.ts";

/**
 * Levelgen sampling output. See docs/research/01-monster-sampling.md §7.
 *
 * Raw output is gzipped JSONL, one line per generated level instance. It stays outside git (scratch / R2).
 * The aggregate goes to data/levelgen/<release>.json and is committed. Every number in it is an
 * additive sufficient statistic.
 */

export const LevelgenSource = z.enum(["pregen-lua", "objstat"]);

/** One raw JSONL line. levelgen emits it; only levelgen's own aggregator reads it. */
export const LevelgenRawLine = z.object({
  release: Release,
  seed: z.union([z.number(), z.string()]),
  place: PlaceKey,
  vaults: z.array(z.string()),
  monsters: z.array(
    z.object({
      key: MonsterKey,
      variant: Variant,
      name: z.string(),
      n: z.number().int(),
      vault: z.number().int(),
      hostile: z.number().int(),
      unique: z.boolean(),
      firewood: z.boolean(),
    }),
  ),
});
export type LevelgenRawLine = z.infer<typeof LevelgenRawLine>;

export const PlaceSample = z.object({
  place: PlaceKey,
  /** Number of level instances generated for this place. This is the denominator for every mean. */
  instances: z.number().int(),
  /** Seeds in the run. instances/seeds = P(the place exists in a game), e.g. for S-branches and portals. */
  seeds: z.number().int(),
  source: LevelgenSource,
});
export type PlaceSample = z.infer<typeof PlaceSample>;

export const MonsterAtPlace = z.object({
  place: PlaceKey,
  key: MonsterKey,
  variant: Variant,
  /** Σ count over instances. Mean per visit = sum / instances. */
  sum: z.number(),
  /** Σ count² over instances, for variance. */
  sumSq: z.number(),
  /** Number of instances with at least one. P(any) = present / instances. */
  present: z.number().int(),
  /** Part of sum placed by vaults. */
  vaultSum: z.number(),
  /** Part of sum that was hostile at generation. */
  hostileSum: z.number(),
  /** Part of sum flagged out-of-depth at generation. TODO(levelgen): populate if the generator exposes it. */
  oodSum: z.number().optional(),
  unique: z.boolean(),
  firewood: z.boolean(),
});
export type MonsterAtPlace = z.infer<typeof MonsterAtPlace>;

export const LevelgenAggregate = z.object({
  schemaVersion: z.literal(1),
  release: Release,
  crawlCommit: z.string(),
  seeds: z.number().int(),
  places: z.array(PlaceSample),
  monsters: z.array(MonsterAtPlace),
});
export type LevelgenAggregate = z.infer<typeof LevelgenAggregate>;
