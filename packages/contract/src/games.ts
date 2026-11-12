import { z } from "zod";
import { KillerKey, PlaceKey, Release, SeriesKey, Variant } from "./keys.ts";

/**
 * Normalized game rows: the output of ingest, whatever adapter produced them (dcss-stats dump,
 * our own logfile scrape, or a fixture). Written to data/games/<series>.(parquet|jsonl). It stays outside
 * git except for fixtures.
 *
 * Fields under "future" are optional. Adapters that have them (our own scraper) should fill them in
 * (plan D5). The dcss-stats adapter leaves them undefined.
 */

export const GameSource = z.enum(["dcss-stats", "logfile", "fixture"]);

export const GameRow = z.object({
  /** Stable id: sha1(server|name|start), the same scheme as Sequell/dcss-stats where possible. */
  gameId: z.string(),
  source: GameSource,
  /** Server abbreviation, e.g. "CDI". */
  server: z.string(),
  player: z.string(),
  isBot: z.boolean(),
  release: Release,
  series: SeriesKey,
  isWin: z.boolean(),
  xl: z.number().int(),
  race: z.string(),
  cls: z.string(),
  god: z.string().nullable(),
  turns: z.number().int(),
  runes: z.number().int(),
  uniqueRunes: z.number().int(),
  startAt: z.string(),
  endAt: z.string(),
  /** Where the game ended, from branch + lvl. For wins this is wherever the logfile says (usually D:1). */
  endPlace: PlaceKey,
  /** Kill method, e.g. "mon", "beam", "pois", "quitting", "winning". Raw logfile ktyp, or dcss-stats killerType. */
  ktyp: z.string().nullable(),
  /** Raw killer string, e.g. "an orc warrior", "Sigmund", "a seven-headed hydra". */
  killerRaw: z.string().nullable(),
  /** Resolved killer. null for wins. */
  killer: KillerKey.nullable(),
  /** Resolved variant of the killer, e.g. "heads=7". "" if none. */
  killerVariant: Variant,
  /** One-line end message (tmsg / dcss-stats endMessage). */
  endMessage: z.string(),

  // ---- future (plan D5): filled only by adapters that have them ----
  ikiller: z.string().optional(),
  killermap: z.string().optional(),
  kaux: z.string().optional(),
  seed: z.string().optional(),
});
export type GameRow = z.infer<typeof GameRow>;
