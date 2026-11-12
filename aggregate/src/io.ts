// SPDX-License-Identifier: AGPL-3.0-or-later
import { createReadStream, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { Catalog, GameRow, LevelgenAggregate, releaseInteger, seriesOf } from "@mortuary/contract";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA = join(REPO_ROOT, "data");
export const FIXTURES = join(REPO_ROOT, "packages/contract/fixtures");

export function warn(msg: string): void {
  process.stderr.write(`aggregate: ${msg}\n`);
}

/**
 * Highest-release file in `dir` named <release>.json whose series matches, or undefined.
 * Example: data/catalog/0.34.1.json.
 */
export function findForSeries(dir: string, series: string): string | undefined {
  if (!existsSync(dir)) return undefined;
  const candidates = readdirSync(dir)
    .filter((f) => /^\d+\.\d+(\.\d+)?\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ""))
    .filter((r) => seriesOf(r) === series)
    .sort((a, b) => releaseInteger(b) - releaseInteger(a));
  return candidates[0] ? join(dir, `${candidates[0]}.json`) : undefined;
}

export function loadCatalog(path: string): Catalog {
  return Catalog.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadLevelgen(path: string): LevelgenAggregate {
  return LevelgenAggregate.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Resolve an input path: explicit flag, then data/ convention, then fixture (with a warning). */
export function pick(kind: string, explicit: string | undefined, conventional: string | undefined, fixture: string): string {
  if (explicit) return resolve(explicit);
  if (conventional && existsSync(conventional)) return conventional;
  warn(`no ${kind} in data/, falling back to fixture ${fixture.replace(REPO_ROOT + "/", "")}`);
  return fixture;
}

export interface ReadStats {
  lines: number;
  invalid: number;
}

/** Stream GameRows from a JSONL file (optionally .gz), validating each with zod unless validate=false. */
export async function* readGames(path: string, validate = true, stats: ReadStats = { lines: 0, invalid: 0 }): AsyncGenerator<GameRow> {
  // TODO(aggregate): read data/games/<series>.parquet too, via DuckDB, if ingest switches to parquet.
  const input = path.endsWith(".gz") ? createReadStream(path).pipe(createGunzip()) : createReadStream(path);
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    stats.lines++;
    const raw = JSON.parse(line);
    if (!validate) {
      yield raw as GameRow;
      continue;
    }
    const r = GameRow.safeParse(raw);
    if (r.success) yield r.data;
    else {
      stats.invalid++;
      if (stats.invalid <= 5) warn(`invalid game row at line ${stats.lines}: ${r.error.issues[0]?.message}`);
    }
  }
}
