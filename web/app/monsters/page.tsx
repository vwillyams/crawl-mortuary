// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { MonsterIndex } from "@/components/MonsterIndex";
import { getMeta } from "@/lib/data";

export const metadata: Metadata = { title: "Monsters" };

export default function MonstersPage() {
  const meta = getMeta();
  const ctx = { available: meta.series.map((s) => s.series), defaultSeries: meta.defaultSeries };
  return (
    <>
      <h1>Monsters</h1>
      <p className="sub">Sorted by characters killed in the selected versions.</p>
      <MonsterIndex monsters={Object.values(meta.monsters)} ctx={ctx} />
    </>
  );
}
