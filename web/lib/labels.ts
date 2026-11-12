// SPDX-License-Identifier: AGPL-3.0-or-later
import type { KillerClass, MonsterMeta, ReachedGrade } from "./shards";

export function killerLabel(key: string, monsters: Record<string, MonsterMeta>, causes: Record<string, string>): string {
  if (monsters[key]) return monsters[key]!.name;
  if (key.startsWith("@")) return causes[key] ?? key.slice(1).replace(/_/g, " ");
  if (key.startsWith("unresolved:")) return `“${key.slice("unresolved:".length)}”`;
  return key.replace(/_/g, " ");
}

/** "heads=7" → "7 heads"; "colour=red" → "red"; "base=orc" → "orc"; "a=b;c=d" → "b, d". */
export function variantLabel(variant: string): string {
  if (!variant) return "";
  return variant
    .split(";")
    .map((kv) => {
      const [k, v = ""] = kv.split("=");
      const val = v.replace(/_/g, " ");
      if (k === "heads") return `${val} heads`;
      return val;
    })
    .join(", ");
}

export const CLASS_LABEL: Record<KillerClass, string> = {
  native: "native",
  ood: "out of depth",
  unexpected: "not generated here",
  cause: "non-monster",
  unresolved: "unresolved",
};

export const CLASS_HELP: Record<KillerClass, string> = {
  native: "In this branch's spawn tables at this depth.",
  ood: "In this branch's spawn tables, but deeper than this floor (out of depth).",
  unexpected:
    "Never generated on this floor: summons, followers from other floors, polymorphs, vault-only monsters, etc. It has no per-encounter figure.",
  cause: "Not a monster: poison, starvation, Zot, traps, quitting…",
  unresolved: "The killer string could not be matched to a monster yet.",
};

export function reachedHelp(grade: ReachedGrade, notes: string[]): string {
  const base =
    grade === "lowerBound"
      ? "STRICT LOWER BOUND. Only characters who died on this floor or deeper in the same branch are counted. Most visitors leave this branch alive and leave no record here, so the true count is higher and the rates that use it are overestimates."
      : "Estimated, not observed. We only have records of where characters died, so a death deeper in the dungeon is taken to mean the character passed through this floor (with fractional credit where the route is uncertain). Accurate enough on the main route.";
  return notes.length ? `${base}\n\n${notes.join("\n")}` : base;
}
