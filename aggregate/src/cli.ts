// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * pnpm run aggregate [-- options]
 *
 *   --series 0.34[,0.33]   series to aggregate (default: 0.34)
 *   --games <path>         GameRow JSONL(.gz) (default: data/games/<series>.jsonl, else fixture). Single series only.
 *   --catalog <path>       Catalog JSON (default: newest data/catalog/<release>.json in the series, else fixture)
 *   --levelgen <path>      LevelgenAggregate JSON (default: as for catalog in data/levelgen/, else fixture)
 *   --no-levelgen          aggregate without levelgen data (no exposure columns)
 *   --config <path>        JSON overrides: { params?, rules?, mainRoute? }
 *   --out <path>           output (default: data/aggregate/aggregate.json)
 *   --include-bots / --include-prerelease
 *   --no-validate          skip zod validation of each game row (faster)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { AggregateFile } from "@mortuary/contract";
import { Aggregator, type SeriesInputs } from "./aggregate.ts";
import { DEFAULT_CONFIG, withOverrides } from "./config.ts";
import { DATA, FIXTURES, findForSeries, loadCatalog, loadLevelgen, pick, readGames, warn, type ReadStats } from "./io.ts";

const { values } = parseArgs({
  options: {
    series: { type: "string", default: "0.34" },
    games: { type: "string" },
    catalog: { type: "string" },
    levelgen: { type: "string" },
    "no-levelgen": { type: "boolean", default: false },
    config: { type: "string" },
    out: { type: "string", default: join(DATA, "aggregate/aggregate.json") },
    "include-bots": { type: "boolean", default: false },
    "include-prerelease": { type: "boolean", default: false },
    "no-validate": { type: "boolean", default: false },
  },
  allowPositionals: true,
});

const seriesList = values.series!.split(",").map((s) => s.trim()).filter(Boolean);
if (seriesList.length > 1 && (values.games || values.catalog || values.levelgen)) {
  throw new Error("--games/--catalog/--levelgen only make sense with a single --series");
}

const config = values.config
  ? withOverrides(DEFAULT_CONFIG, JSON.parse(readFileSync(resolve(values.config), "utf8")))
  : DEFAULT_CONFIG;

const inputs: SeriesInputs[] = [];
const gamePaths: string[] = [];
for (const series of seriesList) {
  const catalogPath = pick("catalog", values.catalog, findForSeries(join(DATA, "catalog"), series), join(FIXTURES, "catalog.json"));
  const catalog = loadCatalog(catalogPath);
  let levelgen;
  if (!values["no-levelgen"]) {
    const lgPath = pick("levelgen", values.levelgen, findForSeries(join(DATA, "levelgen"), series), join(FIXTURES, "levelgen.json"));
    levelgen = loadLevelgen(lgPath);
    if (levelgen.release !== catalog.release) {
      warn(`levelgen release ${levelgen.release} differs from catalog release ${catalog.release}`);
    }
  }
  inputs.push({ series, catalog, levelgen });
  const conventional = [join(DATA, `games/${series}.jsonl`), join(DATA, `games/${series}.jsonl.gz`)].find((p) => existsSync(p));
  gamePaths.push(pick("games", values.games, conventional, join(FIXTURES, "games.jsonl")));
}

const agg = new Aggregator(inputs, {
  includeBots: values["include-bots"]!,
  includePrerelease: values["include-prerelease"]!,
  config,
});
const readStats: ReadStats = { lines: 0, invalid: 0 };
for (const path of new Set(gamePaths)) {
  for await (const g of readGames(path, !values["no-validate"], readStats)) agg.addGame(g);
}

const out = AggregateFile.parse(agg.finish());
mkdirSync(dirname(values.out!), { recursive: true });
writeFileSync(values.out!, JSON.stringify(out, null, 1) + "\n");

const s = agg.stats;
console.log(
  `aggregate: ${readStats.lines} lines (${readStats.invalid} invalid), ${s.seen} games; skipped ${s.skippedBots} bots, ` +
    `${s.skippedPrerelease} prerelease, ${s.skippedNoSeries} other-series, ${s.nonDeaths} non-death endings`,
);
if (Object.keys(s.unknownBranches).length) warn(`death branches not in catalog: ${JSON.stringify(s.unknownBranches)}`);
console.log(`aggregate: ${out.places.length} places, ${out.killers.length} killer rows → ${values.out}`);
