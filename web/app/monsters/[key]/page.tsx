// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Glyph } from "@/components/Glyph";
import { MonsterView } from "@/components/MonsterView";
import { Summary } from "@/components/Summary";
import { VLink } from "@/components/VLink";
import { getMeta, monsterSummary } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(getMeta().monsters).map((key) => ({ key }));
}

type Params = Promise<{ key: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { key } = await params;
  return { title: getMeta().monsters[key]?.name ?? key, description: monsterSummary(key) ?? undefined };
}

export default async function MonsterPage({ params }: { params: Params }) {
  const { key } = await params;
  const meta = getMeta();
  const m = meta.monsters[key];
  if (!m) notFound();
  const ctx = { available: meta.series.map((s) => s.series), defaultSeries: meta.defaultSeries };
  return (
    <>
      <div className="crumbs">
        <VLink href="/monsters/">Monsters</VLink>
      </div>
      <h1>
        <Glyph glyph={m.glyph} />
        {m.name}
      </h1>
      <p className="sub">
        <code>{m.key}</code>
        {m.unique ? " · unique" : ""}
        {m.group ? ` · ${m.group}` : ""}
      </p>
      {/* TODO(web): stats block (HD, AC/EV, spells) from the catalog; that's GPL text if we copy crawl's descriptions. */}
      <Summary text={monsterSummary(key)} />
      <MonsterView monsterKey={key} ctx={ctx} />
    </>
  );
}
