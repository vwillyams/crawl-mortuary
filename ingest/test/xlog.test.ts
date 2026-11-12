// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { findSeparator, parseXlogLine, quoteValue, xlogTimeToIso } from "../src/xlog.ts";

describe("parseXlogLine", () => {
  it("parses a real-shaped 0.34 line", () => {
    const x = parseXlogLine(
      "v=0.34.1:vlong=0.34.1-5-gfd259fce64:name=foo:race=Gargoyle:place=D::1:br=D:lvl=1:ktyp=mon:killer=a gnoll:kaux=a +0 spear:tmsg=slain by a gnoll",
    );
    expect(x.v).toBe("0.34.1");
    expect(x.place).toBe("D:1");
    expect(x.killer).toBe("a gnoll");
    expect(x.kaux).toBe("a +0 spear");
    expect(x.tmsg).toBe("slain by a gnoll");
  });

  it("unescapes every :: (dcss-stats only unescapes the first)", () => {
    expect(parseXlogLine("kpath=a::b::c:x=1")).toEqual({ kpath: "a:b:c", x: "1" });
  });

  it("keeps '=' inside values (dcss-stats truncates them)", () => {
    expect(parseXlogLine("tmsg=a=b=c:y=2")).toEqual({ tmsg: "a=b=c", y: "2" });
  });

  it("handles a value ending in an escaped colon followed by a separator (:::)", () => {
    expect(parseXlogLine("a=x:::b=y")).toEqual({ a: "x:", b: "y" });
  });

  it("handles empty values and trailing whitespace", () => {
    expect(parseXlogLine("a=:b=2\n")).toEqual({ a: "", b: "2" });
  });

  it("throws on trailing garbage", () => {
    expect(() => parseXlogLine("a=1:garbage")).toThrow(/trailing/);
  });

  it("round-trips quoteValue", () => {
    const v = "Bogdan: the orc";
    expect(parseXlogLine(`k=${quoteValue(v)}`).k).toBe(v);
  });

  it("findSeparator skips escapes", () => {
    expect(findSeparator("ab::cd:ef")).toBe(6);
    expect(findSeparator("ab::cd")).toBe(-1);
  });
});

describe("xlogTimeToIso", () => {
  it("treats the month as 0-based", () => {
    expect(xlogTimeToIso("20261012174912S")).toBe("2026-11-12T17:49:12.000Z");
    expect(xlogTimeToIso("20260001000000D")).toBe("2026-01-01T00:00:00.000Z");
  });
});
