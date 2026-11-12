// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import { Fragment, Suspense, useMemo, useState } from "react";
import { metrics, fmtInt, fmtNum, fmtPct, oneIn, type Metrics } from "@/lib/metrics";
import { combinePlace, selectionLabel, type CombinedKiller, type Selection } from "@/lib/select";
import { CLASS_HELP, CLASS_LABEL, killerLabel, reachedHelp, variantLabel } from "@/lib/labels";
import type { MonsterMeta, PlaceShard, ReachedGrade } from "@/lib/shards";
import { Glyph } from "./Glyph";
import { VLink } from "./VLink";
import { defaultSeries, useSeries, type SeriesContext } from "./useSeries";

export interface FloorViewProps {
  shard: PlaceShard;
  monsters: Record<string, MonsterMeta>;
  causes: Record<string, string>;
  ctx: SeriesContext;
}

type SortKey = "share" | "expected" | "per1000" | "perGenerated" | "deaths";

interface Row {
  id: string;
  key: string;
  variant: string;
  label: string;
  cls: CombinedKiller["class"];
  firewood: boolean;
  deaths: number;
  m: Metrics;
  children: Row[];
}

function sumRows(rows: CombinedKiller[]): Omit<CombinedKiller, "variant"> {
  const first = rows[0]!;
  const out = { key: first.key, class: first.class, deaths: 0, exposureReached: 0, firewood: false } as Omit<CombinedKiller, "variant">;
  for (const r of rows) {
    out.deaths += r.deaths;
    if (r.exposure !== undefined) {
      out.exposure = (out.exposure ?? 0) + r.exposure;
      out.presentExposure = (out.presentExposure ?? 0) + (r.presentExposure ?? 0);
    }
    // Variants of one monster share the same reached denominator, so take the max, not the sum.
    out.exposureReached = Math.max(out.exposureReached, r.exposureReached);
    out.firewood ||= r.firewood;
  }
  // TODO(web): P(any) of a monster group isn't the sum of its variants' P(any); it's an upper bound. Needs levelgen to emit the group-level `present`.
  return out;
}

export function Asterisk({ grade, notes }: { grade: ReachedGrade; notes: string[] }) {
  return (
    <span className={grade === "lowerBound" ? "ast loud" : "ast"} title={reachedHelp(grade, notes)} tabIndex={0}>
      {grade === "lowerBound" ? "≥*" : "*"}
    </span>
  );
}

function Ci({ lo, hi, pct }: { lo: number; hi: number; pct?: boolean }) {
  return <span className="ci">{pct ? `${fmtPct(lo)}–${fmtPct(hi)}` : `${fmtNum(lo, 1)}–${fmtNum(hi, 1)}`}</span>;
}

function FloorTable({ shard, monsters, causes, selection, series }: FloorViewProps & { selection: Selection; series: string[] }) {
  const [sort, setSort] = useState<SortKey>("share");
  const [showFirewood, setShowFirewood] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const place = useMemo(() => combinePlace(shard, series), [shard, series]);

  const rows = useMemo<Row[]>(() => {
    if (!place) return [];
    const byKey = new Map<string, CombinedKiller[]>();
    for (const k of place.killers) byKey.set(k.key, [...(byKey.get(k.key) ?? []), k]);
    const mk = (k: Omit<CombinedKiller, "variant"> & { variant?: string }, id: string, children: Row[]): Row => ({
      id,
      key: k.key,
      variant: k.variant ?? "",
      label: killerLabel(k.key, monsters, causes),
      cls: k.class,
      firewood: k.firewood,
      deaths: k.deaths,
      m: metrics({
        deaths: k.deaths,
        deathsTotal: place.deathsTotal,
        reached: place.reached,
        exposure: k.exposure,
        presentExposure: k.presentExposure,
        exposureReached: k.exposureReached || place.reached,
      }),
      children,
    });
    const out: Row[] = [];
    for (const [key, vs] of byKey) {
      const children =
        vs.length > 1 || (vs.length === 1 && vs[0]!.variant !== "")
          ? vs.map((v) => mk(v, `${key}|${v.variant}`, []))
          : [];
      out.push(mk(sumRows(vs), key, children));
    }
    return out;
  }, [place, monsters, causes]);

  if (!place) {
    return <p className="muted">No data for this place in {selectionLabel(selection)}.</p>;
  }

  const val = (r: Row): number => {
    switch (sort) {
      case "share":
        return r.m.share?.estimate ?? -1;
      case "expected":
        return r.m.expected ?? -1;
      case "per1000":
        return r.m.per1000?.estimate ?? -1;
      case "perGenerated":
        return r.m.perGenerated ?? -1;
      case "deaths":
        return r.deaths;
    }
  };
  // TODO(web): rank with empirical-Bayes shrinkage instead of raw estimates (plan §4).
  const visible = rows.filter((r) => showFirewood || !r.firewood).sort((a, b) => val(b) - val(a) || b.deaths - a.deaths);
  const hiddenCount = rows.length - visible.length;
  const maxShare = Math.max(0.0001, ...visible.map((r) => r.m.share?.estimate ?? 0));
  const notes = place.reachedNotes;

  const Th = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className={`sortable ${sort === k ? "sorted" : ""}`} onClick={() => setSort(k)}>
      {children}
      {sort === k ? " ↓" : ""}
    </th>
  );

  const renderRow = (r: Row, child = false) => (
    <tr key={r.id} className={`${r.m.lowData ? "low" : ""} ${child ? "child" : ""}`}>
      <td className="name">
        {!child && r.children.length > 0 && (
          <button className="expander" onClick={() => setOpen((o) => ({ ...o, [r.id]: !o[r.id] }))} aria-label="toggle variants">
            {open[r.id] ? "▾" : "▸"}
          </button>
        )}
        {child ? (
          <span>{variantLabel(r.variant)}</span>
        ) : (
          <>
            <Glyph glyph={monsters[r.key]?.glyph ?? (r.key.startsWith("@") ? { char: "‡", colour: "lightgrey" } : undefined)} />
            {monsters[r.key] ? <VLink href={`/monsters/${r.key}/`}>{r.label}</VLink> : r.label}
            {r.cls !== "native" && (
              <span className={`badge ${r.cls}`} title={CLASS_HELP[r.cls]}>
                {CLASS_LABEL[r.cls]}
              </span>
            )}
            {r.firewood && <span className="badge">plant/neutral</span>}
          </>
        )}
      </td>
      <td>
        {!child && <span className="bar" style={{ width: `${Math.round(((r.m.share?.estimate ?? 0) / maxShare) * 60)}px` }} />}
        {fmtPct(r.m.share?.estimate)}
        {r.m.share && r.deaths > 0 && <Ci lo={r.m.share.lower} hi={r.m.share.upper} pct />}
      </td>
      <td>{fmtInt(r.deaths)}</td>
      <td>
        {fmtNum(r.m.expected)}
        {r.m.pAny != null && <span className="ci">P(any) {fmtPct(r.m.pAny, 0)}</span>}
      </td>
      <td>
        {r.m.per1000 ? fmtNum(r.m.per1000.estimate, 1) : "—"}
        {r.m.per1000 && r.deaths > 0 && <Ci lo={r.m.per1000.lower} hi={r.m.per1000.upper} />}
      </td>
      <td>{oneIn(r.m.perGenerated)}</td>
    </tr>
  );

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="k">deaths here</div>
          <div className="v">{fmtInt(place.deathsTotal)}</div>
        </div>
        <div className="stat">
          <div className="k">
            characters reaching
            <Asterisk grade={place.reachedGrade} notes={notes} />
          </div>
          <div className="v">{fmtInt(place.reached)}</div>
        </div>
        <div className="stat">
          <div className="k">
            floor mortality
            <Asterisk grade={place.reachedGrade} notes={notes} />
          </div>
          <div className="v">{place.reached > 0 ? fmtPct(place.deathsTotal / place.reached) : "—"}</div>
        </div>
        <div className="stat">
          <div className="k">versions</div>
          <div className="v">{selectionLabel(selection)}</div>
        </div>
      </div>

      {place.reachedGrade === "lowerBound" && (
        <div className="notice warn">
          <p>
            <strong>Lower-bound estimate.</strong> The “characters reaching” count here only includes characters who died on this
            floor or deeper in this branch. Columns marked <span className="ast loud">≥*</span> are overestimates. Share of deaths is unaffected.
          </p>
        </div>
      )}

      <p>
        <label className="toggle">
          <input type="checkbox" checked={showFirewood} onChange={(e) => setShowFirewood(e.target.checked)} />
          show plants & neutral monsters{hiddenCount > 0 ? ` (${hiddenCount} hidden)` : ""}
        </label>
        {/* TODO(web): category drill-downs (uniques group, OOD expanded by default, summons, "not generated here") per 01 §12. */}
      </p>

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>killer</th>
              <Th k="share">share of deaths</Th>
              <Th k="deaths">deaths</Th>
              <Th k="expected">expected per visit</Th>
              <Th k="per1000">
                deaths / 1,000 reaching
                <Asterisk grade={place.reachedGrade} notes={notes} />
              </Th>
              <Th k="perGenerated">
                deaths per generated
                <Asterisk grade={place.reachedGrade} notes={notes} />
              </Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <Fragment key={r.id}>
                {renderRow(r)}
                {open[r.id] && [...r.children].sort((a, b) => b.deaths - a.deaths).map((c) => renderRow(c, true))}
              </Fragment>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  No killers recorded.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 13 }}>
        Faded rows have fewer than 3 deaths. Ranges are 95% Jeffreys intervals. “Expected per visit” is the mean number generated on
        this floor by the real level generator. “Deaths per generated” is a lower bound on per-encounter danger, since not every
        generated monster is met. <span className="ast">*</span> {reachedHelp(place.reachedGrade, notes).split("\n")[0]}
      </p>
    </>
  );
}

function FloorWithParams(props: FloorViewProps) {
  const { selection, series } = useSeries(props.ctx);
  return <FloorTable {...props} selection={selection} series={series} />;
}

export function FloorView(props: FloorViewProps) {
  const d = defaultSeries(props.ctx);
  return (
    <Suspense fallback={<FloorTable {...props} selection={d.selection} series={d.series} />}>
      <FloorWithParams {...props} />
    </Suspense>
  );
}
