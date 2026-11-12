// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FloorView } from "@/components/FloorView";
import { VLink } from "@/components/VLink";
import { branchPlaces, getMeta, getPlace, monstersFor } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  const meta = getMeta();
  return meta.branches
    .filter((b) => branchPlaces(meta, b.abbrev).length > 1)
    .flatMap((b) => branchPlaces(meta, b.abbrev).map((p) => ({ branch: b.abbrev, depth: p.split(":")[1]! })));
}

type Params = Promise<{ branch: string; depth: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { branch, depth } = await params;
  return { title: `${branch}:${depth}` };
}

export default async function FloorPage({ params }: { params: Params }) {
  const { branch, depth } = await params;
  const meta = getMeta();
  const b = meta.branches.find((x) => x.abbrev === branch);
  const place = `${branch}:${depth}`;
  if (!b || !meta.places.includes(place)) notFound();
  const shard = getPlace(place);
  const keys = new Set(Object.values(shard.bySeries).flatMap((v) => v.killers.map((k) => k.key)));
  const ctx = { available: meta.series.map((s) => s.series), defaultSeries: meta.defaultSeries };
  const d = Number(depth);
  const prev = d > 1 ? `/${branch}/${d - 1}/` : null;
  const next = meta.places.includes(`${branch}:${d + 1}`) ? `/${branch}/${d + 1}/` : null;

  return (
    <>
      <div className="crumbs">
        <VLink href="/">Map</VLink> › <VLink href={`/${branch}/`}>{b.name}</VLink>
      </div>
      <h1>
        {b.name}:{depth}
      </h1>
      <p className="sub">
        {prev && <VLink href={prev}>← {branch}:{d - 1}</VLink>} {next && <VLink href={next}>{branch}:{d + 1} →</VLink>}
      </p>
      <FloorView shard={shard} monsters={monstersFor(meta, keys)} causes={meta.causes} ctx={ctx} />
    </>
  );
}
