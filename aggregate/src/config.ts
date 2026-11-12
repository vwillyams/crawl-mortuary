// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Tunable configuration for the "reached" estimate (docs/research/00-plan.md §3).
 *
 * Without milestones we infer, from where each character died, which places they must (or probably)
 * passed through. The logic in reached.ts is generic: it walks the catalog's branch tree. Every
 * game-specific assumption lives here as data, so it can be tuned or overridden without code changes.
 */

/** Selects which death branches a rule applies to. A death matches if ANY clause matches. */
export interface Trigger {
  /** Deaths in exactly these branches. */
  branches?: string[];
  /** Deaths in any strict descendant of these branches (computed from the catalog's parent links). */
  descendantsOf?: string[];
  /** Deaths in any branch whose catalog `kind` is one of these (e.g. "hell"). */
  kinds?: string[];
  /** Applies to winning games. */
  wins?: boolean;
}

/**
 * A number, or "$name" referring to a field of ReachedParams.
 * "$sBranches" is special: it resolves per game, using runes when `useRunes` is set.
 */
export type NumRef = number | `$${string}`;

export type CreditSpec =
  /** Credit levels 1..n of a branch (and, transitively, its path from D) at probability p. */
  | { type: "branch"; branch: string; levels: "all" | NumRef; p: NumRef }
  /**
   * Credit "count" completions spread over a group of alternative branches (the S-branches).
   * Each member gets count × presence(member) / Σ presence, for all of its levels.
   */
  | { type: "group"; branches: string[]; count: NumRef };

export interface PrereqRule {
  id: string;
  when: Trigger;
  credit: CreditSpec;
}

export interface ReachedParams {
  /** Expected S-branches completed by characters who died in Vaults/Depths/Zot/hells, or won (user's "50%" = 1 of 2). */
  sBranchesCompleted: number;
  /** S-branches that exist in one game (crawl 0.34 picks 2 of 4). This caps the rune-based bump. */
  sBranchesPerGame: number;
  /** If true, a game's uniqueRunes can RAISE its S-branch count: count = max(base, min(uniqueRunes, perGame)). */
  useRunes: boolean;
  /** P(did the Orcish Mines | died in Vaults/Depths/Zot/hells, or won). */
  pOrc: number;
  /** P(did Vaults:1..vaultsLevels | died in Crypt/Tomb/Forest/Zot, or won). */
  vaultsCredit: number;
  vaultsLevels: number;
  /** P(completed Lair | died anywhere past it). */
  lairCredit: number;
  /**
   * Override the distribution of a branch's entrance depth in its parent: { Lair: { 8: 0.25, 9: 0.25, ... } }.
   * Default: uniform over the catalog's [entryMin, entryMax].
   * TODO(aggregate): fill from levelgen's observed entrance frequencies once levelgen exports them.
   */
  entryDist: Record<string, Record<number, number>>;
  /**
   * P(branch exists in a game), used to split the S-branch credit. Filled from levelgen
   * (instances / seeds of <branch>:1) when available; otherwise the members are weighted equally.
   */
  branchPresence: Record<string, number>;
}

export interface ReachedConfig {
  params: ReachedParams;
  rules: PrereqRule[];
  /**
   * Places graded "main" (estimate is accurate enough). Everything else is "lowerBound".
   * Value: "all" levels, or levels 1..n.
   */
  mainRoute: Record<string, "all" | NumRef>;
  /** ktyp values that mean "the game ended without dying". Such games aren't deaths. */
  nonDeathKtyps: string[];
}

const S_BRANCHES = ["Swamp", "Shoals", "Snake", "Spider"];
/** Hell branch abbreviations, as a fallback in case the catalog's `kind` isn't "hell". */
const HELLS = ["Hell", "Dis", "Geh", "Coc", "Tar"];

/** Deaths past the point where nearly everyone has done Lair, an S-branch and (usually) Orc. */
const LATE_GAME: Trigger = {
  branches: ["Vaults", "Depths", ...HELLS],
  descendantsOf: ["Vaults", "Depths"],
  kinds: ["hell"],
  wins: true,
};

export const DEFAULT_CONFIG: ReachedConfig = {
  params: {
    sBranchesCompleted: 1,
    sBranchesPerGame: 2,
    useRunes: true,
    pOrc: 0.8,
    vaultsCredit: 0.9,
    vaultsLevels: 4,
    lairCredit: 1,
    entryDist: {},
    branchPresence: {},
  },
  rules: [
    {
      id: "lair",
      when: {
        branches: ["Elf", "Vaults", "Depths", ...HELLS],
        descendantsOf: ["Lair", "Vaults", "Depths"],
        kinds: ["hell"],
        wins: true,
      },
      credit: { type: "branch", branch: "Lair", levels: "all", p: "$lairCredit" },
    },
    {
      id: "s-branches",
      when: LATE_GAME,
      credit: { type: "group", branches: S_BRANCHES, count: "$sBranches" },
    },
    { id: "orc", when: LATE_GAME, credit: { type: "branch", branch: "Orc", levels: "all", p: "$pOrc" } },
    {
      id: "vaults",
      when: { descendantsOf: ["Vaults"], branches: ["Zot"], wins: true },
      credit: { type: "branch", branch: "Vaults", levels: "$vaultsLevels", p: "$vaultsCredit" },
    },
    {
      id: "hell-depths",
      when: { kinds: ["hell"], branches: HELLS },
      credit: { type: "branch", branch: "Depths", levels: "all", p: 1 },
    },
    { id: "win-zot", when: { wins: true }, credit: { type: "branch", branch: "Zot", levels: "all", p: 1 } },
  ],
  mainRoute: {
    D: "all",
    Lair: "all",
    Orc: "all",
    Swamp: "all",
    Shoals: "all",
    Snake: "all",
    Spider: "all",
    Vaults: "$vaultsLevels",
    Depths: "all",
    Zot: "all",
  },
  // TODO(aggregate): "leaving" games (left the dungeon without the orb) carry no place information. They're
  // currently ignored entirely. Decide whether they should credit anything.
  nonDeathKtyps: ["winning", "leaving"],
};

/** Deep-merge partial overrides (e.g. from a JSON file) onto the defaults. */
export function withOverrides(
  base: ReachedConfig,
  over: { params?: Partial<ReachedParams>; rules?: PrereqRule[]; mainRoute?: ReachedConfig["mainRoute"] } = {},
): ReachedConfig {
  return {
    ...base,
    params: { ...base.params, ...over.params },
    rules: over.rules ?? base.rules,
    mainRoute: over.mainRoute ?? base.mainRoute,
  };
}

export const DEFAULT_CAUSE_LABELS: Record<string, string> = {
  "@poison": "poison",
  "@quit": "quit",
  "@starvation": "starvation",
  "@zot": "the Zot clock",
  "@lava": "lava",
  "@water": "drowning",
  "@trap": "a trap",
  "@self": "self-inflicted",
  "@cloud": "a cloud",
  "@other": "other",
};
