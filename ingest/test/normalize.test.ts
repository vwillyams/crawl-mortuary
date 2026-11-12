// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from "node:url";
import { GameRow } from "@mortuary/contract";
import { describe, expect, it } from "vitest";
import { Normalizer } from "../src/normalize.ts";
import { type DcssStatsRow, dcssStatsSqlFor, rawFromDcssStats } from "../src/sources/dcss-stats.ts";
import { fixtureSource } from "../src/sources/fixture.ts";
import { logfileSource } from "../src/sources/logfile.ts";
import type { RawGame } from "../src/types.ts";
import { testCatalog } from "./helpers.ts";

const catalog = testCatalog();
const collect = async (it: AsyncIterable<RawGame>) => {
  const out: RawGame[] = [];
  for await (const g of it) out.push(g);
  return out;
};

describe("dcss-stats adapter (mocked row; no dump yet)", () => {
  const row: DcssStatsRow = {
    id: "abc",
    isWin: false,
    startAt: "2026-10-01T10:00:00.000Z",
    endAt: "2026-10-01T12:00:00.000Z",
    version: "0.34.1",
    versionShort: "0.34",
    xl: 9,
    race: "Minotaur",
    class: "Berserker",
    god: "Trog",
    turns: 20000,
    runes: 0,
    uniqueRunes: 0,
    branch: "Lair",
    lvl: 2,
    killer: "a seven-headed hydra",
    killerType: null,
    endMessage: "slain by a seven-headed hydra",
    name: "SomePlayer",
    serverAbbreviation: "CDI",
    isBot: false,
  };
  const norm = new Normalizer({ catalog, series: "0.34" });

  it("maps and normalizes a monster death, inferring ktyp from endMessage", () => {
    const r = norm.normalize(rawFromDcssStats(row));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(GameRow.parse(r.row)).toBeTruthy();
    expect(r.row).toMatchObject({ source: "dcss-stats", endPlace: "Lair:2", ktyp: "mon", killer: "hydra", killerVariant: "heads=7", series: "0.34" });
    expect(r.row.ikiller).toBeUndefined();
  });

  it("classifies non-monster deaths from endMessage alone", () => {
    const r = norm.normalize(rawFromDcssStats({ ...row, killer: null, endMessage: "starved to death" }));
    expect(r.ok && r.row.killer).toBe("@starvation");
  });

  it("handles wins and the Player.isBot flag", () => {
    const r = norm.normalize(rawFromDcssStats({ ...row, isWin: true, killer: null, endMessage: "escaped with the Orb!", isBot: true, branch: "D", lvl: 1 }));
    expect(r.ok && { k: r.row.killer, w: r.row.isWin, b: r.row.isBot }).toEqual({ k: null, w: true, b: true });
  });

  it("inlines a validated series into the export SQL", () => {
    expect(dcssStatsSqlFor("0.34")).toContain(`"versionShort" = '0.34'`);
    expect(() => dcssStatsSqlFor("0.34'; drop table x;--")).toThrow();
  });
});

describe("logfile adapter (local file)", () => {
  it("parses, buckets and filters", async () => {
    const path = fileURLToPath(new URL("./fixtures/sample.logfile", import.meta.url));
    const raws = await collect(logfileSource({ files: [{ path, server: "CDI" }] }).read({}));
    expect(raws).toHaveLength(6); // the garbage line is skipped
    const norm = new Normalizer({ catalog, series: "0.34" });
    const results = raws.map((r) => norm.normalize(r));
    const ok = results.flatMap((r) => (r.ok ? [r.row] : []));
    const excluded = results.flatMap((r) => (r.ok ? [] : [r.reason]));
    expect(excluded).toEqual(["series", "series"]); // 0.35-a0 trunk and 0.33.1
    expect(ok.map((r) => [r.player, r.endPlace, r.killer, r.killerVariant, r.isBot])).toEqual([
      ["alice", "D:1", "unresolved:a gnoll", "", false], // gnoll is not in the test catalog
      ["bob", "Lair:3", "hydra", "heads=7", false],
      ["carol", "D:1", null, "", false],
      ["qw", "Temple", "@poison", "", true],
    ]);
    expect(ok[0]).toMatchObject({ kaux: "a +0 spear", seed: "12345", startAt: "2026-11-12T17:49:12.000Z" });
    expect(ok[1]!.killermap).toBe("lair_hydra_den");
  });
});

describe("prerelease policy", () => {
  const raw = { ...rawFromDcssStats({
    id: "x", isWin: false, startAt: "2026-01-01T00:00:00Z", endAt: "2026-01-01T00:00:00Z", version: "0.34-b1",
    versionShort: "0.34", xl: 1, race: "Human", class: "Hunter", god: null, turns: 1, runes: 0, uniqueRunes: 0,
    branch: "D", lvl: 1, killer: null, killerType: null, endMessage: "quit the game", name: "p", serverAbbreviation: "CDI", isBot: false,
  }) };
  it("excludes 0.34 betas from the 0.34 bucket by default", () => {
    expect(new Normalizer({ catalog, series: "0.34" }).normalize(raw)).toEqual({ ok: false, reason: "prerelease" });
  });
  it("keeps them with includePrerelease", () => {
    expect(new Normalizer({ catalog, series: "0.34", includePrerelease: true }).normalize(raw).ok).toBe(true);
  });
});

describe("fixture adapter", () => {
  it("round-trips the contract fixture through normalize", async () => {
    const raws = await collect(fixtureSource({ catalog }).read({}));
    const norm = new Normalizer({ catalog, series: "0.34" });
    const rows = raws.map((r) => norm.normalize(r)).flatMap((r) => (r.ok ? [r.row] : []));
    expect(rows.length).toBe(raws.length);
    const byId = Object.fromEntries(rows.map((r) => [r.killerRaw, r.killer]));
    expect(byId["a seven-headed hydra"]).toBe("hydra");
    expect(byId.Sigmund).toBe("sigmund");
  });

  it("synthesizes valid rows", async () => {
    const raws = await collect(fixtureSource({ catalog, synthesize: 500 }).read({}));
    const norm = new Normalizer({ catalog, series: "0.34" });
    const results = raws.map((r) => norm.normalize(r));
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
