// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Logfile adapter (our own scrape). For now it reads only **local** logfiles; there's no network fetching yet.
 *
 * TODO(ingest): fetching. Use sources.yaml (servers × versions, as in dcss-stats seedData / Sequell sources.yml),
 *   HTTP Range continuation from a stored byte offset, a polite rate limit and a generic User-Agent.
 *   Raw bytes are mirrored under data/raw/. See docs/research/02-morgue-scraping.md §5.
 * TODO(ingest): milestones (the "reached" denominator) are a separate reader once fetching exists.
 */
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import type { GameSourceAdapter, RawGame } from "../types.ts";
import { isPotentialXlogLine, parseXlogLine, type Xlog, xlogTimeToIso } from "../xlog.ts";

const num = (v: string | undefined) => (v === undefined || v === "" ? 0 : Number(v));
const opt = (v: string | undefined) => (v === undefined || v === "" ? undefined : v);

export function rawFromXlog(x: Xlog, server: string): RawGame {
  if (!x.v || !x.name || !x.start || !x.end || !x.br) throw new Error("xlog line missing v/name/start/end/br");
  return {
    source: "logfile",
    server,
    player: x.name,
    version: x.v,
    isWin: x.ktyp === "winning",
    xl: num(x.xl),
    race: x.race ?? "",
    cls: x.cls ?? "",
    god: opt(x.god) ?? null,
    turns: num(x.turn),
    runes: num(x.nrune),
    uniqueRunes: num(x.urune),
    startAt: xlogTimeToIso(x.start),
    endAt: xlogTimeToIso(x.end),
    branch: x.br,
    lvl: num(x.lvl),
    ktyp: opt(x.ktyp) ?? null,
    killer: opt(x.killer) ?? null,
    killerFlags: opt(x.killer_flags) ?? null,
    endMessage: x.tmsg ?? "",
    ikiller: opt(x.ikiller),
    killermap: opt(x.killermap),
    kaux: opt(x.kaux),
    seed: opt(x.seed),
  };
}

export function logfileSource(opts: { files: { path: string; server: string }[] }): GameSourceAdapter {
  return {
    name: "logfile",
    async *read() {
      if (opts.files.length === 0) throw new Error("logfile: pass --logfile <path> --server <abbr> (network fetching is TODO)");
      for (const f of opts.files) {
        const rl = createInterface({ input: createReadStream(f.path), crlfDelay: Infinity });
        let n = 0;
        for await (const line of rl) {
          n++;
          if (!isPotentialXlogLine(line.trim())) continue;
          try {
            yield rawFromXlog(parseXlogLine(line), f.server);
          } catch (e) {
            // TODO(ingest): collect into an invalid-lines report instead of logging.
            console.warn(`${f.path}:${n}: ${(e as Error).message}`);
          }
        }
      }
    },
  };
}
