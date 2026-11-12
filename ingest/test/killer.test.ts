// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { Catalog } from "@mortuary/contract";
import { describe, expect, it } from "vitest";
import { realCatalogPath } from "../src/catalog.ts";
import { inferKtypFromMessage } from "../src/killer/causes.ts";
import { CatalogIndex, resolveKiller, STRUCTURAL } from "../src/killer/resolve.ts";
import { testCatalog } from "./helpers.ts";

const idx = new CatalogIndex(testCatalog());

type Row = [killer: string | null, ktyp: string | null, key: string | null, variant?: string, opts?: { branch?: string; flags?: string }];

// The go-sequell killer_test.go cases come first (adapted: we keep variants instead of discarding them).
const TABLE: Row[] = [
  ["a two-headed hydra", "mon", "hydra", "heads=2"],
  ["a 12-headed hydra", "mon", "hydra", "heads=12"],
  ["the 27-headed Lernaean hydra zombie", "mon", "zombie", "base=lernaean_hydra;heads=27"],
  ["Foobar's ghost", "mon", "player_ghost"],
  ["ackbar's illusion", "mon", "player_illusion"],
  ["a red draconian shifter", "mon", "draconian_shifter", "colour=red"],
  ["a yak (shapeshifter)", "mon", "shapeshifter"],
  ["a camel (glowing shapeshifter)", "mon", "glowing_shapeshifter"],
  ["a red ugly thing", "mon", "ugly_thing", "colour=red"],
  ["a green very ugly thing", "mon", "very_ugly_thing", "colour=green"],
  ["Grinder", "mon", "grinder"],
  ["Bogdan the orc", "mon", "orc"],
  ["Ghib the pandemonium lord", "mon", "pandemonium_lord"],
  // Plain monsters, articles
  ["a jackal", "mon", "jackal"],
  ["an orc warrior", "beam", "orc_warrior"],
  ["an ogre", "mon", "ogre"],
  ["the yak", "mon", "yak"],
  // Uniques
  ["Sigmund", "mon", "sigmund", "", { flags: "unique" }],
  ["the Enchantress", "mon", "enchantress"],
  ["the 27-headed Lernaean hydra", "mon", "lernaean_hydra", "heads=27"],
  ["Bai Suzhen", "mon", "bai_suzhen"],
  // Names shared by several enums, disambiguated by branch
  ["the Serpent of Hell", "mon", "serpent_of_hell_dis", "", { branch: "Dis" }],
  ["the Serpent of Hell", "mon", "serpent_of_hell", "", { branch: "Geh" }],
  // Hydras in words and digits
  ["a seven-headed hydra", "mon", "hydra", "heads=7"],
  ["a 15-headed hydra", "mon", "hydra", "heads=15"],
  // Draconians: base colours are their own monsters
  ["a red draconian", "mon", "red_draconian"],
  ["a yellow draconian annihilator", "mon", "draconian_annihilator", "colour=yellow"],
  // Derived undead
  ["an orc zombie", "mon", "zombie", "base=orc"],
  ["a seven-headed hydra zombie", "mon", "zombie", "base=hydra;heads=7"],
  ["an ogre simulacrum", "mon", "simulacrum", "base=ogre"],
  ["a spectral yak", "mon", "spectral_thing", "base=yak"],
  ["a spectral warrior", "mon", "spectral_warrior"],
  ["a bound orc wizard", "mon", "bound_soul", "base=orc_wizard"],
  ["a deep troll draugr", "mon", "draugr", "base=deep_troll"],
  ["a goblin skeleton", "mon", "skeleton", "base=goblin"],
  ["an unknownthing zombie", "mon", "zombie", "base=unknownthing"],
  // Status prefixes / suffixes
  ["a vampire orc warrior", "mon", "orc_warrior"],
  ["a ghostly ogre", "mon", "ogre"],
  ["an orc warrior (illusionary)", "mon", "orc_warrior", "form=illusion"],
  ["a yak shaped shifter", "mon", "shapeshifter"],
  // Named monsters
  ["Ugrar the orc warrior", "mon", "orc_warrior"],
  // Weapons and beasts
  ["a +2 broad axe", "mon", STRUCTURAL.dancingWeapon],
  ["a spectral +3 dagger", "mon", STRUCTURAL.spectralWeapon],
  ["a juvenile fire-frost beast", "mon", STRUCTURAL.mutantBeast],
  // Poison is credited to the poisoner when crawl records one
  ["an adder", "pois", "adder"],
  // Special non-monster killer strings
  ["you", "beam", "@self"],
  ["themself", "mon", "@self"],
  ["an ally", "mon", "@ally"],
  ["their own shadow", "mon", "player_shadow"],
  // Non-monster causes (no killer)
  [null, "pois", "@poison"],
  ["", "starvation", "@starvation"],
  [null, "quitting", "@quit"],
  [null, "leaving", "@leaving"],
  [null, "zot", "@zot"],
  [null, "lava", "@lava"],
  [null, "trap", "@trap"],
  [null, "death curse", "@death_curse"],
  [null, "falling_down_stairs", "@stairs"],
  [null, null, "@unknown"],
  // Wins
  [null, "winning", null],
  // Unknown
  ["a strange machine", "mon", "unresolved:a strange machine"],
];

describe("resolveKiller", () => {
  it.each(TABLE)("%s [%s] → %s %s", (killer, ktyp, key, variant = "", opts = {}) => {
    const r = resolveKiller(idx, { killer, ktyp, branch: opts.branch, killerFlags: opts.flags });
    expect({ key: r.key, variant: r.variant }).toEqual({ key, variant });
  });
});

describe("inferKtypFromMessage (dcss-stats has no ktyp)", () => {
  it.each([
    ["slain by a gnoll", "mon"],
    ["escaped with the Orb", "winning"],
    ["quit the game", "quitting"],
    ["got out of the dungeon alive", "leaving"],
    ["succumbed to an adder's poison", "pois"],
    ["succumbed to poison", "pois"],
    ["starved to death", "starvation"],
    ["engulfed by a cloud of flame", "cloud"],
    ["took a swim in molten lava", "lava"],
    ["drowned", "water"],
    ["killed by triggering a net trap", "trap"],
    ["tarried too long and was consumed by Zot", "zot"],
    ["killed themself with a bounced bolt of fire", "bounce"],
    ["killed themself with bad targeting", "targeting"],
    ["shot with an arrow by an orc", "beam"],
    ["fell down a flight of stairs", "falling_down_stairs"],
    ["entered wizard mode", "wizmode"],
    ["something totally new", null],
  ])("%s → %s", (msg, ktyp) => expect(inferKtypFromMessage(msg)).toBe(ktyp));
});

const realPath = realCatalogPath("0.34.1");
describe.skipIf(!existsSync(realPath))("real 0.34.1 catalog", () => {
  let cached: CatalogIndex | undefined;
  const ridxOf = () => (cached ??= new CatalogIndex(Catalog.parse(JSON.parse(readFileSync(realPath, "utf8")))));
  it("contains the structural keys the resolver emits", () => {
    const ridx = ridxOf();
    const missing = Object.values(STRUCTURAL).filter((k) => k !== "skeleton" && !ridx.has(k));
    expect(missing).toEqual([]);
  });
  it("resolves every catalog monster's own name to itself (except names shared by several enums)", () => {
    const ridx = ridxOf();
    const SHARED = new Set(["bai_suzhen_dragon", "serpent_of_hell_cocytus", "serpent_of_hell_dis", "serpent_of_hell_tartarus"]);
    const bad = ridx.catalog.monsters
      .filter((m) => !SHARED.has(m.key))
      .map((m) => ({ m, s: m.unique ? m.name : `${/^[aeiou]/i.test(m.name) ? "an" : "a"} ${m.name}` }))
      .filter(({ m, s }) => resolveKiller(ridx, { killer: s, ktyp: "mon" }).key !== m.key)
      .map(({ s }) => s);
    expect(bad).toEqual([]);
  });
  it.each(TABLE.filter(([k]) => k && !k.includes("unknownthing") && !k.includes("strange machine")))(
    "%s resolves without unresolved:",
    (killer, ktyp, _key, _v, opts = {}) => {
      const r = resolveKiller(ridxOf(), { killer, ktyp, branch: opts.branch, killerFlags: opts.flags });
      expect(r.key?.startsWith("unresolved:")).toBe(false);
    },
  );
});
