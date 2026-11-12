// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";
import { type Catalog, GameRow, parsePlace } from "@mortuary/contract";
import { REPO_ROOT } from "../catalog.ts";
import type { GameSourceAdapter, RawGame } from "../types.ts";

export const FIXTURE_GAMES = `${REPO_ROOT}packages/contract/fixtures/games.jsonl`;

/** Turn an already-normalized fixture GameRow back into a RawGame, so it goes through the real normalize path. */
export function rawFromGameRow(r: GameRow): RawGame {
  const { branch, depth } = parsePlace(r.endPlace);
  return {
    source: "fixture",
    server: r.server,
    player: r.player,
    isBotHint: r.isBot,
    version: r.release,
    isWin: r.isWin,
    xl: r.xl,
    race: r.race,
    cls: r.cls,
    god: r.god,
    turns: r.turns,
    runes: r.runes,
    uniqueRunes: r.uniqueRunes,
    startAt: r.startAt,
    endAt: r.endAt,
    branch,
    lvl: depth ?? 1,
    ktyp: r.ktyp,
    killer: r.killerRaw,
    killerFlags: null,
    endMessage: r.endMessage,
  };
}

/** Small deterministic PRNG (mulberry32), so synthesized fixtures are reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesize n plausible games from the catalog's spawn tables: deaths to spawnable monsters at
 * places in their depth range, plus some non-monster deaths and wins. Use this for pipeline/load
 * testing only. The numbers mean nothing.
 */
export function* synthesize(catalog: Catalog, n: number, seed = 34): Generator<RawGame> {
  const rand = rng(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const depthOf = new Map(catalog.branches.map((b) => [b.abbrev, b.depth]));
  const spawnable = catalog.monsters.flatMap((m) => m.spawns.filter((s) => depthOf.has(s.branch)).map((s) => ({ m, s })));
  const article = (name: string, unique: boolean) => (unique ? name : `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`);
  for (let i = 0; i < n; i++) {
    const t = new Date(Date.UTC(2026, 5, 1) + i * 60_000).toISOString();
    const base: Omit<RawGame, "branch" | "lvl" | "ktyp" | "killer" | "endMessage" | "isWin"> = {
      source: "fixture",
      server: pick(["CDI", "CAO", "CXC", "CBR2"]),
      player: `synth${i % 200}`,
      version: rand() < 0.5 ? "0.34.0" : "0.34.1",
      xl: 1 + Math.floor(rand() * 15),
      race: pick(["Minotaur", "Gargoyle", "Deep Elf", "Human"]),
      cls: pick(["Fighter", "Berserker", "Fire Elementalist", "Hunter"]),
      god: null,
      turns: 500 + Math.floor(rand() * 50_000),
      runes: 0,
      uniqueRunes: 0,
      startAt: t,
      endAt: t,
      killerFlags: null,
    };
    const roll = rand();
    if (roll < 0.01 || spawnable.length === 0) {
      yield { ...base, isWin: true, runes: 3, uniqueRunes: 3, branch: "D", lvl: 1, ktyp: "winning", killer: null, endMessage: "escaped with the Orb" };
    } else if (roll < 0.1) {
      const [ktyp, msg] = pick([["quitting", "quit the game"], ["starvation", "starved to death"], ["pois", "succumbed to poison"]] as const);
      yield { ...base, isWin: false, branch: "D", lvl: 1 + Math.floor(rand() * 5), ktyp, killer: null, endMessage: msg };
    } else {
      const { m, s } = pick(spawnable);
      const lo = Math.max(1, s.minDepth);
      const hi = Math.min(depthOf.get(s.branch)!, Math.max(lo, s.maxDepth));
      const lvl = Math.min(hi, lo + Math.floor(rand() * (hi - lo + 1)));
      const killer = article(m.name, m.unique);
      yield { ...base, isWin: false, branch: s.branch, lvl, ktyp: "mon", killer, killerFlags: m.unique ? "unique" : null, endMessage: `slain by ${killer}` };
    }
  }
}

export function fixtureSource(opts: { catalog: Catalog; synthesize?: number; path?: string }): GameSourceAdapter {
  return {
    name: "fixture",
    async *read() {
      const lines = readFileSync(opts.path ?? FIXTURE_GAMES, "utf8").split("\n").filter(Boolean);
      for (const l of lines) yield rawFromGameRow(GameRow.parse(JSON.parse(l)));
      if (opts.synthesize) yield* synthesize(opts.catalog, opts.synthesize);
    },
  };
}
