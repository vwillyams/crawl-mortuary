// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import { Suspense, useMemo, useState } from "react";
import { fmtInt } from "@/lib/metrics";
import type { Meta, MonsterMeta } from "@/lib/shards";
import { Glyph } from "./Glyph";
import { LoadState } from "./LoadState";
import { useData } from "./useData";
import { VLink } from "./VLink";
import { defaultSeries, useSeries, type SeriesContext } from "./useSeries";

interface Props {
  ctx: SeriesContext;
}

function Index({ monsters, series }: { monsters: MonsterMeta[]; series: string[] }) {
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

function IndexLoader({ series }: { series: string[] }) {
  const l = useData<Meta>("meta.json");
  const monsters = useMemo(() => (l.state === "ok" ? Object.values(l.data.monsters) : []), [l]);
  if (l.state !== "ok") return <LoadState of={[l]} />;
  return <Index monsters={monsters} series={series} />;
}

function WithParams(props: Props) {
  return <IndexLoader series={useSeries(props.ctx).series} />;
}

export function MonsterIndex(props: Props) {
  return (
    <Suspense fallback={<IndexLoader series={defaultSeries(props.ctx).series} />}>
      <WithParams {...props} />
    </Suspense>
  );
}
