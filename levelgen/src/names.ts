// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Map crawl's in-game monster names (Lua `type_name` + `name`) to contract keys and variants.
 * Conventions: docs/research/00-plan.md §5 and 01-monster-sampling.md §6–7.
 *
 *   type "ugly thing",            name "green ugly thing"             → ugly_thing            colour=green
 *   type "draconian annihilator", name "yellow draconian annihilator" → draconian_annihilator colour=yellow
 *   type "hydra",                 name "seven-headed hydra"           → hydra                 heads=7
 *   type "zombie",                name "orc zombie"                   → zombie                base=orc
 *   type "spectral thing",        name "spectral harpy"               → spectral_thing        base=harpy
 *   type "slime creature",        name "very large slime creature"    → slime_creature        size=very_large
 *
 * Anything else (vault-renamed monsters like "Tutz" or "goblin sharper", dancing weapons,
 * pillars of salt, statues) maps to its type with no variant.
 */
import { type Catalog, type MonsterInfo, type Variant, parsePlace, variantKey } from "@mortuary/contract";

const DERIVED_SUFFIX = new Set(["zombie", "skeleton", "simulacrum", "draugr"]);
const DERIVED_PREFIX: Record<string, string> = { spectral_thing: "spectral " };
const COLOURS = new Set([
  "black", "blue", "green", "cyan", "red", "magenta", "brown", "lightgrey", "darkgrey", "grey",
  "lightblue", "lightgreen", "lightcyan", "lightred", "lightmagenta", "yellow", "white", "purple",
  "pale", "mottled", "golden", "silver", "iron", "bronze",
]);
const SIZES = new Set(["large", "very large", "enormous", "titanic"]);
const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** "seven" → 7, "twenty-seven" → 27, "27" → 27. Returns undefined if it's not a number. */
export function parseNumberWord(w: string): number | undefined {
  if (/^\d+$/.test(w)) return Number(w);
  const u = UNITS.indexOf(w);
  if (u >= 0) return u;
  const [t, rest] = w.split("-");
  const ti = TENS.indexOf(t ?? "");
  if (ti >= 2) {
    if (rest === undefined) return ti * 10;
    const ri = UNITS.indexOf(rest);
    if (ri > 0 && ri < 10) return ti * 10 + ri;
  }
  return undefined;
}

const norm = (s: string) => s.toLowerCase().replace(/^the /, "").trim();
const slug = (s: string) => norm(s).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "unknown";

export interface Resolved {
  key: string;
  variant: Variant;
  /** false if the type name wasn't in the catalog (the key is then a slug fallback). */
  known: boolean;
}

export class NameResolver {
  private byName = new Map<string, MonsterInfo[]>();
  private branchNames = new Map<string, string>();
  readonly unknown = new Map<string, number>();

  constructor(catalog: Catalog) {
    for (const m of catalog.monsters) {
      for (const n of new Set([norm(m.name)])) {
        const list = this.byName.get(n) ?? [];
        list.push(m);
        this.byName.set(n, list);
      }
    }
    for (const b of catalog.branches) this.branchNames.set(b.abbrev, slug(b.name));
  }

  /** Name → key, using the place to break ties (e.g. the four per-Hell "Serpent of Hell" enums). */
  keyFor(name: string, place?: string): string | undefined {
    const cands = this.byName.get(norm(name));
    if (!cands?.length) return undefined;
    if (cands.length === 1) return cands[0]!.key;
    const branch = place ? parsePlace(place).branch : undefined;
    const bslug = branch ? this.branchNames.get(branch) : undefined;
    const score = (m: MonsterInfo) =>
      (branch && m.spawns.some((s) => s.branch === branch) ? 4 : 0) +
      (bslug && m.key.endsWith(bslug) ? 2 : 0) +
      (m.flags.includes("removed") ? -8 : 0);
    return [...cands].sort((a, b) => score(b) - score(a) || a.key.length - b.key.length)[0]!.key;
  }

  resolve(typeName: string, name: string, place?: string): Resolved {
    const key = this.keyFor(typeName, place);
    if (!key) {
      this.unknown.set(typeName, (this.unknown.get(typeName) ?? 0) + 1);
      return { key: slug(typeName), variant: "", known: false };
    }
    return { key, variant: this.variantFor(key, norm(typeName), norm(name), place), known: true };
  }

  private variantFor(key: string, type: string, name: string, place?: string): Variant {
    if (name === type) return "";
    // Derived undead: "<base> zombie" / "spectral <base>"
    if (DERIVED_SUFFIX.has(key) && name.endsWith(` ${type}`)) {
      const base = this.keyFor(name.slice(0, -type.length - 1), place);
      return base ? variantKey({ base }) : "";
    }
    const pre = DERIVED_PREFIX[key];
    if (pre && name.startsWith(pre)) {
      const base = this.keyFor(name.slice(pre.length), place);
      return base ? variantKey({ base }) : "";
    }
    if (!name.endsWith(` ${type}`)) return ""; // renamed / named monster
    const prefix = name.slice(0, -type.length - 1);
    const heads = /^(\S+)-headed$/.exec(prefix);
    if (heads) {
      const n = parseNumberWord(heads[1]!);
      return n !== undefined ? variantKey({ heads: n }) : "";
    }
    if (COLOURS.has(prefix)) return variantKey({ colour: prefix });
    if (SIZES.has(prefix)) return variantKey({ size: prefix });
    // TODO(levelgen): other prefixes (e.g. "megabat" style renames) are deliberately dropped.
    return "";
  }
}
