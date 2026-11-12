// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import { Suspense, useMemo } from "react";
import { metrics, fmtInt, fmtNum, fmtPct, oneIn } from "@/lib/metrics";
import { combineMonster, selectionLabel, type CombinedMonsterPlace, type Selection } from "@/lib/select";
import { CLASS_HELP, CLASS_LABEL, variantLabel } from "@/lib/labels";
import type { MonsterShard } from "@/lib/shards";
import { Asterisk } from "./FloorView";
import { VLink } from "./VLink";
import { defaultSeries, useSeries, type SeriesContext } from "./useSeries";

export interface MonsterViewProps {
  shard: MonsterShard;
  /** Navigation order of places, so rows read top-to-bottom through the dungeon. */
  placeOrder: string[];
  ctx: SeriesContext;
}

function placeHref(place: string): string {
  const [b, d] = place.split(":");
  return d ? `/${b}/${d}/` : `/${b}/`;
}

function MonsterTable({ shard, placeOrder, selection, series }: MonsterViewProps & { selection: Selection; series: string[] }) {
  const rows = useMemo(() => {
    const combined = combineMonster(shard, series);
    // Sum variants per place for the main table.
    const byPlace = new Map<string, CombinedMonsterPlace & { variants: CombinedMonsterPlace[] }>();
    for (const r of combined) {
      const e = byPlace.get(r.place);
      if (!e) byPlace.set(r.place, { ...r, variant: "", variants: [r] });
      else {
        e.deaths += r.deaths;
        if (r.exposure !== undefined) {
          e.exposure = (e.exposure ?? 0) + r.exposure;
          e.presentExposure = (e.presentExposure ?? 0) + (r.presentExposure ?? 0);
          e.exposureReached = Math.max(e.exposureReached, r.exposureReached);
        }
        e.variants.push(r);
      }
    }
    const idx = (p: string) => {
      const i = placeOrder.indexOf(p);
      return i < 0 ? 1e9 : i;
    };
    return [...byPlace.values()].sort((a, b) => idx(a.place) - idx(b.place));
  }, [shard, series, placeOrder]);

  const total = rows.reduce((s, r) => s + r.deaths, 0);
  if (rows.length === 0) return <p className="muted">No data for {selectionLabel(selection)}.</p>;

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="k">deaths caused</div>
          <div className="v">{fmtInt(total)}</div>
        </div>
        <div className="stat">
          <div className="k">versions</div>
          <div className="v">{selectionLabel(selection)}</div>
        </div>
      </div>
      {/* TODO(web): a small chart of deaths / 1,000 reaching by depth; hydra heads at generation vs at death (01 §6). */}
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>floor</th>
              <th>deaths</th>
              <th>share of floor deaths</th>
              <th>expected per visit</th>
              <th>deaths / 1,000 reaching</th>
              <th>deaths per generated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const m = metrics({ ...r, exposureReached: r.exposureReached || r.reached });
              return (
                <tr key={r.place} className={m.lowData ? "low" : ""}>
                  <td className="name">
                    <VLink href={placeHref(r.place)}>{r.place}</VLink>
                    {r.class !== "native" && (
                      <span className={`badge ${r.class}`} title={CLASS_HELP[r.class]}>
                        {CLASS_LABEL[r.class]}
                      </span>
                    )}
                    {r.variants.length > 1 || r.variants[0]!.variant ? (
                      <span className="ci">
                        {r.variants
                          .filter((v) => v.deaths > 0)
                          .map((v) => `${variantLabel(v.variant) || "plain"}: ${v.deaths}`)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td>{fmtInt(r.deaths)}</td>
                  <td>{fmtPct(m.share?.estimate)}</td>
                  <td>
                    {fmtNum(m.expected)}
                    {m.pAny != null && <span className="ci">P(any) {fmtPct(m.pAny, 0)}</span>}
                  </td>
                  <td>
                    {m.per1000 ? fmtNum(m.per1000.estimate, 1) : "—"}
                    <Asterisk grade={r.reachedGrade} notes={[]} />
                  </td>
                  <td>{oneIn(m.perGenerated)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function WithParams(props: MonsterViewProps) {
  const s = useSeries(props.ctx);
  return <MonsterTable {...props} {...s} />;
}

export function MonsterView(props: MonsterViewProps) {
  return (
    <Suspense fallback={<MonsterTable {...props} {...defaultSeries(props.ctx)} />}>
      <WithParams {...props} />
    </Suspense>
  );
}
