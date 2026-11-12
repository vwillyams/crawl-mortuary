// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Runs the catalog exporter built by scripts/build-crawl.sh (util/mortuary/catalog), then
 * post-processes its output into the contract's Catalog → data/catalog/<release>.json.
 *
 *   pnpm catalog --release 0.34.1
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { type BranchInfo, Catalog, type MonsterInfo, seriesOf } from "@mortuary/contract";
import { catalogPath, crawlDescribe, crawlSrc, parseArgs } from "./common.ts";

interface RawMonster {
  enumName: string;
  id: number;
  name: string;
  entryName: string;
  plural: string;
  unique: boolean;
  glyph: { char: string; colour: string };
  hd: number;
  hp: number;
  ac: number;
  ev: number;
  exp: number;
  genus: string;
  flags: string[];
  spawns: MonsterInfo["spawns"];
}
interface RawBranch extends Omit<BranchInfo, "kind"> {
  kind: string;
  absdepth: number;
}
interface RawCatalog {
  crawlVersion: string;
  monsters: RawMonster[];
  branches: RawBranch[];
}

const keyOf = (enumName: string) => enumName.replace(/^MONS_/, "").toLowerCase();

const DERIVED = new Set(["zombie", "skeleton", "simulacrum", "spectral_thing", "draugr"]);
const HEADED = new Set(["hydra", "lernaean_hydra", "slymdra"]);

function groupAndDims(key: string, genus: string | undefined): Pick<MonsterInfo, "group" | "variantDims"> {
  if (DERIVED.has(key)) return { group: "derived undead", variantDims: ["base"] };
  if (key === "ugly_thing" || key === "very_ugly_thing") return { group: "ugly things", variantDims: ["colour"] };
  if (HEADED.has(key)) return { group: key === "slymdra" ? undefined : "hydras", variantDims: ["heads"] };
  if (key === "slime_creature") return { variantDims: ["size"] };
  if (genus === "draconian") {
    // Base colours are separate enums ("red_draconian"); job draconians carry the colour as a variant.
    const isJob = key !== "draconian" && !key.endsWith("_draconian");
    return { group: "draconians", variantDims: isJob ? ["colour"] : undefined };
  }
  // TODO(levelgen): more groups (demonspawn, nagas, elves, ...) once the UI wants them.
  return {};
}

/** Tile names known to rltiles (the second token of each "file TILE_NAME" line in dc-*.txt). */
function rltileNames(src: string): Set<string> {
  const dir = join(src, "rltiles");
  const names = new Set<string>();
  if (!existsSync(dir)) return names;
  for (const f of readdirSync(dir).filter((f) => /^dc-.*\.txt$/.test(f))) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      const m = /^\S+\s+(MONS_[A-Z0-9_]+)/.exec(line);
      if (m) names.add(m[1]!);
    }
  }
  return names;
}

const BRANCH_KINDS = new Set(["main", "portal", "hell", "special"]);

export function buildCatalog(release: string): Catalog {
  const src = crawlSrc(release);
  const bin = join(src, "util", "mortuary", "catalog");
  if (!existsSync(bin)) throw new Error(`${bin} missing; run scripts/build-crawl.sh ${release}`);
  const out = execFileSync(bin, [], { cwd: src, maxBuffer: 64 << 20, encoding: "utf8" });
  const raw = JSON.parse(out) as RawCatalog;
  const tiles = rltileNames(src);

  // Debug/placeholder monster classes never occur in real games, so they get no pages.
  const isDebugMonster = (enumName: string) => /^MONS_(TEST_|PROGRAM_BUG$)/.test(enumName);
  const monsters: MonsterInfo[] = raw.monsters.filter((m) => !isDebugMonster(m.enumName)).map((m) => {
    const key = keyOf(m.enumName);
    const genus = m.genus ? keyOf(m.genus) : undefined;
    return {
      key,
      enumName: m.enumName,
      name: m.name,
      plural: m.plural,
      unique: m.unique,
      glyph: m.glyph,
      tile: tiles.has(m.enumName) ? m.enumName : undefined, // TODO(levelgen): uniques/variants with non-default tiles
      hd: m.hd,
      hp: m.hp,
      ac: m.ac,
      ev: m.ev,
      // TODO(levelgen): real XP needs a monster instance (exper_value); `exp` here is crawl's base value.
      flags: m.flags,
      spawns: m.spawns,
      genus: genus && genus !== key ? genus : undefined,
      ...groupAndDims(key, genus),
    };
  });

  const branches: BranchInfo[] = raw.branches.map((b) => ({
    abbrev: b.abbrev,
    name: b.name,
    longName: b.longName,
    depth: b.depth,
    parent: b.parent,
    entryMin: b.entryMin,
    entryMax: b.entryMax,
    kind: (BRANCH_KINDS.has(b.kind) ? b.kind : "special") as BranchInfo["kind"],
    runes: b.runes,
  }));

  return Catalog.parse({
    schemaVersion: 1,
    release,
    series: seriesOf(release),
    crawlCommit: crawlDescribe(release),
    branches,
    monsters,
    // TODO(levelgen): curated aliases (renames, odd killer strings) live in packages/contract lineage later.
    aliases: {},
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const { release } = parseArgs();
  const t0 = Date.now();
  const cat = buildCatalog(release);
  const p = catalogPath(release);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cat, null, 1) + "\n");
  console.log(
    `catalog ${release}: ${cat.monsters.length} monsters, ${cat.branches.length} branches, ` +
      `${cat.monsters.filter((m) => m.tile).length} with tiles → ${p} (${Date.now() - t0} ms)`,
  );
}
