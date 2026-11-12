// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { Catalog, type MonsterInfo } from "@mortuary/contract";
import { FIXTURE_CATALOG } from "../src/catalog.ts";

const mon = (key: string, name: string, extra: Partial<MonsterInfo> = {}): MonsterInfo => ({
  key,
  enumName: `MONS_${key.toUpperCase()}`,
  name,
  plural: `${name}s`,
  unique: false,
  glyph: { char: "?", colour: "white" },
  hd: 1,
  ac: 0,
  ev: 0,
  flags: [],
  spawns: [],
  ...extra,
});
const uniq = (key: string, name: string) => mon(key, name, { unique: true, plural: name, flags: ["unique"] });

/** Contract fixture catalog plus the monsters the killer tests need (names as in crawl 0.34.1). */
export function testCatalog(): Catalog {
  const base = Catalog.parse(JSON.parse(readFileSync(FIXTURE_CATALOG, "utf8")));
  const extra: MonsterInfo[] = [
    mon("orc_wizard", "orc wizard"),
    mon("spectral_warrior", "spectral warrior"),
    mon("ugly_thing", "ugly thing"),
    mon("very_ugly_thing", "very ugly thing"),
    mon("draconian", "draconian"),
    mon("red_draconian", "red draconian"),
    mon("draconian_annihilator", "draconian annihilator"),
    mon("draconian_shifter", "draconian shifter"),
    mon("zombie", "zombie"),
    mon("simulacrum", "simulacrum"),
    mon("spectral_thing", "spectral thing"),
    mon("player_ghost", "player ghost"),
    mon("pandemonium_lord", "pandemonium lord"),
    mon("shapeshifter", "shapeshifter"),
    mon("glowing_shapeshifter", "glowing shapeshifter"),
    mon("deep_troll", "deep troll"),
    mon("adder", "adder"),
    mon("serpent_of_hell", "Serpent of Hell", { unique: true }),
    mon("serpent_of_hell_dis", "Serpent of Hell", { unique: true }),
    uniq("lernaean_hydra", "the Lernaean hydra"),
    uniq("enchantress", "the Enchantress"),
    uniq("grinder", "Grinder"),
    uniq("bai_suzhen", "Bai Suzhen"),
  ];
  return { ...base, monsters: [...base.monsters, ...extra] };
}
