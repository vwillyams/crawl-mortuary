// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Catalog, KillerKey, MonsterInfo, PlaceKey } from "@mortuary/contract";
import { parsePlace } from "@mortuary/contract";

export type KillerClass = "native" | "ood" | "unexpected" | "cause" | "unresolved";

export class Classifier {
  private readonly monsters = new Map<string, MonsterInfo>();

  constructor(catalog: Catalog) {
    for (const m of catalog.monsters) this.monsters.set(m.key, m);
  }

  monster(key: string): MonsterInfo | undefined {
    return this.monsters.get(key);
  }

  /**
   * Classify a killer at a place using the catalog's spawn tables (branch-relative depths).
   * `generatedHere` is true when levelgen saw this monster at this place, which covers vault-placed monsters
   * and uniques that aren't in the population tables.
   */
  classify(key: KillerKey, place: PlaceKey, generatedHere: boolean): KillerClass {
    if (key.startsWith("@")) return "cause";
    if (key.startsWith("unresolved:")) return "unresolved";
    const m = this.monsters.get(key);
    const { branch, depth } = parsePlace(place);
    const d = depth ?? 1;
    if (m) {
      const entries = m.spawns.filter((s) => s.branch === branch);
      if (entries.some((s) => d >= s.minDepth && d <= s.maxDepth)) return "native";
      if (generatedHere) return "native";
      if (entries.some((s) => d < s.minDepth)) return "ood";
      return "unexpected";
    }
    // TODO(aggregate): a resolved key missing from the catalog means the catalog and resolver disagree. Surface it in an audit report.
    return generatedHere ? "native" : "unexpected";
    // TODO(aggregate): split "summon" out of "unexpected" once an adapter records ikiller (plan D5).
  }
}
