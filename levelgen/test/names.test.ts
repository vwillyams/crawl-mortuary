// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { Catalog, MonsterInfo } from "@mortuary/contract";
import { NameResolver, parseNumberWord } from "../src/names.ts";

const mon = (key: string, name: string, extra: Partial<MonsterInfo> = {}): MonsterInfo => ({
  key, enumName: `MONS_${key.toUpperCase()}`, name, plural: `${name}s`, unique: false,
  glyph: { char: "x", colour: "white" }, hd: 1, ac: 0, ev: 0, flags: [], spawns: [], ...extra,
});

const catalog: Catalog = {
  schemaVersion: 1, release: "0.34.1", series: "0.34", crawlCommit: "test",
  branches: [
    { abbrev: "Geh", name: "Gehenna", longName: "Gehenna", depth: 7, parent: null, entryMin: null, entryMax: null, kind: "hell", runes: [] },
    { abbrev: "Coc", name: "Cocytus", longName: "Cocytus", depth: 7, parent: null, entryMin: null, entryMax: null, kind: "hell", runes: [] },
  ],
  monsters: [
    mon("orc", "orc"), mon("zombie", "zombie"), mon("spectral_thing", "spectral thing"), mon("draugr", "draugr"),
    mon("harpy", "harpy"), mon("guardian_sphinx", "guardian sphinx"), mon("ugly_thing", "ugly thing"),
    mon("hydra", "hydra"), mon("lernaean_hydra", "the Lernaean hydra"), mon("slime_creature", "slime creature"),
    mon("draconian_annihilator", "draconian annihilator"), mon("bat", "bat"),
    mon("serpent_of_hell", "the Serpent of Hell"), mon("serpent_of_hell_cocytus", "the Serpent of Hell"),
  ],
};
const r = new NameResolver(catalog);

describe("NameResolver", () => {
  it.each([
    ["orc", "orc", "orc", ""],
    ["zombie", "orc zombie", "zombie", "base=orc"],
    ["draugr", "guardian sphinx draugr", "draugr", "base=guardian_sphinx"],
    ["spectral thing", "spectral harpy", "spectral_thing", "base=harpy"],
    ["ugly thing", "green ugly thing", "ugly_thing", "colour=green"],
    ["hydra", "seven-headed hydra", "hydra", "heads=7"],
    ["the Lernaean hydra", "27-headed Lernaean hydra", "lernaean_hydra", "heads=27"],
    ["slime creature", "very large slime creature", "slime_creature", "size=very_large"],
    ["draconian annihilator", "yellow draconian annihilator", "draconian_annihilator", "colour=yellow"],
    ["bat", "megabat", "bat", ""],
  ])("%s / %s", (type, name, key, variant) => {
    expect(r.resolve(type, name, "D:5")).toEqual({ key, variant, known: true });
  });

  it("disambiguates by place", () => {
    expect(r.resolve("the Serpent of Hell", "Serpent of Hell", "Coc:7").key).toBe("serpent_of_hell_cocytus");
    expect(r.resolve("the Serpent of Hell", "Serpent of Hell", "Geh:7").key).toBe("serpent_of_hell");
  });

  it("falls back to a slug for unknown types", () => {
    expect(r.resolve("mystery blob", "mystery blob")).toEqual({ key: "mystery_blob", variant: "", known: false });
  });

  it("parses number words", () => {
    expect(parseNumberWord("seven")).toBe(7);
    expect(parseNumberWord("twenty-seven")).toBe(27);
    expect(parseNumberWord("12")).toBe(12);
    expect(parseNumberWord("many")).toBeUndefined();
  });
});
