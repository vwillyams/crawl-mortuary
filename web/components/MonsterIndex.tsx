// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import { Suspense, useMemo, useState } from "react";
import { fmtInt } from "@/lib/metrics";
import type { MonsterMeta } from "@/lib/shards";
import { Glyph } from "./Glyph";
import { VLink } from "./VLink";
import { defaultSeries, useSeries, type SeriesContext } from "./useSeries";

interface Props {
  monsters: MonsterMeta[];
  ctx: SeriesContext;
}

function Index({ monsters, series }: Props & { series: string[] }) {
  const [q, setQ] = useState("");
  const rows = useMemo(
    () =>
      monsters
        .map((m) => ({ m, deaths: series.reduce((s, v) => s + (m.deaths[v] ?? 0), 0) }))
        .filter(({ m }) => !q || m.name.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => b.deaths - a.deaths || a.m.name.localeCompare(b.m.name)),
    [monsters, series, q],
  );
  return (
    <>
      <p>
        <input
          type="search"
          placeholder="filter monsters…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ font: "inherit", padding: "4px 8px", width: "min(320px, 100%)" }}
        />
      </p>
      <div className="monster-grid">
        {rows.map(({ m, deaths }) => (
          <div key={m.key}>
            <Glyph glyph={m.glyph} />
            <VLink href={`/monsters/${m.key}/`}>{m.name}</VLink> <span className="muted">{deaths > 0 ? fmtInt(deaths) : ""}</span>
          </div>
        ))}
      </div>
    </>
  );
}

function WithParams(props: Props) {
  const { series } = useSeries(props.ctx);
  return <Index {...props} series={series} />;
}

export function MonsterIndex(props: Props) {
  return (
    <Suspense fallback={<Index {...props} series={defaultSeries(props.ctx).series} />}>
      <WithParams {...props} />
    </Suspense>
  );
}
