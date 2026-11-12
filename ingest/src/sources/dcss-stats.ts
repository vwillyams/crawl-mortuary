// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * dcss-stats adapter (plan D7). It maps rows of dcss-stats' Prisma `Game` ⨝ `Player` tables
 * (https://github.com/O4epegb/dcss-stats, apps/api/prisma/schema.prisma) to RawGame.
 *
 * Caveats from their schema and parser (apps/api/src/parser/processGames.ts, utils.ts):
 * - There's **no ktyp**. `Game.killerType` is "unique" when killer_flags=unique, otherwise null.
 *   normalize.ts infers ktyp from `endMessage` (tmsg).
 * - `version` is the raw logfile `v`; `versionShort` is "0.34".
 * - `branch` + `lvl` are the logfile br/lvl; we derive the place key from them.
 * - `startAt`/`endAt` are logfile timestamps with month+1, stored as UTC. That matches our xlogTimeToIso.
 * - Not available: ikiller, killermap, kaux, seed, place (plan D5).
 *
 * Loading:
 * - Today: restore their dump into Postgres, export with psql to JSONL (one row_to_json object per line),
 *   and point DCSS_STATS_ROWS_JSONL at the file:
 *
 *       psql "$DCSS_STATS_DATABASE_URL" -At -c "SELECT row_to_json(t) FROM ($(pnpm -s tsx src/sources/print-dcss-sql.ts 0.34)) t" > rows.jsonl
 *
 * - TODO(ingest): read directly from DCSS_STATS_DATABASE_URL with a streaming pg cursor. That's held
 *   off until we actually have a dump; the JSONL route needs no extra dependency.
 * - TODO(ingest): if the dump arrives as pg_dump custom format, document the pg_restore step here.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { GameSourceAdapter, RawGame } from "../types.ts";

/** Columns we select. Names match the Prisma model fields (quoted camelCase in Postgres). */
export const DcssStatsRow = z.object({
  id: z.string(),
  isWin: z.boolean(),
  startAt: z.union([z.string(), z.date()]),
  endAt: z.union([z.string(), z.date()]),
  version: z.string(),
  versionShort: z.string(),
  xl: z.number(),
  race: z.string(),
  class: z.string(),
  god: z.string().nullable(),
  turns: z.number(),
  runes: z.number(),
  uniqueRunes: z.number(),
  branch: z.string(),
  lvl: z.number(),
  killer: z.string().nullable(),
  killerType: z.string().nullable(),
  endMessage: z.string(),
  name: z.string(),
  serverAbbreviation: z.string().nullable(),
  isBot: z.boolean(),
});
export type DcssStatsRow = z.infer<typeof DcssStatsRow>;

/** SQL for one series. The parameter is the versionShort, e.g. "0.34". */
export const DCSS_STATS_SQL = `
SELECT g.id, g."isWin", g."startAt", g."endAt", g.version, g."versionShort",
       g.xl, g.race, g.class, g.god, g.turns, g.runes, g."uniqueRunes",
       g.branch, g.lvl, g.killer, g."killerType", g."endMessage", g.name,
       g."serverAbbreviation", p."isBot"
FROM "Game" g
JOIN "Player" p ON p.id = g."playerId"
WHERE g."versionShort" = $1
ORDER BY g."endAt"`.trim();

/** SQL with the series inlined (for psql one-liners). The series is validated to avoid injection. */
export function dcssStatsSqlFor(series: string): string {
  if (!/^\d+\.\d+$/.test(series)) throw new Error(`bad series: ${series}`);
  return DCSS_STATS_SQL.replace("$1", `'${series}'`);
}

const iso = (d: string | Date) => (d instanceof Date ? d : new Date(d)).toISOString();

export function rawFromDcssStats(r: DcssStatsRow): RawGame {
  return {
    source: "dcss-stats",
    server: r.serverAbbreviation ?? "unknown",
    player: r.name,
    isBotHint: r.isBot,
    version: r.version,
    isWin: r.isWin,
    xl: r.xl,
    race: r.race,
    cls: r.class,
    god: r.god,
    turns: r.turns,
    runes: r.runes,
    uniqueRunes: r.uniqueRunes,
    startAt: iso(r.startAt),
    endAt: iso(r.endAt),
    branch: r.branch,
    lvl: r.lvl,
    ktyp: null, // not stored by dcss-stats; inferred from endMessage in normalize.ts
    killer: r.killer,
    killerFlags: r.killerType, // "unique" | null
    endMessage: r.endMessage,
  };
}

export function dcssStatsSource(env: NodeJS.ProcessEnv = process.env): GameSourceAdapter {
  return {
    name: "dcss-stats",
    async *read() {
      const jsonl = env.DCSS_STATS_ROWS_JSONL;
      if (jsonl) {
        const rl = createInterface({ input: createReadStream(jsonl), crlfDelay: Infinity });
        for await (const line of rl) {
          if (line.trim()) yield rawFromDcssStats(DcssStatsRow.parse(JSON.parse(line)));
        }
        return;
      }
      if (env.DCSS_STATS_DATABASE_URL) {
        // TODO(ingest): stream DCSS_STATS_SQL from Postgres directly (pg + pg-cursor), parameterised by series.
        throw new Error("dcss-stats: direct Postgres reading is not implemented yet. Export to JSONL and set DCSS_STATS_ROWS_JSONL (see src/sources/dcss-stats.ts)");
      }
      throw new Error("dcss-stats: set DCSS_STATS_ROWS_JSONL (or, later, DCSS_STATS_DATABASE_URL). No dump has been supplied yet.");
    },
  };
}
