// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import { getMeta, getReachedParams } from "@/lib/data";
import { reachedHelp } from "@/lib/labels";

export const metadata: Metadata = { title: "Methodology" };

export default function About() {
  const meta = getMeta();
  const params = getReachedParams();
  return (
    <>
      <h1>Methodology</h1>
      <h2>Data</h2>
      <ul>
        <li>
          <strong>Deaths:</strong> where each character died and what killed them, from public DCSS server game records (
          <code>{meta.dataSource.aggregate}</code>).
        </li>
        <li>
          <strong>Expected encounters:</strong> monsters generated per floor visit, sampled by running crawl&apos;s real level generator
          over many seeds (catalogs: {Object.entries(meta.dataSource.catalogs).map(([s, f]) => `${s} ← ${f}`).join(", ")}).
        </li>
        <li>
          Versions: {meta.series.map((s) => `${s.series} (${s.releases.join(", ")}; ${s.games.toLocaleString("en-US")} games)`).join("; ")}.
          Data generated {meta.generatedAt}.
        </li>
      </ul>
      <h2>Columns</h2>
      <ul>
        <li>
          <strong>Share of deaths</strong>: the fraction of all deaths on this floor caused by this killer. This is the primary metric and
          doesn&apos;t depend on any estimate of how many characters reached the floor.
        </li>
        <li>
          <strong>Expected per visit</strong>: the mean number generated on the floor, plus P(any), the chance at least one is generated.
        </li>
        <li>
          <strong>Deaths / 1,000 reaching</strong>
          <span className="ast">*</span>: deaths divided by the estimated number of characters who reached the floor.
        </li>
        <li>
          <strong>Deaths per generated</strong>
          <span className="ast">*</span>: deaths ÷ (reached × expected per visit). This is a lower bound on per-encounter danger, since
          not every generated monster is met.
        </li>
      </ul>
      <h2>
        How “reached” is estimated <span className="ast">*</span>
      </h2>
      <p style={{ whiteSpace: "pre-line" }}>{reachedHelp("main", [])}</p>
      <p style={{ whiteSpace: "pre-line" }}>
        <span className="ast loud">≥*</span> {reachedHelp("lowerBound", [])}
      </p>
      {params && (
        <>
          <p>Tunable parameters used for this build:</p>
          <pre className="notice mono" style={{ overflowX: "auto" }}>
            {JSON.stringify(params, null, 2)}
          </pre>
        </>
      )}
      <h2>Statistics</h2>
      <p>
        Ranges are 95% Jeffreys intervals. Rows with fewer than 3 deaths are faded. Version ranges (<code>?v=0.30..0.34</code>,{" "}
        <code>?v=all</code>) sum the underlying counts before the ratios are computed, so composites are weighted by games played.
      </p>
      {/* TODO(web): credits (dcss-stats, Sequell/go-sequell, crawl tiles CC0), and a link to the source repo. */}
    </>
  );
}
