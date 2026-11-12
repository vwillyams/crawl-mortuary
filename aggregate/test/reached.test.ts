// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import type { BranchInfo } from "@mortuary/contract";
import { DEFAULT_CONFIG, withOverrides } from "../src/config.ts";
import { BranchTree, ReachedEstimator } from "../src/reached.ts";

const b = (
  abbrev: string,
  depth: number,
  parent: string | null,
  entryMin: number | null,
  entryMax: number | null,
  kind: BranchInfo["kind"] = "main",
): BranchInfo => ({ abbrev, name: abbrev, longName: abbrev, depth, parent, entryMin, entryMax, kind, runes: [] });

/** Branch table shaped like 0.34.1's branch-data.h. */
const BRANCHES: BranchInfo[] = [
  b("D", 15, null, null, null),
  b("Temple", 1, "D", 4, 7),
  b("Orc", 2, "D", 9, 12),
  b("Elf", 3, "Orc", 2, 2),
  b("Lair", 5, "D", 8, 11),
  b("Swamp", 4, "Lair", 2, 3),
  b("Shoals", 4, "Lair", 2, 3),
  b("Snake", 4, "Lair", 2, 3),
  b("Spider", 4, "Lair", 2, 3),
  b("Slime", 5, "Lair", 4, 5),
  b("Vaults", 5, "D", 13, 14),
  b("Crypt", 3, "Vaults", 2, 3),
  b("Tomb", 3, "Crypt", 3, 3),
  b("Depths", 4, "D", 15, 15),
  b("Zot", 5, "Depths", 4, 4),
  b("Hell", 1, null, null, null, "hell"),
  b("Dis", 7, "Hell", 1, 1, "hell"),
  b("Geh", 7, "Hell", 1, 1, "hell"),
  b("Abyss", 7, null, null, null, "special"),
];

const est = (cfg = DEFAULT_CONFIG) => new ReachedEstimator(new BranchTree(BRANCHES), cfg);
const credit = (endPlace: string, isWin = false, uniqueRunes = 0, e = est()) =>
  Object.fromEntries(e.credit({ endPlace, isWin, uniqueRunes }));

describe("implied path", () => {
  it("D death credits D:1..d only", () => {
    const c = credit("D:5");
    expect(c["D:5"]).toBe(1);
    expect(c["D:1"]).toBe(1);
    expect(c["D:6"]).toBeUndefined();
    expect(c["Lair:1"]).toBeUndefined();
  });

  it("Lair:2 death credits Lair:1-2 and D down to a uniformly distributed entrance (D:8-11)", () => {
    const c = credit("Lair:2");
    expect(c["Lair:1"]).toBe(1);
    expect(c["Lair:2"]).toBe(1);
    expect(c["Lair:3"]).toBeUndefined();
    expect(c["D:8"]).toBe(1);
    expect(c["D:9"]).toBeCloseTo(0.75);
    expect(c["D:10"]).toBeCloseTo(0.5);
    expect(c["D:11"]).toBeCloseTo(0.25);
    expect(c["D:12"]).toBeUndefined();
  });

  it("Depths death credits Lair:1-5 fully, S-branches fractionally, Orc at pOrc", () => {
    const c = credit("Depths:2");
    for (let i = 1; i <= 5; i++) expect(c[`Lair:${i}`]).toBe(1);
    for (let i = 1; i <= 15; i++) expect(c[`D:${i}`]).toBe(1);
    expect(c["Depths:2"]).toBe(1);
    expect(c["Depths:3"]).toBeUndefined();
    for (const s of ["Swamp", "Shoals", "Snake", "Spider"]) {
      expect(c[`${s}:1`]).toBeCloseTo(0.25);
      expect(c[`${s}:4`]).toBeCloseTo(0.25);
    }
    expect(c["Orc:1"]).toBeCloseTo(0.8);
    expect(c["Vaults:1"]).toBeUndefined();
    expect(c["Slime:1"]).toBeUndefined();
  });

  it("runes raise the S-branch count, capped at the number per game", () => {
    expect(credit("Depths:1", false, 2)["Swamp:1"]).toBeCloseTo(0.5);
    expect(credit("Depths:1", false, 5)["Swamp:1"]).toBeCloseTo(0.5);
    const noRunes = est(withOverrides(DEFAULT_CONFIG, { params: { useRunes: false } }));
    expect(credit("Depths:1", false, 2, noRunes)["Swamp:1"]).toBeCloseTo(0.25);
  });

  it("S-branch split follows branch presence when known", () => {
    const e = est(withOverrides(DEFAULT_CONFIG, { params: { branchPresence: { Swamp: 0.75, Shoals: 0.25, Snake: 0.5, Spider: 0.5 } } }));
    const c = credit("Depths:1", false, 0, e);
    expect(c["Swamp:1"]).toBeCloseTo(0.375);
    expect(c["Shoals:1"]).toBeCloseTo(0.125);
  });

  it("hell death credits only same or deeper levels of that hell (plus the main route)", () => {
    const c = credit("Dis:3");
    expect(c["Dis:1"]).toBe(1);
    expect(c["Dis:3"]).toBe(1);
    expect(c["Dis:4"]).toBeUndefined();
    expect(c["Geh:1"]).toBeUndefined();
    expect(c["Hell"]).toBe(1);
    expect(c["Depths:4"]).toBe(1);
    expect(c["Lair:5"]).toBe(1);
  });

  it("Elf death credits Orc fully via the branch tree", () => {
    const c = credit("Elf:1");
    expect(c["Orc:1"]).toBe(1);
    expect(c["Orc:2"]).toBe(1);
    expect(c["Lair:5"]).toBe(1);
  });

  it("Crypt death credits Vaults:1-4 at vaultsCredit but not V:5", () => {
    const c = credit("Crypt:1");
    expect(c["Vaults:1"]).toBe(1); // the path into Crypt (entry V:2-3) gives V:1-2 for certain
    expect(c["Vaults:3"]).toBeCloseTo(0.9);
    expect(c["Vaults:4"]).toBeCloseTo(0.9);
    expect(c["Vaults:5"]).toBeUndefined();
  });

  it("wins credit the whole main route but not the death place", () => {
    const c = credit("D:1", true, 3);
    for (let i = 1; i <= 5; i++) expect(c[`Zot:${i}`]).toBe(1);
    expect(c["Depths:4"]).toBe(1);
    expect(c["Lair:5"]).toBe(1);
    expect(c["Swamp:4"]).toBeCloseTo(0.5);
    expect(c["Vaults:4"]).toBeCloseTo(0.9);
    expect(c["Dis:1"]).toBeUndefined();
  });

  it("Abyss death credits only the Abyss", () => {
    const c = credit("Abyss:2");
    expect(Object.keys(c).sort()).toEqual(["Abyss:1", "Abyss:2"]);
  });

  it("unknown branches credit the death place only", () => {
    const e = est();
    expect(Object.keys(credit("Bazaar", false, 0, e))).toEqual(["Bazaar"]);
    expect(e.unknownBranches.get("Bazaar")).toBe(1);
  });
});

describe("grade and explanation", () => {
  const e = est();
  it("grades the main route", () => {
    expect(e.grade("D:15")).toBe("main");
    expect(e.grade("Vaults:4")).toBe("main");
    expect(e.grade("Vaults:5")).toBe("lowerBound");
    expect(e.grade("Slime:1")).toBe("lowerBound");
    expect(e.grade("Dis:1")).toBe("lowerBound");
  });
  it("explains", () => {
    expect(e.explain("Lair:3")).toMatch(/100% of characters who died in .*Depths/);
    expect(e.explain("Swamp:1")).toMatch(/1 of the 4 Lair sub-branches/);
    expect(e.explain("D:9")).toMatch(/Lair D:8–11/);
    expect(e.explain("Dis:2")).toMatch(/strict lower bound/);
    expect(e.explain("Vaults:5")).not.toMatch(/went through Vaults/);
  });
});
