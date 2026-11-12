// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { betaQuantile, incBeta, jeffreys, lnGamma } from "./stats";

describe("lnGamma", () => {
  it("matches factorials", () => {
    expect(lnGamma(1)).toBeCloseTo(0, 12);
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
  });
});

describe("incBeta", () => {
  const xs = [0.01, 0.1, 0.3, 0.5, 0.77, 0.99];
  it("I_x(1,1) = x", () => xs.forEach((x) => expect(incBeta(x, 1, 1)).toBeCloseTo(x, 10)));
  it("I_x(a,1) = x^a", () => xs.forEach((x) => expect(incBeta(x, 3.5, 1)).toBeCloseTo(x ** 3.5, 10)));
  it("I_x(1,b) = 1-(1-x)^b", () => xs.forEach((x) => expect(incBeta(x, 1, 7)).toBeCloseTo(1 - (1 - x) ** 7, 10)));
  it("I_x(½,½) = (2/π) asin √x", () =>
    xs.forEach((x) => expect(incBeta(x, 0.5, 0.5)).toBeCloseTo((2 / Math.PI) * Math.asin(Math.sqrt(x)), 9)));
  it("symmetry I_x(a,b) = 1 - I_{1-x}(b,a)", () =>
    xs.forEach((x) => expect(incBeta(x, 2.5, 40.5)).toBeCloseTo(1 - incBeta(1 - x, 40.5, 2.5), 10)));
});

describe("betaQuantile", () => {
  it("inverts incBeta", () => {
    for (const [a, b] of [[0.5, 10.5], [5.5, 15.5], [100.5, 3.5]] as const)
      for (const p of [0.025, 0.5, 0.975]) expect(incBeta(betaQuantile(p, a, b), a, b)).toBeCloseTo(p, 9);
  });
});

describe("jeffreys", () => {
  it("returns null for n <= 0", () => expect(jeffreys(0, 0)).toBeNull());
  it("has the boundary conventions", () => {
    expect(jeffreys(0, 10)!.lower).toBe(0);
    expect(jeffreys(10, 10)!.upper).toBe(1);
  });
  it("brackets the estimate", () => {
    const i = jeffreys(5, 20)!;
    expect(i.estimate).toBe(0.25);
    expect(i.lower).toBeLessThan(0.25);
    expect(i.upper).toBeGreaterThan(0.25);
  });
  it("is symmetric: lower(x,n) = 1 - upper(n-x,n)", () => {
    expect(jeffreys(3, 40)!.lower).toBeCloseTo(1 - jeffreys(37, 40)!.upper, 10);
  });
  it("narrows with more data", () => {
    const small = jeffreys(5, 50)!;
    const big = jeffreys(500, 5000)!;
    expect(big.upper - big.lower).toBeLessThan(small.upper - small.lower);
  });
  it("accepts fractional n and clamps x <= n", () => {
    expect(jeffreys(2, 10.5)!.estimate).toBeCloseTo(2 / 10.5, 12);
    expect(jeffreys(12, 10)!.estimate).toBe(1);
  });
});
