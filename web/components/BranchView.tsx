// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import { Suspense, useMemo } from "react";
import { fmtInt, fmtNum, fmtPct } from "@/lib/metrics";
import { combinePlace, type Selection } from "@/lib/select";
import { killerLabel } from "@/lib/labels";
import { placeFile, type Meta, type MonsterMeta, type PlaceShard } from "@/lib/shards";
import { Asterisk } from "./FloorView";
import { LoadState } from "./LoadState";
import { useDataMany } from "./useData";
import { VLink } from "./VLink";
import { defaultSeries, useSeries, type SeriesContext } from "./useSeries";

export interface BranchViewProps {
  abbrev: string;
  /** The branch's places in floor order; their shards are fetched client-side. */
  places: string[];
  ctx: SeriesContext;
}

interface BranchTableProps {
  abbrev: string;
  shards: PlaceShard[];
  monsters: Record<string, MonsterMeta>;
  causes: Record<string, string>;
}

function BranchTable({ abbrev, shards, monsters, causes, series }: BranchTableProps & { selection: Selection; series: string[] }) {
  const rows = useMemo(
    () =>
      shards.map((s) => {
        const c = combinePlace(s, series);
        const top = c ? [...c.killers].sort((a, b) => b.deaths - a.deaths)[0] : undefined;
        return { place: s.place, c, top };
      }),
    [shards, series],
  );
  // TODO(web): branch-cumulative lethality, P(die to X anywhere in branch | entered), per 04 §3.3.
  return (
    <div className="tablewrap">
      <table className="data">
        <thead>
          <tr>
            <th>floor</th>
            <th>deaths</th>
            <th>reaching</th>
            <th>deaths / 1,000 reaching</th>
            <th>top killer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ place, c, top }) => (
            <tr key={place}>
              <td>
                <VLink href={`/${abbrev}/${place.split(":")[1]}/`}>{place}</VLink>
              </td>
              <td>{c ? fmtInt(c.deathsTotal) : "—"}</td>
              <td>
                {c ? fmtInt(c.reached) : "—"}
                {c && <Asterisk grade={c.reachedGrade} notes={c.reachedNotes} />}
              </td>
              <td>{c && c.reached > 0 ? fmtNum((1000 * c.deathsTotal) / c.reached, 1) : "—"}</td>
              <td>
                {top && top.deaths > 0
                  ? `${killerLabel(top.key, monsters, causes)} (${fmtPct(c!.deathsTotal ? top.deaths / c!.deathsTotal : null, 0)})`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Sel = { selection: Selection; series: string[] };

function BranchLoader({ abbrev, places, selection, series }: Omit<BranchViewProps, "ctx"> & Sel) {
  // TODO(web): a per-branch summary file would save fetching every floor's full shard here.
  const l = useDataMany<PlaceShard | Meta>(["meta.json", ...places.map((p) => `place/${placeFile(p)}.json`)]);
  if (l.state !== "ok") return <LoadState of={[l]} />;
  const [meta, ...shards] = l.data as [Meta, ...PlaceShard[]];
  return <BranchTable abbrev={abbrev} shards={shards} monsters={meta.monsters} causes={meta.causes} selection={selection} series={series} />;
}

function WithParams(props: BranchViewProps) {
  return <BranchLoader abbrev={props.abbrev} places={props.places} {...useSeries(props.ctx)} />;
}

export function BranchView(props: BranchViewProps) {
  return (
    <Suspense fallback={<BranchLoader abbrev={props.abbrev} places={props.places} {...defaultSeries(props.ctx)} />}>
      <WithParams {...props} />
    </Suspense>
  );
}
