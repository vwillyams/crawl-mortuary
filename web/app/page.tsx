// SPDX-License-Identifier: AGPL-3.0-or-later
import { VLink } from "@/components/VLink";
import { branchPlaces, getMeta, getPlace } from "@/lib/data";
import { fmtInt } from "@/lib/metrics";
import type { BranchMeta, Meta } from "@/lib/shards";

/** Floor chip shading by mortality (deaths / reached) in the default series. */
function mortality(meta: Meta, place: string): number | null {
  const p = getPlace(place).bySeries[meta.defaultSeries];
  return p && p.reached > 0 ? p.deathsTotal / p.reached : null;
}

function BranchNode({ b, meta, children }: { b: BranchMeta; meta: Meta; children: BranchMeta[] }) {
  const places = branchPlaces(meta, b.abbrev);
  const entry =
    b.parent && b.entryMin != null
      ? ` · entry ${b.parent}:${b.entryMin}${b.entryMax != null && b.entryMax !== b.entryMin ? `–${b.entryMax}` : ""}`
      : "";
  const kids = meta.branches.filter((c) => c.parent === b.abbrev);
  // TODO(web): recolour the chips client-side for the selected ?v= (currently uses the default series).
  return (
    <li>
      <VLink href={`/${b.abbrev}/`} className="branch-name">
        {b.name}
      </VLink>
      <span className="kind">
        {b.abbrev}
        {entry}
        {b.kind !== "main" ? ` · ${b.kind}` : ""}
      </span>
      {places.length > 1 && (
        <span className="floors">
          {places.map((p) => {
            const m = mortality(meta, p);
            const depth = p.split(":")[1];
            const alpha = m == null ? 0 : Math.min(0.85, 0.08 + m * 4);
            return (
              <VLink
                key={p}
                href={`/${b.abbrev}/${depth}/`}
                className="floor"
                title={m == null ? `${p}: no data` : `${p}: ${(m * 100).toFixed(1)}% of arrivals die here (estimate)`}
                style={{ background: `rgba(201, 87, 63, ${alpha})` }}
              >
                {depth}
              </VLink>
            );
          })}
        </span>
      )}
      {kids.length > 0 && (
        <ul>
          {kids.map((c) => (
            <BranchNode key={c.abbrev} b={c} meta={meta} children={[]} />
          ))}
        </ul>
      )}
      {children.length > 0 && null}
    </li>
  );
}

export default function Home() {
  const meta = getMeta();
  const roots = meta.branches.filter((b) => !b.parent || !meta.branches.some((p) => p.abbrev === b.parent));
  const s = meta.series[0]!;
  return (
    <>
      <h1>The Dungeon</h1>
      <p className="sub">
        Where do characters die, and what kills them? {fmtInt(s.games)} games in {s.series} ({s.releases.join(", ")}). Pick a floor.
      </p>
      <ul className="tree">
        {roots.map((b) => (
          <BranchNode key={b.abbrev} b={b} meta={meta} children={[]} />
        ))}
      </ul>
      {/* TODO(web): headline "deadliest monsters overall" and a graphical dungeon map. */}
    </>
  );
}
