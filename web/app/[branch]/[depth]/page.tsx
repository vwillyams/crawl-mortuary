// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FloorView } from "@/components/FloorView";
import { Summary } from "@/components/Summary";
import { VLink } from "@/components/VLink";
import { branchPlaces, getMeta, placeSummary } from "@/lib/data";

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
  return { title: `${branch}:${depth}`, description: placeSummary(`${branch}:${depth}`) ?? undefined };
}

export default async function FloorPage({ params }: { params: Params }) {
  const { branch, depth } = await params;
  const meta = getMeta();
  const b = meta.branches.find((x) => x.abbrev === branch);
  const place = `${branch}:${depth}`;
  if (!b || !meta.places.includes(place)) notFound();
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
      <Summary text={placeSummary(place)} />
      <FloorView place={place} ctx={ctx} />
    </>
  );
}
