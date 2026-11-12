// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { combinePlace, parseSelection, resolveSelection, selectionToParam } from "./select";
import type { PlaceShard } from "./shards";

const avail = ["0.34", "0.33", "0.32", "0.30"];

describe("selection", () => {
  it("parses one / range / all / fallback", () => {
    expect(parseSelection(null, avail, "0.34")).toEqual({ kind: "one", v: "0.34" });
    expect(parseSelection("0.33", avail, "0.34")).toEqual({ kind: "one", v: "0.33" });
    expect(parseSelection("bogus", avail, "0.34")).toEqual({ kind: "one", v: "0.34" });
    expect(parseSelection("all", avail, "0.34")).toEqual({ kind: "all" });
    expect(parseSelection("0.30..0.33", avail, "0.34")).toEqual({ kind: "range", from: "0.30", to: "0.33" });
  });
  it("resolves ranges inclusively in either order, newest first", () => {
    expect(resolveSelection({ kind: "range", from: "0.33", to: "0.30" }, avail)).toEqual(["0.33", "0.32", "0.30"]);
    expect(resolveSelection({ kind: "all" }, avail)).toEqual(avail);
  });
  it("round-trips to a param", () => {
    expect(selectionToParam(parseSelection("0.30..0.34", avail, "0.34"))).toBe("0.30..0.34");
  });
});

describe("combinePlace", () => {
  const shard: PlaceShard = {
    place: "D:3",
    bySeries: {
      "0.34": {
        reached: 100,
        reachedMethod: "implied",
        reachedGrade: "main",
        deathsTotal: 10,
        killers: [{ key: "orc", variant: "", class: "native", deaths: 4, exposure: 90, presentExposure: 60 }],
      },
      "0.33": {
        reached: 50,
        reachedMethod: "implied",
        reachedGrade: "lowerBound",
        deathsTotal: 5,
        killers: [
          { key: "orc", variant: "", class: "native", deaths: 1 },
          { key: "@poison", variant: "", class: "cause", deaths: 2 },
        ],
      },
    },
  };
  it("sums additive counts and keeps the exposure denominator separate", () => {
    const c = combinePlace(shard, ["0.34", "0.33"])!;
    expect(c.reached).toBe(150);
    expect(c.deathsTotal).toBe(15);
    expect(c.reachedGrade).toBe("lowerBound");
    const orc = c.killers.find((k) => k.key === "orc")!;
    expect(orc.deaths).toBe(5);
    expect(orc.exposure).toBe(90);
    expect(orc.exposureReached).toBe(100); // only 0.34 had levelgen data
  });
  it("returns null when no selected series has data", () => {
    expect(combinePlace(shard, ["0.30"])).toBeNull();
  });
});
