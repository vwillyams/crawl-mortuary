// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * "Reached" estimation by implied paths (docs/research/00-plan.md §3).
 *
 * For each finished game we build a credit map: place → probability that this character reached it.
 * Credits from different sources are combined with max, not a sum: one character reaches a place
 * at most once. Summed over all games, the credits give `reached` per place.
 *
 * Sources of credit:
 *  1. The death place itself, plus every earlier floor of that branch (credit 1).
 *  2. The path up the branch tree: a branch's entrance lies somewhere in [entryMin, entryMax] of its
 *     parent, so parent level k gets P(entrance depth ≥ k). This applies recursively up to D.
 *  3. Prerequisite rules (config.ts). Example: "died in Depths ⇒ completed Lair with p = lairCredit".
 *     Each credited branch also gets its own path to D.
 */
import type { BranchInfo, Catalog, PlaceKey } from "@mortuary/contract";
import { parsePlace } from "@mortuary/contract";
import type { CreditSpec, NumRef, PrereqRule, ReachedConfig, ReachedParams, Trigger } from "./config.ts";

export class BranchTree {
  readonly byAbbrev = new Map<string, BranchInfo>();
  readonly children = new Map<string, string[]>();
  /** Branch abbreviations in catalog order, for stable output sorting. */
  readonly order: string[];

  constructor(branches: BranchInfo[]) {
    this.order = branches.map((b) => b.abbrev);
    for (const b of branches) this.byAbbrev.set(b.abbrev, b);
    for (const b of branches) {
      if (b.parent && this.byAbbrev.has(b.parent)) {
        const c = this.children.get(b.parent) ?? [];
        c.push(b.abbrev);
        this.children.set(b.parent, c);
      }
    }
  }

  static fromCatalog(c: Catalog): BranchTree {
    return new BranchTree(c.branches);
  }

  get(abbrev: string): BranchInfo | undefined {
    return this.byAbbrev.get(abbrev);
  }

  /** Strict descendants of a branch. */
  descendants(abbrev: string): string[] {
    const out: string[] = [];
    const stack = [...(this.children.get(abbrev) ?? [])];
    while (stack.length) {
      const b = stack.pop()!;
      out.push(b);
      stack.push(...(this.children.get(b) ?? []));
    }
    return out;
  }

  /** Ancestors, nearest first. */
  ancestors(abbrev: string): string[] {
    const out: string[] = [];
    let p = this.get(abbrev)?.parent ?? null;
    while (p && this.byAbbrev.has(p) && !out.includes(p)) {
      out.push(p);
      p = this.get(p)?.parent ?? null;
    }
    return out;
  }

  /** PlaceKey for level k of a branch. Single-floor branches have no ":n". */
  place(abbrev: string, level: number): PlaceKey {
    const info = this.get(abbrev);
    return info && info.depth === 1 ? abbrev : `${abbrev}:${level}`;
  }
}

/** Entrance depth distribution of a branch in its parent: depth → probability. */
export function entryDistribution(tree: BranchTree, abbrev: string, params: ReachedParams): Map<number, number> {
  const override = params.entryDist[abbrev];
  if (override) {
    const total = Object.values(override).reduce((a, b) => a + b, 0) || 1;
    return new Map(Object.entries(override).map(([d, p]) => [Number(d), p / total]));
  }
  const info = tree.get(abbrev);
  const lo = info?.entryMin ?? null;
  const hi = info?.entryMax ?? lo;
  if (lo == null || hi == null || hi < lo) return new Map([[1, 1]]);
  const n = hi - lo + 1;
  const m = new Map<number, number>();
  for (let d = lo; d <= hi; d++) m.set(d, 1 / n);
  return m;
}

export interface GameEnd {
  endPlace: PlaceKey;
  isWin: boolean;
  uniqueRunes: number;
}

interface CompiledRule {
  rule: PrereqRule;
  branches: Set<string>;
  kinds: Set<string>;
  wins: boolean;
}

export class ReachedEstimator {
  private readonly compiled: CompiledRule[];
  private readonly cache = new Map<string, Map<PlaceKey, number>>();
  /** Death branches that aren't in the catalog. Only the death place itself gets credit for these. */
  readonly unknownBranches = new Map<string, number>();

  constructor(
    readonly tree: BranchTree,
    readonly config: ReachedConfig,
  ) {
    this.compiled = config.rules.map((rule) => compileTrigger(tree, rule));
  }

  resolve(ref: NumRef, game?: GameEnd): number {
    if (typeof ref === "number") return ref;
    const name = ref.slice(1);
    const p = this.config.params;
    if (name === "sBranches") {
      const base = p.sBranchesCompleted;
      if (!p.useRunes || !game) return base;
      // Runes can only raise the count. The bump is capped at the number of S-branches in a game,
      // because runes from Vaults/Slime/Abyss etc. are indistinguishable.
      // TODO(aggregate): a 0-rune Depths death has completed no S-branch (the rune is at the bottom).
      // It may still have visited the upper floors. Consider lowering the credit for those instead of using the base.
      return Math.max(base, Math.min(game.uniqueRunes, p.sBranchesPerGame));
    }
    const v = (p as unknown as Record<string, unknown>)[name];
    if (typeof v !== "number") throw new Error(`unknown numeric param ${ref}`);
    return v;
  }

  /** Probability that this game reached each place. Memoized per (end place, win, rune bucket). */
  credit(game: GameEnd): Map<PlaceKey, number> {
    const runeBucket = Math.min(game.uniqueRunes, this.config.params.sBranchesPerGame);
    const sig = `${game.endPlace}|${game.isWin ? 1 : 0}|${runeBucket}`;
    let m = this.cache.get(sig);
    if (!m) {
      m = this.computeCredit({ ...game, uniqueRunes: runeBucket });
      this.cache.set(sig, m);
    }
    return m;
  }

  /** IDs of the rules that fire for a game (exposed for tests/debugging). */
  firingRules(game: GameEnd): string[] {
    const { branch } = parsePlace(game.endPlace);
    const info = this.tree.get(branch);
    return this.compiled
      .filter((c) => (game.isWin ? c.wins : c.branches.has(branch) || (info ? c.kinds.has(info.kind) : false)))
      .map((c) => c.rule.id);
  }

  private computeCredit(game: GameEnd): Map<PlaceKey, number> {
    const credit = new Map<PlaceKey, number>();
    const add = (place: PlaceKey, p: number) => {
      if (p <= 0) return;
      const prev = credit.get(place) ?? 0;
      if (p > prev) credit.set(place, Math.min(1, p));
    };

    const creditLevels = (branch: string, probs: number[]) => {
      probs.forEach((p, i) => add(this.tree.place(branch, i + 1), p));
      const info = this.tree.get(branch);
      const parent = info?.parent;
      const p1 = probs[0] ?? 0;
      if (!parent || !this.tree.get(parent) || p1 <= 0) return;
      const dist = entryDistribution(this.tree, branch, this.config.params);
      const maxE = Math.max(...dist.keys());
      const parentProbs: number[] = [];
      for (let k = 1; k <= maxE; k++) {
        let tail = 0;
        for (const [d, pd] of dist) if (d >= k) tail += pd;
        parentProbs.push(p1 * tail);
      }
      creditLevels(parent, parentProbs);
    };

    const applyCredit = (spec: CreditSpec) => {
      if (spec.type === "branch") {
        const info = this.tree.get(spec.branch);
        if (!info) return;
        const n = spec.levels === "all" ? info.depth : Math.min(info.depth, this.resolve(spec.levels, game));
        const p = this.resolve(spec.p, game);
        creditLevels(spec.branch, Array.from({ length: n }, () => p));
      } else {
        const members = spec.branches.filter((b) => this.tree.get(b));
        if (!members.length) return;
        const count = this.resolve(spec.count, game);
        const pres = members.map((b) => this.config.params.branchPresence[b] ?? 1);
        const total = pres.reduce((a, b) => a + b, 0) || 1;
        members.forEach((b, i) => {
          const share = Math.min(1, (count * pres[i]!) / total);
          const info = this.tree.get(b)!;
          creditLevels(b, Array.from({ length: info.depth }, () => share));
        });
      }
    };

    const { branch, depth } = parsePlace(game.endPlace);
    const info = this.tree.get(branch);
    if (!game.isWin) {
      if (info) creditLevels(branch, Array.from({ length: depth ?? 1 }, () => 1));
      else {
        add(game.endPlace, 1);
        this.unknownBranches.set(branch, (this.unknownBranches.get(branch) ?? 0) + 1);
      }
    }
    for (const c of this.compiled) {
      const fires = game.isWin ? c.wins : c.branches.has(branch) || (info ? c.kinds.has(info.kind) : false);
      if (fires) applyCredit(c.rule.credit);
    }
    return credit;
  }

  /** Grade of a place: "main" if it's on the configured main route, otherwise "lowerBound". */
  grade(place: PlaceKey): "main" | "lowerBound" {
    const { branch, depth } = parsePlace(place);
    const spec = this.config.mainRoute[branch];
    if (spec === undefined) return "lowerBound";
    if (spec === "all") return "main";
    return (depth ?? 1) <= this.resolve(spec) ? "main" : "lowerBound";
  }

  /** Human-readable explanation of how `reached` was estimated for a place. Used for the UI tooltip. */
  explain(place: PlaceKey): string {
    const { branch, depth } = parsePlace(place);
    const info = this.tree.get(branch);
    const name = info?.name ?? branch;
    const parts: string[] = [
      "Estimated from where characters died (no milestone data).",
    ];
    const desc = this.tree.descendants(branch);
    const deeper = info && info.depth > 1 ? ` or deeper in ${name}` : "";
    parts.push(
      `Counts every character who died here${deeper}` +
        (desc.length ? `, or in a branch entered from it (${listNames(desc.map((b) => this.tree.get(b)?.name ?? b))})` : "") +
        ".",
    );

    // Entrances on this floor that are uncertain.
    const entrances = (this.tree.children.get(branch) ?? [])
      .map((c) => this.tree.get(c)!)
      .filter((c) => c.entryMin != null && c.entryMax != null && c.entryMin !== c.entryMax)
      .filter((c) => depth == null || (depth >= c.entryMin! && depth <= c.entryMax!));
    if (entrances.length) {
      parts.push(
        "Branch entrances near this floor vary per game and are assumed equally likely anywhere in their range: " +
          entrances.map((c) => `${c.name} ${branch}:${c.entryMin}–${c.entryMax}`).join(", ") +
          ".",
      );
    }

    // Prerequisite rules whose credit lands on this branch, directly or through the path to D.
    for (const c of this.compiled) {
      const spec = c.rule.credit;
      const targets = spec.type === "branch" ? [spec.branch] : spec.branches;
      const hits = targets.filter((t) => t === branch || this.tree.ancestors(t).includes(branch));
      if (!hits.length) continue;
      // Rules that only reach this place through ancestors are already covered by the "deeper" sentence above.
      if (!targets.includes(branch)) continue;
      const who = describeTrigger(this.tree, c);
      if (spec.type === "branch") {
        const p = Math.round(this.resolve(spec.p) * 100);
        const lv =
          spec.levels === "all" ? "" : ` (floors 1–${this.resolve(spec.levels)})`;
        if (spec.levels !== "all" && depth != null && depth > this.resolve(spec.levels)) continue;
        parts.push(`Also assumes ${p}% of ${who} went through ${name}${lv}.`);
      } else {
        const base = this.config.params.sBranchesCompleted;
        parts.push(
          `Also assumes ${who} completed ${base} of the ${spec.branches.length} Lair sub-branches` +
            (this.config.params.useRunes ? " (more if their rune count says so)" : "") +
            ", split by how often each sub-branch is generated.",
        );
      }
    }

    if (this.grade(place) === "lowerBound") {
      parts.push("Characters who visited and left alive aren't counted, so this is a strict lower bound.");
    }
    return parts.join(" ");
  }
}

function listNames(names: string[], max = 5): string {
  return names.length <= max ? names.join(", ") : `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

function compileTrigger(tree: BranchTree, rule: PrereqRule): CompiledRule {
  const t: Trigger = rule.when;
  const branches = new Set<string>(t.branches ?? []);
  for (const root of t.descendantsOf ?? []) for (const d of tree.descendants(root)) branches.add(d);
  return { rule, branches, kinds: new Set(t.kinds ?? []), wins: !!t.wins };
}

function describeTrigger(tree: BranchTree, c: CompiledRule): string {
  const names = [...c.branches].filter((b) => tree.get(b)).map((b) => tree.get(b)!.name);
  const bits: string[] = [];
  if (names.length) bits.push(`characters who died in ${listNames(names, 6)}`);
  if (c.kinds.size && !names.length) bits.push(`characters who died in ${[...c.kinds].join("/")} branches`);
  if (c.wins) bits.push("winners");
  return bits.join(" and ") || "characters";
}
