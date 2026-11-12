// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash } from "node:crypto";
import { type Catalog, GameRow, isPrerelease, placeKey, seriesOf } from "@mortuary/contract";
import { isBot } from "./bots.ts";
import { inferKtypFromMessage } from "./killer/causes.ts";
import { CatalogIndex, resolveKiller } from "./killer/resolve.ts";
import type { RawGame } from "./types.ts";

/**
 * Single-floor places whose PlaceKey has no ":n". The catalog's branch table (depth === 1) is
 * authoritative. This list is only a fallback for branches missing from the catalog (fixtures, old versions).
 */
const SINGLE_FLOOR_FALLBACK = new Set([
  "Temple", "Bazaar", "Trove", "Sewer", "Ossuary", "Bailey", "IceCv", "Volcano", "WizLab",
  "Desolation", "Hell", "Pan", "Gauntlet", "Arena", "Lab", "Necropolis", "Crucible",
]);

export interface NormalizeOptions {
  catalog: Catalog;
  /** Keep only this series (e.g. "0.34"). */
  series?: string;
  /** Plan §5: prerelease builds (trunk, alpha/beta) are excluded from series buckets unless this is set. */
  includePrerelease?: boolean;
}

export type NormalizeResult =
  | { ok: true; row: GameRow; rule: string }
  | { ok: false; reason: "series" | "prerelease" | "invalid"; detail?: string };

/** Stable game id shared across adapters: sha1(server|lowercased name|start ISO). */
export function gameId(server: string, player: string, startIso: string): string {
  return createHash("sha1").update(`${server}|${player.toLowerCase()}|${startIso}`).digest("hex");
}

export class Normalizer {
  private readonly idx: CatalogIndex;
  private readonly singleFloor: Set<string>;

  constructor(private readonly opts: NormalizeOptions) {
    this.idx = new CatalogIndex(opts.catalog);
    this.singleFloor = new Set(SINGLE_FLOOR_FALLBACK);
    for (const b of opts.catalog.branches) {
      if (b.depth === 1) this.singleFloor.add(b.abbrev);
      else this.singleFloor.delete(b.abbrev);
    }
  }

  get index(): CatalogIndex {
    return this.idx;
  }

  normalize(g: RawGame): NormalizeResult {
    let series: string;
    try {
      series = seriesOf(g.version);
    } catch {
      return { ok: false, reason: "invalid", detail: `version ${g.version}` };
    }
    if (this.opts.series && series !== this.opts.series) return { ok: false, reason: "series" };
    if (!this.opts.includePrerelease && isPrerelease(g.version)) return { ok: false, reason: "prerelease" };

    const ktyp = g.ktyp ?? (g.isWin ? "winning" : inferKtypFromMessage(g.endMessage));
    const res = resolveKiller(this.idx, {
      killer: g.killer,
      ktyp,
      killerFlags: g.killerFlags,
      branch: g.branch,
    });

    const candidate = {
      gameId: gameId(g.server, g.player, g.startAt),
      source: g.source,
      server: g.server,
      player: g.player,
      isBot: isBot(g.player, g.isBotHint),
      release: g.version,
      series,
      isWin: g.isWin,
      xl: g.xl,
      race: g.race,
      cls: g.cls,
      god: g.god || null,
      turns: g.turns,
      runes: g.runes,
      uniqueRunes: g.uniqueRunes,
      startAt: g.startAt,
      endAt: g.endAt,
      endPlace: placeKey(g.branch, this.singleFloor.has(g.branch) ? null : g.lvl),
      ktyp,
      killerRaw: g.killer || null,
      killer: g.isWin ? null : res.key,
      killerVariant: g.isWin ? "" : res.variant,
      endMessage: g.endMessage,
      ...(g.ikiller !== undefined && { ikiller: g.ikiller }),
      ...(g.killermap !== undefined && { killermap: g.killermap }),
      ...(g.kaux !== undefined && { kaux: g.kaux }),
      ...(g.seed !== undefined && { seed: g.seed }),
    };
    const parsed = GameRow.safeParse(candidate);
    if (!parsed.success) return { ok: false, reason: "invalid", detail: parsed.error.message };
    return { ok: true, row: parsed.data, rule: res.rule };
  }
}
