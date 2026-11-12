// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Join games + levelgen + catalog into the additive AggregateFile (contract: aggregate.ts).
 *
 * Usage: create one Aggregator, call addGame() for every GameRow (streaming), then finish().
 */
import type {
  AggregateFile,
  Catalog,
  GameRow,
  KillerRow,
  LevelgenAggregate,
  PlaceKey,
  PlaceRow,
  SeriesInfo,
  SeriesKey,
} from "@mortuary/contract";
import { isPrerelease, parsePlace } from "@mortuary/contract";
import { Classifier } from "./classify.ts";
import { DEFAULT_CAUSE_LABELS, type ReachedConfig } from "./config.ts";
import { BranchTree, ReachedEstimator } from "./reached.ts";

export interface SeriesInputs {
  series: SeriesKey;
  catalog: Catalog;
  levelgen?: LevelgenAggregate;
}

export interface AggregateOptions {
  includeBots: boolean;
  includePrerelease: boolean;
  config: ReachedConfig;
}

interface SeriesState {
  inputs: SeriesInputs;
  estimator: ReachedEstimator;
  classifier: Classifier;
  reached: Map<PlaceKey, number>;
  deathsTotal: Map<PlaceKey, number>;
  /** place → "key\u0000variant" → deaths */
  deaths: Map<PlaceKey, Map<string, number>>;
  releases: Set<string>;
  games: number;
  wins: number;
  first?: string;
  last?: string;
}

export interface AggregateStats {
  seen: number;
  skippedBots: number;
  skippedPrerelease: number;
  skippedNoSeries: number;
  nonDeaths: number;
  unknownBranches: Record<string, number>;
}

const round = (x: number, dp = 3) => Math.round(x * 10 ** dp) / 10 ** dp;

export class Aggregator {
  private readonly state = new Map<SeriesKey, SeriesState>();
  readonly stats: AggregateStats = {
    seen: 0,
    skippedBots: 0,
    skippedPrerelease: 0,
    skippedNoSeries: 0,
    nonDeaths: 0,
    unknownBranches: {},
  };

  constructor(
    inputs: SeriesInputs[],
    private readonly opts: AggregateOptions,
  ) {
    for (const inp of inputs) {
      const tree = BranchTree.fromCatalog(inp.catalog);
      const config = withPresence(opts.config, inp.levelgen);
      this.state.set(inp.series, {
        inputs: inp,
        estimator: new ReachedEstimator(tree, config),
        classifier: new Classifier(inp.catalog),
        reached: new Map(),
        deathsTotal: new Map(),
        deaths: new Map(),
        releases: new Set(),
        games: 0,
        wins: 0,
      });
    }
  }

  addGame(g: GameRow): void {
    this.stats.seen++;
    if (g.isBot && !this.opts.includeBots) return void this.stats.skippedBots++;
    if (isPrerelease(g.release) && !this.opts.includePrerelease) return void this.stats.skippedPrerelease++;
    const s = this.state.get(g.series);
    if (!s) return void this.stats.skippedNoSeries++;

    s.games++;
    s.releases.add(g.release);
    if (!s.first || g.endAt < s.first) s.first = g.endAt;
    if (!s.last || g.endAt > s.last) s.last = g.endAt;
    if (g.isWin) s.wins++;

    const nonDeath = g.isWin || (g.ktyp != null && this.opts.config.nonDeathKtyps.includes(g.ktyp));
    if (nonDeath && !g.isWin) {
      // e.g. "leaving": no reliable place information. Count the game, but credit nothing.
      this.stats.nonDeaths++;
      return;
    }

    for (const [place, p] of s.estimator.credit({ endPlace: g.endPlace, isWin: g.isWin, uniqueRunes: g.uniqueRunes })) {
      s.reached.set(place, (s.reached.get(place) ?? 0) + p);
    }
    if (g.isWin) return;

    const key = g.killer ?? `unresolved:${g.killerRaw ?? g.ktyp ?? "unknown"}`;
    const k = `${key}\u0000${g.killerVariant}`;
    s.deathsTotal.set(g.endPlace, (s.deathsTotal.get(g.endPlace) ?? 0) + 1);
    let byKiller = s.deaths.get(g.endPlace);
    if (!byKiller) s.deaths.set(g.endPlace, (byKiller = new Map()));
    byKiller.set(k, (byKiller.get(k) ?? 0) + 1);
  }

  finish(now = new Date()): AggregateFile {
    const series: SeriesInfo[] = [];
    const places: PlaceRow[] = [];
    const killers: KillerRow[] = [];
    const causes: Record<string, string> = { ...DEFAULT_CAUSE_LABELS };

    for (const [key, s] of this.state) {
      for (const [b, n] of s.estimator.unknownBranches) {
        this.stats.unknownBranches[b] = (this.stats.unknownBranches[b] ?? 0) + n;
      }
      const lg = s.inputs.levelgen;
      const lgPlaces = new Map((lg?.places ?? []).map((p) => [p.place, p]));
      const lgMonsters = new Map<PlaceKey, Map<string, NonNullable<typeof lg>["monsters"][number]>>();
      for (const m of lg?.monsters ?? []) {
        if (m.sum <= 0) continue;
        let mm = lgMonsters.get(m.place);
        if (!mm) lgMonsters.set(m.place, (mm = new Map()));
        mm.set(`${m.key}\u0000${m.variant}`, m);
      }

      const allPlaces = new Set<PlaceKey>([...s.reached.keys(), ...s.deathsTotal.keys(), ...lgPlaces.keys()]);
      const order = placeOrder(s.estimator.tree.order);
      for (const place of [...allPlaces].sort(order)) {
        const reached = s.reached.get(place) ?? 0;
        places.push({
          series: key,
          place,
          reached: round(reached),
          reachedMethod: "implied",
          reachedGrade: s.estimator.grade(place),
          reachedNote: s.estimator.explain(place),
          deathsTotal: s.deathsTotal.get(place) ?? 0,
        });

        const lp = lgPlaces.get(place);
        const gen = lgMonsters.get(place) ?? new Map();
        const deaths = s.deaths.get(place) ?? new Map<string, number>();
        const rowKeys = new Set<string>([...deaths.keys(), ...gen.keys()]);
        const rows: KillerRow[] = [];
        for (const rk of rowKeys) {
          const [kkey, variant] = rk.split("\u0000") as [string, string];
          const g = gen.get(rk);
          const row: KillerRow = {
            series: key,
            place,
            key: kkey,
            variant,
            class: s.classifier.classify(kkey, place, !!g),
            deaths: deaths.get(rk) ?? 0,
          };
          if (g && lp && lp.instances > 0) {
            row.exposure = round(reached * (g.sum / lp.instances));
            row.presentExposure = round(reached * (g.present / lp.instances));
            row.firewood = g.firewood;
            row.hostileFraction = round(g.sum > 0 ? g.hostileSum / g.sum : 0);
          }
          if (kkey.startsWith("@") && !causes[kkey]) causes[kkey] = kkey.slice(1).replace(/_/g, " ");
          rows.push(row);
        }
        rows.sort((a, b) => b.deaths - a.deaths || (b.exposure ?? 0) - (a.exposure ?? 0) || a.key.localeCompare(b.key));
        killers.push(...rows);
      }

      series.push({
        series: key,
        releases: [...s.releases].sort(),
        catalogRelease: s.inputs.catalog.release,
        games: s.games,
        wins: s.wins,
        firstGame: s.first ?? "",
        lastGame: s.last ?? "",
      });
    }

    const params = this.opts.config.params;
    return {
      schemaVersion: 1,
      generatedAt: now.toISOString(),
      series,
      places,
      killers,
      causes,
      reachedParams: { ...params, rules: this.opts.config.rules.map((r) => r.id) },
    };
  }
}

/** Fill branchPresence from levelgen (instances/seeds of <branch>:1) unless the config already sets it. */
function withPresence(config: ReachedConfig, lg?: LevelgenAggregate): ReachedConfig {
  if (!lg || Object.keys(config.params.branchPresence).length) return config;
  const presence: Record<string, number> = {};
  for (const p of lg.places) {
    const { branch, depth } = parsePlace(p.place);
    if ((depth ?? 1) === 1 && p.seeds > 0) presence[branch] = p.instances / p.seeds;
  }
  return { ...config, params: { ...config.params, branchPresence: presence } };
}

function placeOrder(branchOrder: string[]) {
  const idx = new Map(branchOrder.map((b, i) => [b, i]));
  return (a: PlaceKey, b: PlaceKey) => {
    const pa = parsePlace(a);
    const pb = parsePlace(b);
    const ia = idx.get(pa.branch) ?? 1e6;
    const ib = idx.get(pb.branch) ?? 1e6;
    return ia - ib || pa.branch.localeCompare(pb.branch) || (pa.depth ?? 0) - (pb.depth ?? 0);
  };
}
