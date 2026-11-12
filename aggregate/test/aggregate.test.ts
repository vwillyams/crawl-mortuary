// SPDX-License-Identifier: AGPL-3.0-or-later
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AggregateFile } from "@mortuary/contract";
import { Aggregator } from "../src/aggregate.ts";
import { Classifier } from "../src/classify.ts";
import { DEFAULT_CONFIG } from "../src/config.ts";
import { FIXTURES, loadCatalog, loadLevelgen, readGames } from "../src/io.ts";

describe("aggregate on contract fixtures", async () => {
  const catalog = loadCatalog(join(FIXTURES, "catalog.json"));
  const levelgen = loadLevelgen(join(FIXTURES, "levelgen.json"));
  const agg = new Aggregator([{ series: "0.34", catalog, levelgen }], {
    includeBots: false,
    includePrerelease: false,
    config: DEFAULT_CONFIG,
  });
  for await (const g of readGames(join(FIXTURES, "games.jsonl"))) agg.addGame(g);
  const out = AggregateFile.parse(agg.finish(new Date("2026-11-12T00:00:00Z")));
  const place = (p: string) => out.places.find((x) => x.place === p)!;
  const row = (p: string, k: string) => out.killers.find((x) => x.place === p && x.key === k);

  it("counts games, wins and deaths", () => {
    expect(out.series[0]!.games).toBe(16);
    expect(out.series[0]!.wins).toBe(1);
    expect(out.places.reduce((a, p) => a + p.deathsTotal, 0)).toBe(15);
  });

  it("reached is monotone down D and includes deeper deaths and the win", () => {
    expect(place("D:1").reached).toBeGreaterThanOrEqual(place("D:2").reached);
    expect(place("D:1").reached).toBe(16);
  });

  it("killer rows carry class and exposure", () => {
    expect(row("D:3", "sigmund")!.class).toBe("unexpected");
    expect(row("D:1", "jackal")!.class).toBe("native");
    expect(row("D:1", "jackal")!.exposure).toBeCloseTo(place("D:1").reached * 1.6, 2);
    expect(row("D:5", "@poison")!.class).toBe("cause");
    expect(row("D:3", "unresolved:a strange machine")!.class).toBe("unresolved");
    // Generated but never killed anyone: still emitted, with deaths 0.
    expect(row("D:1", "ball_python")!.deaths).toBe(0);
  });

  it("classifies from spawn tables: ood / unexpected / native-by-levelgen", () => {
    const c = new Classifier(catalog);
    expect(c.classify("ogre", "D:4", false)).toBe("ood"); // ogre spawns D:7-13
    expect(c.classify("ogre", "D:4", true)).toBe("native"); // levelgen saw it there (vault/OOD placement)
    expect(c.classify("goblin", "D:9", false)).toBe("unexpected"); // deeper than its range
    expect(c.classify("yak", "D:3", false)).toBe("unexpected"); // not in D's tables at all
  });

  it("every place has a tooltip note", () => {
    expect(out.places.every((p) => p.reachedNote && p.reachedNote.length > 0)).toBe(true);
  });
});
