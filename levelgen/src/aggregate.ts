// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Reduce raw levelgen JSONL (data/raw/levelgen/<release>/part-*.jsonl.gz) into the additive
 * aggregate data/levelgen/<release>.json (contract: LevelgenAggregate).
 *
 *   pnpm aggregate --release 0.34.1
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  LevelgenAggregate,
  type MonsterAtPlace,
  type PlaceSample,
  LevelgenRawLine as RawLineSchema,
} from "@mortuary/contract";
import { crawlDescribe, levelgenPath, parseArgs, rawDir } from "./common.ts";

export function aggregate(release: string): LevelgenAggregate {
  const dir = rawDir(release);
  const files = readdirSync(dir).filter((f) => /^part-.*\.jsonl\.gz$/.test(f)).sort();
  if (!files.length) throw new Error(`no raw parts in ${dir}; run \`pnpm sample\` first`);

  const seeds = new Set<string>();
  const seen = new Set<string>(); // (seed, place): guards against overlapping chunks after re-chunking
  let dupes = 0;
  const places = new Map<string, number>();
  const mons = new Map<string, MonsterAtPlace>();

  for (const f of files) {
    const text = gunzipSync(readFileSync(join(dir, f))).toString("utf8");
    for (const s of text.split("\n")) {
      if (!s) continue;
      const l = RawLineSchema.parse(JSON.parse(s));
      const sp = `${l.seed}|${l.place}`;
      if (seen.has(sp)) {
        dupes++;
        continue;
      }
      seen.add(sp);
      seeds.add(String(l.seed));
      places.set(l.place, (places.get(l.place) ?? 0) + 1);
      for (const m of l.monsters) {
        const id = `${l.place}|${m.key}|${m.variant}`;
        const a = mons.get(id) ?? {
          place: l.place, key: m.key, variant: m.variant, sum: 0, sumSq: 0, present: 0,
          vaultSum: 0, hostileSum: 0, unique: m.unique, firewood: m.firewood,
        };
        a.sum += m.n;
        a.sumSq += m.n * m.n;
        if (m.n > 0) a.present++;
        a.vaultSum += m.vault;
        a.hostileSum += m.hostile;
        // TODO(levelgen): oodSum once the sampler can see crawl's out-of-depth flag.
        mons.set(id, a);
      }
    }
  }

  if (dupes) console.warn(`  skipped ${dupes} duplicate (seed, place) lines from overlapping chunks`);
  const placeRows: PlaceSample[] = [...places]
    .map(([place, instances]) => ({ place, instances, seeds: seeds.size, source: "pregen-lua" as const }))
    .sort((a, b) => a.place.localeCompare(b.place, "en", { numeric: true }));
  const monRows = [...mons.values()].sort(
    (a, b) =>
      a.place.localeCompare(b.place, "en", { numeric: true }) || b.sum - a.sum || a.key.localeCompare(b.key) ||
      a.variant.localeCompare(b.variant),
  );
  // TODO(levelgen): Abyss/Pan/Zig/Trove rows from `crawl -objstat` with source "objstat".
  return LevelgenAggregate.parse({
    schemaVersion: 1,
    release,
    crawlCommit: crawlDescribe(release),
    seeds: seeds.size,
    places: placeRows,
    monsters: monRows,
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const { release } = parseArgs();
  const t0 = Date.now();
  const agg = aggregate(release);
  const p = levelgenPath(release);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(agg) + "\n");
  console.log(
    `aggregate ${release}: ${agg.seeds} seeds, ${agg.places.length} places, ${agg.monsters.length} rows → ${p} (${Date.now() - t0} ms)`,
  );
}
