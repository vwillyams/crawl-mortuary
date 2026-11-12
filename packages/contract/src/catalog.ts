import { z } from "zod";
import { MonsterKey, Release, SeriesKey } from "./keys.ts";

/**
 * Per-release monster + branch catalog, produced by levelgen's catalog export from a
 * built crawl. Written to data/catalog/<release>.json and committed.
 */

export const BranchKind = z.enum(["main", "portal", "hell", "special"]);

export const BranchInfo = z.object({
  /** Abbreviation used in place keys: "D", "Lair", "Zig". */
  abbrev: z.string(),
  /** Short name: "Lair". */
  name: z.string(),
  /** Long name: "the Lair of Beasts". */
  longName: z.string(),
  /** Number of floors. 1 means a single-floor place, whose PlaceKey has no ":n". */
  depth: z.number().int().positive(),
  /** Parent branch abbreviation, or null for D / Abyss / Pan / portals. */
  parent: z.string().nullable(),
  /** Range of floors in the parent where the entrance can be. */
  entryMin: z.number().int().nullable(),
  entryMax: z.number().int().nullable(),
  kind: BranchKind,
  /** Runes found in this branch, e.g. ["serpentine"]. */
  runes: z.array(z.string()),
});
export type BranchInfo = z.infer<typeof BranchInfo>;

/** One row of crawl's population tables (mon-pick-data.h). Used to classify native / OOD / unexpected. */
export const SpawnEntry = z.object({
  branch: z.string(),
  minDepth: z.number().int(),
  maxDepth: z.number().int(),
  rarity: z.number(),
  /** crawl's distribution shape, e.g. "flat", "peak", "semi", "rise", "fall". */
  distribution: z.string(),
});

export const MonsterInfo = z.object({
  key: MonsterKey,
  /** "MONS_ORC_WARRIOR" */
  enumName: z.string(),
  /** "orc warrior" */
  name: z.string(),
  /** "orc warriors". Kill lists use plurals. */
  plural: z.string(),
  unique: z.boolean(),
  glyph: z.object({ char: z.string(), colour: z.string() }),
  /** Tile name from crawl's rltiles (e.g. "MONS_ORC_WARRIOR"), if any. The web side maps this to an image. */
  tile: z.string().optional(),
  hd: z.number().int(),
  /** Average HP, if derivable. */
  hp: z.number().optional(),
  ac: z.number().int(),
  ev: z.number().int(),
  xp: z.number().optional(),
  /** Free-form monster flags as exported, e.g. ["unique", "fly", "see_invis"]. */
  flags: z.array(z.string()),
  spawns: z.array(SpawnEntry),
  /** crawl's genus ("team") as a MonsterKey, e.g. "draconian" for draconian jobs. Optional (levelgen catalog fills it). */
  genus: MonsterKey.optional(),
  /** Display group, e.g. "draconians", "ugly things". Absent means the monster is its own group. */
  group: z.string().optional(),
  /** Variant dimensions that make sense for this monster: ["colour"], ["heads"], ["base"]. */
  variantDims: z.array(z.string()).optional(),
});
export type MonsterInfo = z.infer<typeof MonsterInfo>;

export const Catalog = z.object({
  schemaVersion: z.literal(1),
  release: Release,
  series: SeriesKey,
  /** Output of `git describe` for the crawl checkout used. */
  crawlCommit: z.string(),
  branches: z.array(BranchInfo),
  monsters: z.array(MonsterInfo),
  /** Extra killer-name aliases → key, e.g. renamed monsters or odd death strings. Optional. */
  aliases: z.record(z.string(), MonsterKey).optional(),
});
export type Catalog = z.infer<typeof Catalog>;
