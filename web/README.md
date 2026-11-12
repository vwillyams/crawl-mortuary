# web/

The static site: Next.js 16 App Router with `output: 'export'`. `pnpm build` writes plain files to
`out/`, which any static host can serve (Cloudflare Pages, Vercel, GitHub Pages, S3, …). There is no
server, no host-specific config and no image optimisation (plan D9).

```sh
pnpm install
pnpm build          # prepare-data, then next build → out/
pnpm serve          # serve out/ on http://localhost:4173 (local checks only)
pnpm dev            # prepare-data, then next dev
pnpm test           # vitest: lib/stats, lib/select
pnpm typecheck
```

## Data flow

`scripts/prepare-data.ts` reads the pipeline outputs, validates them with the zod schemas in
`@mortuary/contract` (`link:../packages/contract`), and writes web-internal shards to `public/data/`,
which is gitignored:

| Input | Fallback |
|---|---|
| `../data/aggregate/aggregate.json` (env `AGGREGATE`) | `packages/contract/fixtures/aggregate.json` |
| `../data/catalog/<catalogRelease>.json` per series (env `CATALOG_DIR`) | `packages/contract/fixtures/catalog.json` |

Output: `meta.json` (series, branch tree, monster catalog, causes), `place/<Branch_N>.json`,
`monster/<key>.json`, and `reached-params.json`. Shard types are in `lib/shards.ts`.

Counts stay additive per series. Pages bake the shard into props at build time. Client components read
`?v=` (`0.34`, `0.30..0.34`, `all`), sum the selected series (`lib/select.ts`), then compute ratios
(`lib/metrics.ts`). The static HTML is prerendered with the default (newest) series.

## Routes

| Route | View |
|---|---|
| `/` | Branch tree from the catalog; floor chips shaded by mortality |
| `/[branch]/` | Branch overview (floors table), or the floor view for single-floor places |
| `/[branch]/[depth]/` | Floor view: killers ranked by share of deaths |
| `/monsters/`, `/monsters/[key]/` | Monster index; one monster across depths |
| `/about/` | Methodology |

## Floor-view columns

These follow plan §4:

1. **share of deaths** (primary, default sort);
2. **expected per visit** with P(any);
3. **deaths / 1,000 reaching** `*`;
4. **deaths per generated** `*`.

- **Asterisks:** a `*` carries a tooltip built from the aggregate's `reachedNote`. `lowerBound` places get a louder `≥*` and a warning banner.
- **Faded rows:** rows with fewer than 3 deaths are faded.
- **Intervals:** ranges are 95% Jeffreys intervals (`lib/stats.ts`).
- **Variants:** variants (`heads=7`, `colour=red`) group under their monster with an expander.

## TODOs

Search the code for `TODO(web)`. The main ones:

- CC0 tiles instead of ASCII glyphs.
- Empirical-Bayes shrinkage for ranking.
- Category drill-downs (uniques, OOD expanded by default, summons, not generated here).
- A UI for picking a range of versions.
- Recolouring the home-page chips when `?v=` changes.
- Charts.
- Monster stat blocks.
- Credits.
