// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Killer resolution: raw logfile `killer` string (+ ktyp, killer_flags, death branch) →
 * contract KillerKey + Variant.
 *
 * The rules are ported and extended from go-sequell's `crawl/killer` and `crawl/unique` packages
 * (MIT, Copyright the go-sequell authors, https://github.com/crawl/go-sequell). Name construction was
 * checked against crawl 0.34.1 (mon-info.cc `common_name`, hiscores.cc `init_death_cause`).
 *
 * Unlike go-sequell, which normalizes to a display string, we keep the information it throws
 * away (head counts, colours, zombie bases) as a Variant. Monster rows, groups and
 * drill-downs are then just sums downstream.
 */
import { type Catalog, type KillerKey, type MonsterKey, type Variant, variantKey } from "@mortuary/contract";
import { causeForKtyp, NON_DEATH_KTYP } from "./causes.ts";

export interface Resolution {
  /** null only for non-deaths (wins). */
  key: KillerKey | null;
  variant: Variant;
  /** Which rule fired, for audit reports and tests. */
  rule: string;
}

export interface ResolveInput {
  killer: string | null | undefined;
  ktyp: string | null | undefined;
  killerFlags?: string | null;
  /** Death branch abbrev ("Geh", "Zot", ...), used to disambiguate names shared by several enums. */
  branch?: string | null;
}

/** Keys for structural monsters. These are crawl enum names (0.34.1) and are emitted even if the catalog lacks them. */
export const STRUCTURAL = {
  playerGhost: "player_ghost",
  playerIllusion: "player_illusion",
  playerShadow: "player_shadow",
  panLord: "pandemonium_lord",
  shapeshifter: "shapeshifter",
  glowingShapeshifter: "glowing_shapeshifter",
  hydra: "hydra",
  zombie: "zombie",
  skeleton: "skeleton", // removed before 0.34; kept for old versions
  simulacrum: "simulacrum",
  draugr: "draugr",
  spectralThing: "spectral_thing",
  boundSoul: "bound_soul",
  mutantBeast: "mutant_beast",
  dancingWeapon: "dancing_weapon",
  spectralWeapon: "spectral_weapon",
  uglyThing: "ugly_thing",
  veryUglyThing: "very_ugly_thing",
} as const satisfies Record<string, MonsterKey>;

/** Names shared by several enums, disambiguated by death branch. */
const BRANCH_DISAMBIGUATION: Record<string, Record<string, MonsterKey>> = {
  "serpent of hell": {
    Geh: "serpent_of_hell",
    Coc: "serpent_of_hell_cocytus",
    Dis: "serpent_of_hell_dis",
    Tar: "serpent_of_hell_tartarus",
  },
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Killer strings that aren't a monster at all. */
const SPECIAL_KILLERS: Record<string, { key: KillerKey; rule: string }> = {
  you: { key: "@self", rule: "self" },
  themself: { key: "@self", rule: "self" },
  "an ally": { key: "@ally", rule: "ally" },
  "their own shadow": { key: STRUCTURAL.playerShadow, rule: "player-shadow" },
};

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

const ARTICLE = /^(?:an?|the) /i;
const stripArticle = (s: string) => s.replace(ARTICLE, "");

/** Index of catalog names for fast lookup. Build once per catalog. */
export class CatalogIndex {
  /** lowercased name (no article) → keys */
  private readonly byName = new Map<string, MonsterKey[]>();
  /** case-sensitive unique name (as written, no leading "the ") → key */
  private readonly uniques = new Map<string, MonsterKey>();
  readonly keys: Set<MonsterKey>;

  constructor(readonly catalog: Catalog) {
    this.keys = new Set(catalog.monsters.map((m) => m.key));
    for (const m of catalog.monsters) {
      const n = stripArticle(m.name).toLowerCase();
      const list = this.byName.get(n) ?? [];
      list.push(m.key);
      this.byName.set(n, list);
      if (m.unique) {
        // Several enums can share a name (Bai Suzhen and her dragon form, the four Serpents of Hell).
        // Prefer the one whose key is the slug of the name.
        const u = stripArticle(m.name);
        if (!this.uniques.has(u) || m.key === slug(u)) this.uniques.set(u, m.key);
      }
    }
    for (const [alias, key] of Object.entries(catalog.aliases ?? {})) {
      this.byName.set(stripArticle(alias).toLowerCase(), [key]);
    }
  }

  /** Look up a (possibly articled) plain monster name. */
  lookup(name: string, branch?: string | null): MonsterKey | undefined {
    const n = stripArticle(name.trim()).toLowerCase();
    const dis = BRANCH_DISAMBIGUATION[n];
    if (dis && branch && dis[branch]) return dis[branch];
    const hits = this.byName.get(n);
    if (hits && hits.length > 1) return hits.find((k) => k === slug(n)) ?? hits[0];
    return hits?.[0];
  }

  lookupUnique(name: string): MonsterKey | undefined {
    return this.uniques.get(stripArticle(name.trim()));
  }

  has(key: string): boolean {
    return this.keys.has(key);
  }
}

/**
 * Resolve the "core" monster name (no article). Returns key + variant parts, or undefined.
 * Recursive for derived forms ("seven-headed hydra zombie" → zombie, base=hydra, heads=7).
 */
function resolveCore(
  idx: CatalogIndex,
  name: string,
  branch: string | null | undefined,
  parts: Record<string, string | number>,
): { key: MonsterKey; rule: string } | undefined {
  const s = stripArticle(name.trim());

  // 1. Direct hit. This covers "orc warrior", "spectral warrior", "Lernaean hydra", draconian base colours, ...
  const direct = idx.lookup(s, branch);
  if (direct) return { key: direct, rule: "direct" };
  const uniq = idx.lookupUnique(s);
  if (uniq) return { key: uniq, rule: "unique" };

  // 2. Status prefixes that don't change the monster.
  const status = /^(helpless|ghostly|vampire|sensed|active) (.+)$/.exec(s);
  if (status) return resolveCore(idx, status[2]!, branch, parts);

  // 3. Hydra heads: "seven-headed hydra", "15-headed hydra", "27-headed Lernaean hydra".
  const heads = /^(\w+)-headed (.+)$/.exec(s);
  if (heads) {
    const n = NUMBER_WORDS[heads[1]!.toLowerCase()] ?? Number(heads[1]);
    if (Number.isFinite(n)) parts.heads = n;
    const inner = resolveCore(idx, heads[2]!, branch, parts);
    return inner ? { key: inner.key, rule: `heads+${inner.rule}` } : undefined;
  }

  // 4. Derived undead suffixes: "<base> zombie|simulacrum|draugr|skeleton".
  const derived = /^(.+) (zombie|simulacrum|draugr|skeleton)$/.exec(s);
  if (derived) {
    setBase(idx, derived[1]!, branch, parts);
    return { key: STRUCTURAL[derived[2] as "zombie" | "simulacrum" | "draugr" | "skeleton"], rule: `derived:${derived[2]}` };
  }
  // "spectral <base>" (spectral thing) and "bound <base>" (bound soul). Real monsters such as
  // "spectral warrior" were already caught by the direct lookup.
  const spectralWeapon = /^spectral [+-]?\d+ .+$/.exec(s);
  if (spectralWeapon) return { key: STRUCTURAL.spectralWeapon, rule: "spectral-weapon" };
  const prefixDerived = /^(spectral|bound) (.+)$/.exec(s);
  if (prefixDerived) {
    setBase(idx, prefixDerived[2]!, branch, parts);
    const formKey = prefixDerived[1] === "spectral" ? STRUCTURAL.spectralThing : STRUCTURAL.boundSoul;
    return { key: formKey, rule: `derived:${prefixDerived[1]}` };
  }

  // 5. Colours: "<colour> ugly thing", "<colour> very ugly thing", "<colour> draconian <job>".
  const ugly = /^(\w+) (very ugly thing|ugly thing)$/.exec(s);
  if (ugly) {
    parts.colour = ugly[1]!;
    const key = idx.lookup(ugly[2]!) ?? (ugly[2] === "ugly thing" ? STRUCTURAL.uglyThing : STRUCTURAL.veryUglyThing);
    return { key, rule: "colour:ugly" };
  }
  const dracJob = /^(\w+) (draconian \w+)$/.exec(s);
  if (dracJob) {
    const key = idx.lookup(dracJob[2]!);
    if (key) {
      parts.colour = dracJob[1]!;
      return { key, rule: "colour:draconian" };
    }
  }

  // 6. Named monsters: "Bogdan the orc warrior" → orc_warrior (go-sequell's uniqueNormalizer title rule).
  const titled = /^(\p{Lu}[\p{L}\p{N}']*(?: \p{Lu}[\p{L}\p{N}']*)*) the (.+)$/u.exec(s);
  if (titled) {
    const uniqTitled = idx.lookupUnique(titled[1]!);
    if (uniqTitled) return { key: uniqTitled, rule: "unique-titled" };
    const inner = resolveCore(idx, titled[2]!, branch, parts);
    if (inner) return { key: inner.key, rule: `named+${inner.rule}` };
  }

  // 7. Weapons as monsters (dancing weapons are named after their item: "+2 broad axe").
  if (/^[+-]\d+ /.test(s)) return { key: STRUCTURAL.dancingWeapon, rule: "dancing-weapon" };

  // 8. Mutant beasts: "juvenile fire-frost beast".
  if (/ beast$/.test(s) && /^(embryonic|juvenile|mature|grand|primal) /.test(s))
    return { key: STRUCTURAL.mutantBeast, rule: "mutant-beast" };

  return undefined;
}

/** Record the base monster of a derived form. Unknown bases are kept as a slug so no information is lost. */
function setBase(
  idx: CatalogIndex,
  baseName: string,
  branch: string | null | undefined,
  parts: Record<string, string | number>,
): void {
  const base = resolveCore(idx, baseName, branch, parts);
  parts.base = base ? base.key : slug(baseName);
}

export function resolveKiller(idx: CatalogIndex, input: ResolveInput): Resolution {
  const ktyp = input.ktyp ?? null;
  if (ktyp && NON_DEATH_KTYP.has(ktyp)) return { key: null, variant: "", rule: "win" };

  const raw = (input.killer ?? "").trim();
  if (!raw) return { key: causeForKtyp(ktyp), variant: "", rule: "cause" };

  const special = SPECIAL_KILLERS[raw.toLowerCase()];
  if (special) return { key: special.key, variant: "", rule: special.rule };

  const parts: Record<string, string | number> = {};
  let s = raw;

  // Suffix decorations added by hiscores.cc init_death_cause.
  if (/ \(glowing shapeshifter\)$/.test(s)) return { key: STRUCTURAL.glowingShapeshifter, variant: "", rule: "shapeshifter" };
  if (/ \(shapeshifter\)$/.test(s)) return { key: STRUCTURAL.shapeshifter, variant: "", rule: "shapeshifter" };
  if (/ the pandemonium lord$/.test(s)) return { key: STRUCTURAL.panLord, variant: "", rule: "pan-lord" };
  if (/ \(illusionary\)$/.test(s)) {
    parts.form = "illusion";
    s = s.replace(/ \(illusionary\)$/, "");
  }
  // "<form> shaped shifter" → shapeshifter (go-sequell's "the .* shaped (.*)" rule, inverted for current naming).
  if (/ shaped shifter$/.test(s)) return { key: STRUCTURAL.shapeshifter, variant: "", rule: "shapeshifter" };

  // Player ghosts and illusions: "Foo's ghost", "Xs' ghost".
  if (/'s? ghost$/.test(s)) return { key: STRUCTURAL.playerGhost, variant: variantKey(parts), rule: "player-ghost" };
  if (/'s? illusion$/.test(s)) return { key: STRUCTURAL.playerIllusion, variant: variantKey(parts), rule: "player-illusion" };

  const hit = resolveCore(idx, s, input.branch, parts);
  if (hit) return { key: hit.key, variant: variantKey(parts), rule: hit.rule };

  // A unique flag with an unknown name usually means the catalog is missing a monster (or is from the wrong version).
  return { key: `unresolved:${raw}`, variant: "", rule: input.killerFlags?.includes("unique") ? "unresolved-unique" : "unresolved" };
}
