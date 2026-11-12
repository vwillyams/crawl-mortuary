// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * prepare-data: aggregate.json + per-release catalogs → public/data/{meta.json, place/*.json, monster/*.json}.
 *
 * Inputs, each overridable by env var:
 *   AGGREGATE   default ../data/aggregate/aggregate.json, else packages/contract/fixtures/aggregate.json
 *   CATALOG_DIR default ../data/catalog/ (expects <release>.json), else the fixture catalog.json
 *
 * Both inputs are validated with the contract's zod schemas. The build refuses to continue on mismatch.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { AggregateFile, Catalog, parsePlace, placeKey } from "@mortuary/contract";
import type { AggregateFile as AggregateT, Catalog as CatalogT } from "@mortuary/contract";
import {
  placeFile,
  type BranchMeta,
  type KillerCounts,
  type Meta,
  type MonsterMeta,
  type MonsterPlaceCounts,
  type MonsterShard,
  type PlaceShard,
} from "../lib/shards.ts";

const webDir = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(webDir, "..");
const fixtures = path.join(repo, "packages/contract/fixtures");
const outDir = path.join(webDir, "public/data");

const rel = (p: string) => path.relative(repo, p);

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function parseOrDie<T>(schema: { safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: unknown[] } } }, file: string): T {
  const r = schema.safeParse(readJson(file));
  if (!r.success) {
    console.error(`prepare-data: ${rel(file)} does not match the contract:`);
    console.error(JSON.stringify(r.error.issues.slice(0, 10), null, 2));
    process.exit(1);
  }
  return r.data;
}

// ---- load inputs -----------------------------------------------------------------------------

const aggPath =
  process.env.AGGREGATE ??
  [path.join(repo, "data/aggregate/aggregate.json"), path.join(fixtures, "aggregate.json")].find(existsSync)!;
const agg: AggregateT = parseOrDie(AggregateFile, aggPath);
console.log(`prepare-data: aggregate ← ${rel(aggPath)}`);

const catalogDir = process.env.CATALOG_DIR ?? path.join(repo, "data/catalog");
const catalogs = new Map<string, CatalogT>(); // series → catalog
const catalogSources: Record<string, string> = {};
for (const s of agg.series) {
  const candidates = [path.join(catalogDir, `${s.catalogRelease}.json`), path.join(fixtures, "catalog.json")];
  const file = candidates.find(existsSync);
  if (!file) {
    console.error(`prepare-data: no catalog for ${s.series} (${s.catalogRelease})`);
    process.exit(1);
  }
  const cat = parseOrDie(Catalog, file);
  if (cat.release !== s.catalogRelease)
    console.warn(`prepare-data: WARNING series ${s.series} wants catalog ${s.catalogRelease}, using ${cat.release} from ${rel(file)}`);
  catalogs.set(s.series, cat);
  catalogSources[s.series] = rel(file);
  console.log(`prepare-data: catalog ${s.series} ← ${rel(file)}`);
}

// ---- meta ------------------------------------------------------------------------------------

const seriesNum = (s: string) => Number(s.split(".")[0]) * 1000 + Number(s.split(".")[1]);
const series = [...agg.series].sort((a, b) => seriesNum(b.series) - seriesNum(a.series));
if (series.length === 0) {
  console.error("prepare-data: aggregate has no series");
  process.exit(1);
}

// Branches: union across catalogs, newest catalog's order first.
const branches = new Map<string, BranchMeta>();
for (const s of series) {
  for (const b of catalogs.get(s.series)!.branches) {
    const existing = branches.get(b.abbrev);
    if (existing) {
      existing.series.push(s.series);
      existing.depth = Math.max(existing.depth, b.depth);
    } else branches.set(b.abbrev, { ...b, series: [s.series] });
  }
}
// Places present in the aggregate whose branch is in no catalog still get navigation.
for (const p of agg.places) {
  const { branch, depth } = parsePlace(p.place);
  const b = branches.get(branch);
  if (!b) {
    console.warn(`prepare-data: WARNING place ${p.place} has no catalog branch; adding a stub branch`);
    branches.set(branch, {
      abbrev: branch,
      name: branch,
      longName: branch,
      depth: depth ?? 1,
      parent: null,
      entryMin: null,
      entryMax: null,
      kind: "special",
      series: [p.series],
    });
  } else {
    if (depth !== null) b.depth = Math.max(b.depth, depth);
    if (!b.series.includes(p.series)) b.series.push(p.series);
  }
}

const places: string[] = [];
for (const b of branches.values()) {
  if (b.depth === 1) places.push(placeKey(b.abbrev, null));
  else for (let d = 1; d <= b.depth; d++) places.push(placeKey(b.abbrev, d));
}
for (const p of agg.places) if (!places.includes(p.place)) places.push(p.place);

const isMonsterKey = (k: string) => !k.startsWith("@") && !k.startsWith("unresolved:");

const monsters: Record<string, MonsterMeta> = {};
for (const s of [...series].reverse()) {
  // Oldest first, so the newest catalog's details win.
  for (const m of catalogs.get(s.series)!.monsters) {
    monsters[m.key] = {
      key: m.key,
      name: m.name,
      plural: m.plural,
      unique: m.unique,
      glyph: m.glyph,
      group: m.group,
      variantDims: m.variantDims,
      deaths: monsters[m.key]?.deaths ?? {},
    };
  }
}
for (const k of agg.killers) {
  if (!isMonsterKey(k.key)) continue;
  const m = (monsters[k.key] ??= {
    key: k.key,
    name: k.key.replace(/_/g, " "),
    plural: k.key.replace(/_/g, " ") + "s",
    unique: false,
    glyph: { char: "?", colour: "lightgrey" },
    deaths: {},
  });
  m.deaths[k.series] = (m.deaths[k.series] ?? 0) + k.deaths;
}

const meta: Meta = {
  schemaVersion: 1,
  generatedAt: agg.generatedAt,
  dataSource: { aggregate: rel(aggPath), catalogs: catalogSources },
  series: series.map((s) => ({ ...s })),
  defaultSeries: series[0]!.series,
  branches: [...branches.values()],
  places,
  monsters,
  causes: agg.causes,
};

// ---- shards ----------------------------------------------------------------------------------

const placeShards = new Map<string, PlaceShard>();
for (const p of agg.places) {
  const shard = placeShards.get(p.place) ?? { place: p.place, bySeries: {} };
  shard.bySeries[p.series] = {
    reached: p.reached,
    reachedMethod: p.reachedMethod,
    reachedGrade: p.reachedGrade,
    reachedNote: p.reachedNote,
    deathsTotal: p.deathsTotal,
    killers: [],
  };
  placeShards.set(p.place, shard);
}

const monsterShards = new Map<string, MonsterShard>();
let orphanRows = 0;
for (const k of agg.killers) {
  const ps = placeShards.get(k.place)?.bySeries[k.series];
  if (!ps) {
    orphanRows++;
    continue;
  }
  const row: KillerCounts = { key: k.key, variant: k.variant, class: k.class, deaths: k.deaths };
  if (k.exposure !== undefined) row.exposure = k.exposure;
  if (k.presentExposure !== undefined) row.presentExposure = k.presentExposure;
  if (k.firewood) row.firewood = true;
  ps.killers.push(row);

  if (!isMonsterKey(k.key)) continue;
  const ms = monsterShards.get(k.key) ?? { key: k.key, bySeries: {} };
  const mrow: MonsterPlaceCounts = {
    place: k.place,
    variant: k.variant,
    class: k.class,
    deaths: k.deaths,
    reached: ps.reached,
    reachedGrade: ps.reachedGrade,
    deathsTotal: ps.deathsTotal,
  };
  if (k.exposure !== undefined) mrow.exposure = k.exposure;
  if (k.presentExposure !== undefined) mrow.presentExposure = k.presentExposure;
  (ms.bySeries[k.series] ??= []).push(mrow);
  monsterShards.set(k.key, ms);
}
if (orphanRows) console.warn(`prepare-data: WARNING ${orphanRows} killer rows had no matching place row and were dropped`);

// Every navigable place and catalog monster gets a shard (possibly empty), so every page has data to load.
for (const p of places) if (!placeShards.has(p)) placeShards.set(p, { place: p, bySeries: {} });
for (const k of Object.keys(monsters)) if (!monsterShards.has(k)) monsterShards.set(k, { key: k, bySeries: {} });

// ---- write -----------------------------------------------------------------------------------

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "place"), { recursive: true });
mkdirSync(path.join(outDir, "monster"), { recursive: true });
writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(meta));
for (const s of placeShards.values()) writeFileSync(path.join(outDir, "place", `${placeFile(s.place)}.json`), JSON.stringify(s));
for (const s of monsterShards.values()) writeFileSync(path.join(outDir, "monster", `${s.key}.json`), JSON.stringify(s));
// Methodology parameters, if the aggregate provides them, go in a separate small file for /about.
writeFileSync(path.join(outDir, "reached-params.json"), JSON.stringify(agg.reachedParams ?? null));

console.log(
  `prepare-data: ${series.length} series, ${branches.size} branches, ${placeShards.size} place shards, ${monsterShards.size} monster shards → ${rel(outDir)}`,
);
