// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * pnpm run ingest -- --series 0.34 [--source fixture|dcss-stats|logfile] [options]
 *
 *   --catalog <path>          catalog JSON (default: newest data/catalog/<series>.*.json, else the contract fixture)
 *   --out <path>              output JSONL (default: data/games/<series>.jsonl)
 *   --include-prerelease      keep trunk/alpha/beta builds (excluded by default)
 *   --synthesize <n>          fixture source: append n synthetic games
 *   --logfile <path> --server <abbr>   logfile source: local logfile(s); repeat both flags in pairs
 *
 * It also writes <out without .jsonl>.report.json: exclusion counts, killer-rule counts and the top unresolved killers.
 */
import { createWriteStream, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { loadCatalog, REPO_ROOT } from "./catalog.ts";
import { Normalizer } from "./normalize.ts";
import { dcssStatsSource } from "./sources/dcss-stats.ts";
import { fixtureSource } from "./sources/fixture.ts";
import { logfileSource } from "./sources/logfile.ts";
import type { GameSourceAdapter } from "./types.ts";

// `pnpm run ingest -- --series 0.34` forwards a literal "--", which parseArgs would treat as end-of-options.
const argv = process.argv.slice(2).filter((a, i) => !(i === 0 && a === "--"));

const { values } = parseArgs({
  args: argv,
  options: {
    series: { type: "string", default: "0.34" },
    source: { type: "string", default: "fixture" },
    catalog: { type: "string" },
    out: { type: "string" },
    "include-prerelease": { type: "boolean", default: false },
    synthesize: { type: "string" },
    logfile: { type: "string", multiple: true },
    server: { type: "string", multiple: true },
  },
  allowPositionals: true,
});

const series = values.series!;

/** Newest real catalog for the series (e.g. data/catalog/0.34.1.json), if levelgen has produced one. */
function defaultCatalogPath(): string | undefined {
  try {
    const files = readdirSync(`${REPO_ROOT}data/catalog`)
      .filter((f) => f.startsWith(`${series}.`) && f.endsWith(".json"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return files.length ? `${REPO_ROOT}data/catalog/${files.at(-1)}` : undefined;
  } catch {
    return undefined;
  }
}

const { catalog, path: catalogPath } = loadCatalog({ path: values.catalog ?? defaultCatalogPath() });

let source: GameSourceAdapter;
switch (values.source) {
  case "fixture":
    source = fixtureSource({ catalog, synthesize: values.synthesize ? Number(values.synthesize) : undefined });
    break;
  case "dcss-stats":
    source = dcssStatsSource();
    break;
  case "logfile": {
    const files = (values.logfile ?? []).map((path, i) => ({ path, server: values.server?.[i] ?? "unknown" }));
    source = logfileSource({ files });
    break;
  }
  default:
    throw new Error(`unknown --source ${values.source}`);
}

const out = values.out ?? `${REPO_ROOT}data/games/${series}.jsonl`;
mkdirSync(dirname(out), { recursive: true });
const stream = createWriteStream(out);
const norm = new Normalizer({ catalog, series, includePrerelease: values["include-prerelease"] });

const report = {
  series,
  source: source.name,
  catalog: catalogPath.replace(REPO_ROOT, ""),
  written: 0,
  excluded: {} as Record<string, number>,
  rules: {} as Record<string, number>,
  unresolved: {} as Record<string, number>,
  invalidSamples: [] as string[],
};
const bump = (o: Record<string, number>, k: string) => (o[k] = (o[k] ?? 0) + 1);

for await (const raw of source.read({ series })) {
  const r = norm.normalize(raw);
  if (!r.ok) {
    bump(report.excluded, r.reason);
    if (r.reason === "invalid" && report.invalidSamples.length < 20) report.invalidSamples.push(r.detail ?? "");
    continue;
  }
  bump(report.rules, r.rule);
  if (r.row.killer?.startsWith("unresolved:")) bump(report.unresolved, r.row.killerRaw ?? "");
  if (!stream.write(`${JSON.stringify(r.row)}\n`)) await new Promise<void>((res) => stream.once("drain", () => res()));
  report.written++;
}
await new Promise<void>((res) => stream.end(res));

report.unresolved = Object.fromEntries(Object.entries(report.unresolved).sort((a, b) => b[1] - a[1]).slice(0, 200));
writeFileSync(out.replace(/\.jsonl$/, "") + ".report.json", `${JSON.stringify(report, null, 2)}\n`);
console.log(`ingest: wrote ${report.written} games → ${out.replace(REPO_ROOT, "")} (catalog: ${report.catalog})`);
console.log(`  excluded: ${JSON.stringify(report.excluded)}  unresolved killers: ${Object.keys(report.unresolved).length}`);
// TODO(ingest): Parquet output via @duckdb/node-api once real volumes (~700k rows/series) arrive.
