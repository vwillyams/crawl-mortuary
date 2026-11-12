// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BranchView } from "@/components/BranchView";
import { FloorView } from "@/components/FloorView";
import { Summary } from "@/components/Summary";
import { VLink } from "@/components/VLink";
import { branchPlaces, getMeta, placeSummary } from "@/lib/data";

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
        <>
          <Summary text={placeSummary(places[0]!)} />
          <FloorView place={places[0]!} ctx={ctx} />
        </>
      ) : (
        <BranchView abbrev={b.abbrev} places={places} ctx={ctx} />
      )}
    </>
  );
}
