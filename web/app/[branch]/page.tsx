// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchView } from "@/components/BranchView";
import { FloorView } from "@/components/FloorView";
import { VLink } from "@/components/VLink";
import { branchPlaces, getMeta, getPlace, monstersFor } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return getMeta().branches.map((b) => ({ branch: b.abbrev }));
}

export async function generateMetadata({ params }: { params: Promise<{ branch: string }> }): Promise<Metadata> {
  const { branch } = await params;
  const b = getMeta().branches.find((x) => x.abbrev === branch);
  return { title: b?.name ?? branch };
}

export default async function BranchPage({ params }: { params: Promise<{ branch: string }> }) {
  const { branch } = await params;
  const meta = getMeta();
  const b = meta.branches.find((x) => x.abbrev === branch);
  if (!b) notFound();
  const ctx = { available: meta.series.map((s) => s.series), defaultSeries: meta.defaultSeries };
  const places = branchPlaces(meta, b.abbrev);
  const shards = places.map(getPlace);
  const keys = new Set(shards.flatMap((s) => Object.values(s.bySeries).flatMap((v) => v.killers.map((k) => k.key))));
  const parent = b.parent ? meta.branches.find((x) => x.abbrev === b.parent) : undefined;

  return (
    <>
      <div className="crumbs">
        <VLink href="/">Map</VLink>
        {parent && (
          <>
            {" › "}
            <VLink href={`/${parent.abbrev}/`}>{parent.name}</VLink>
          </>
        )}
      </div>
      <h1>{b.longName.replace(/^the /, "The ")}</h1>
      <p className="sub">
        {b.abbrev}
        {b.depth > 1 ? ` · ${b.depth} floors` : ""}
        {b.parent && b.entryMin != null ? ` · entrance on ${b.parent}:${b.entryMin}${b.entryMax !== b.entryMin ? `–${b.entryMax}` : ""}` : ""}
      </p>
      {places.length === 1 ? (
        <FloorView shard={shards[0]!} monsters={monstersFor(meta, keys)} causes={meta.causes} ctx={ctx} />
      ) : (
        <BranchView abbrev={b.abbrev} shards={shards} monsters={monstersFor(meta, keys)} causes={meta.causes} ctx={ctx} />
      )}
    </>
  );
}
