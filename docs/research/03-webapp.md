# 03 — Webapp (static site) research

Status: research only. Nothing has been scaffolded. A throwaway spike lives in the session scratchpad (`webspike/`) and is not part of the repo.

## Summary

- **Stack:** Next.js 16 (App Router) with `output: 'export'`, React 19, TypeScript and pnpm. Host it on **Cloudflare** (Workers Static Assets, or Pages). A nightly GitHub Action rebuilds and deploys it. Next.js is a good fit. Astro would ship less JS, but it isn't clearly better, so we stay with the user's preference.
- **Version goes in the query string, not the path.** Each place and monster gets one prerendered page (`/D/3/`, `/monsters/orc-warrior/`). That page's HTML is server-rendered with the latest version's data. `?v=0.33`, `?v=0.30..0.34` and `?v=all` are recomputed in the browser from per-place JSON shards. This keeps the page and file count independent of the number of versions. With 20 versions prerendered as path prefixes we would hit Cloudflare's 20k-file free-tier cap. It also makes arbitrary ranges possible, which no prerendering scheme can cover, since there are O(n²) of them.
- **The data contract contains only additive counts:** `reached`, `deaths`, `exposure` (expected monsters generated, summed over the games that reached the place) and optionally `kills`. Summing these across any version set gives a valid composite. Every ratio, interval and shrinkage value is computed in the browser. Payload is small: about 1–2 KB gzipped per place per version.
- **We don't need DuckDB-WASM or sql.js.** The full cube is a few MB gzipped across all versions, and the browser only ever needs one place's or one monster's slice.
- **Tiles:** most DCSS tiles are CC0, but not all. Take them from the curated CC0 export in `github.com/crawl/tiles`, and fall back to the monster's ASCII glyph and colour for any tile that isn't cleared.

## Findings

### 1. Next.js static export (Next 16.4.6, checked 2026-11-12)

The docs ship in the package at `node_modules/next/dist/docs/01-app/02-guides/static-exports.md`. With `output: 'export'`, the following are **not supported**:
- dynamic routes with `dynamicParams: true`, or without `generateStaticParams`
- Route Handlers that read the Request
- cookies, rewrites, redirects and headers
- Proxy (the old middleware)
- ISR, Draft Mode, Server Actions and intercepting routes
- `next/image` with the default loader (use `images.unoptimized` or a custom loader)

Consequences for us:
- **No redirects.** `/` must be a real page, and so must an old version alias. Do redirects at the host if we ever need them (Cloudflare `_redirects`).
- **Every route is enumerated** with `generateStaticParams` plus `dynamicParams = false`.
- **Server components read JSON from disk at build time.** Client components handle the `?v=` filter (`useSearchParams` inside a `<Suspense>` boundary) and fetch shards.

**Spike** (synthetic data: 150 places, 700 monsters, 5 versions, path-prefixed version pages; Apple Silicon laptop):

| Metric | Result |
|---|---|
| Build time | 1,454 pages in **17 s** (`next build`) |
| Files emitted | **5 files per page**: `index.html`, `index.txt` and three RSC segment `.txt` files. 7,272 files in total. |
| Page size | about 47 KB raw / **4 KB gzipped** per page, with the 90-row table serialized into the RSC payload |
| Baseline JS | first-load JS is about **171 KB gzipped**. That's the Next 16 runtime plus React. |

Build time is a non-issue even at 10k pages. The real constraint is **file count**.

**Alternatives:**
- **Astro (7.x) with React islands:** near-zero JS on content pages, about 60 KB when the filter/table island loads, and no RSC `.txt` duplication, so roughly 1 file per page. It's objectively a better match for a "mostly static tables" site. The gap is modest, though, and the user knows React/Next. Revisit if the 170 KB baseline or file count becomes a problem.
- **Vite SPA with prerender:** more DIY (routing, prerender plugin, head tags) for no real gain. Rejected.
- **Mitigation:** keep all data, aggregation and metric code in a framework-agnostic `lib/` (pure TS, unit-tested). Switching frameworks would then only mean rewriting thin page shells.

### 2. Data delivery

| Option | Verdict |
|---|---|
| Bake everything into the page HTML at build | Do this **only for the default (latest) version**. It gives SEO, no-JS rendering and instant first paint. |
| Per-place / per-monster JSON shards fetched by the client | **Primary mechanism** for version switching and composites. One fetch per page carries all versions for that place, and the client sums the selected versions. |
| SQLite (sql.js, about 600 KB+ of WASM) / DuckDB-WASM (several MB) | Overkill. It only pays off for free-form ad-hoc querying, which we don't need. Possible later as an "explorer" feature. |

**Additivity check:**
- `reached`, `deaths` and `kills` are counts, so they sum.
- Expected encounters are a per-visit rate that differs by version, so it is *not* additive. Instead we store `exposure = reached × expectedPerVisit`, which is the expected number of monster M generated across all visits, and sum that.
- A composite rate is then `Σdeaths / Σexposure`, which correctly weights versions by how many games reached the place.
- Monsters missing from a version are simply absent (sparse), and sum as zero.

**Payload estimate, realistic case:**
- About 180 places: D:1–15, the Lair branches, Hells 4×7, Zot, Zig 1–27, portals, Abyss/Pan and so on (see §4).
- About 120 monsters with non-zero exposure or deaths per place on average.
- About 4 numbers per row in columnar JSON.

That gives about 22k rows per version, which is about 500 KB raw / 200 KB gzipped for the whole cube of one version:
- **Per place per version:** about 3 KB raw / about 1.2 KB gzipped.
- **A place shard carrying 20 versions:** about 60 KB raw / about 20 KB gzipped.
- **Monster shards:** similar size.
- **Total for 20 versions:** about 10 MB raw / about 4 MB gzipped, spread over about 900 files.

### 3. Metrics and presentation

Inputs per (place P, monster M, version set):
- `reached[P]`: games that entered P. **Subproject 2 must provide this**, for example from the morgue's dungeon overview or from milestones. Without it there is no denominator.
- `deaths[P][M]`
- `exposure[P][M]`, from subproject 1 × `reached`
- `kills[P][M]` (optional, stretch)
- `deathsTotal[P]`, including non-monster causes

| Metric | Formula | Label in UI |
|---|---|---|
| Lethality per encounter | `deaths / exposure` | "1 in N kills you" (headline; sortable) |
| Danger contribution | `1000 · deaths / reached` | "deaths per 1,000 arrivals" |
| Share of floor deaths | `deaths / deathsTotal` | "% of deaths here" |
| Floor mortality | `deathsTotal / reached` | heat colour on the map |
| (stretch) Fight loss rate | `deaths / (deaths + kills)` | "loses 1 fight in N". This one doesn't depend on the generation model, and is useful to cross-check it. |

**Small samples.** Per-cell death counts will often be in the single digits.
- **Show** the point estimate plus a **Wilson 95% interval**. Deaths per encounter is a proportion: one generated monster kills you at most once. Wilson is closed-form and cheap to compute in the browser for any composite.
- **Sort by an empirical-Bayes shrunk rate:** `(d + s) / (E + s/μ)`. Here μ is the floor-wide per-encounter death rate (`ΣdeathsMonsters / Σexposure` on that floor) and s is about 2 pseudo-deaths. Large-sample rates are unaffected, and single lucky or unlucky deaths stop dominating the ranking.
- **Thresholds:** grey out rows with `deaths < 3` or `exposure < 50`, and hide them behind a "show low-confidence" toggle.
- **Caveat to show on the about page:** an "encounter" means a monster was *generated* on the level. The player may never have met it, so per-encounter lethality is a lower bound. Kills from morgues (stretch) help calibrate this.
- **Deaths with no exposure** must still be listed with lethality shown as "—". Examples:
  - summons, uniques from vaults
  - player ghosts, pan lords, derived monsters (zombies, spectral and simulacrum things)
  - non-monster causes (poison, starvation, traps, quitting, Zot)

**Core views:**
1. **Dungeon map (`/`):**
   - A branch tree: the D spine runs vertically, and child branches attach at their entry *range* (Lair at D:8–11, and so on).
   - Each floor is a cell coloured by mortality, and hovering shows the top 3 killers.
   - Portals and Abyss/Pan/Zig sit in a side panel.
   - Branches that only some games get (2 of Swamp/Shoals/Snake/Spider) are drawn dimmed, and their `reached` comes from real data.
2. **Branch view (`/Lair/`):** a floor × top-killers grid for the branch, with mortality per floor.
3. **Floor view (`/Lair/3/`):**
   - A header with arrivals, deaths, mortality and the top killers.
   - A ranked table with columns: tile, monster, expected per visit, encounters, deaths, lethality with CI bar, share, per-1,000.
   - A separate "other causes" group.
4. **Monster view (`/monsters/orc-warrior/`):**
   - Lethality and exposure across every place it appears, as a bar or heat strip in dungeon order.
   - Small multiples per version when a range is selected.
   - Monster stats from the catalog: HD, HP, AC/EV, flags.
5. **Killers (`/killers/`):** a global leaderboard across all places, including non-monster causes.
6. **Version filter** (global, persisted in the URL):
   - segmented control **Latest | Version ▾ | Range ▾–▾ | All**
   - `?v=` grammar: `0.34`, `0.30..0.34`, `all`
   - alphas/trunk excluded by default, with a footnote showing the game count per version

Charts: hand-rolled SVG (heat cells, bars, CI whiskers). Nothing here needs a charting library. Add visx or Observable Plot later if a view demands it.

### 4. Assets and dungeon structure

**Tile licensing** (checked in the crawl repo at tag 0.34.1):
- The top-level `LICENSE` says the majority of tiles and artwork are CC0, but *"the licensing situation may be complex, especially for older pieces"*, and points to `github.com/crawl/tiles`.
- `rltiles/license.txt` states the RLTiles base set is public domain.
- `crawl/tiles` publishes a curated CC0 export, with an artists-consent list and a list of excluded or unclear tiles.

So we **source tiles from the crawl/tiles CC0 export**, not straight from `crawl-ref/source/rltiles`. Add a credits page. Any monster without a cleared tile falls back to its glyph and colour from `dat/mons/*.yaml` (for example `glyph: {char: "o", colour: yellow}`), which also gives us a nice ASCII mode.

**Key → tile mapping** (verified):
- `rltiles/dc-mon.txt` lines are `<file> MONS_<ENUM>` under `%sdir <dir>` directives. A name containing `/` is relative to the `rltiles/` root.
- Parsing that resolved **751 MONS_ → png mappings, with 0 missing files**. Example: `mon/humanoids/orcs/orc_warrior.png`.
- Monster definitions live in `dat/mons/*.yaml` in 0.34 (672 files, with `name:` and an optional `enum:`).
- A naive name→enum join leaves about 80 monsters without a direct tile line: draconian colours, zombies and other derived forms, multi-variant tiles, and enum-naming differences.
- **Better:** subproject 1 already builds crawl, so it should emit a monster catalog using crawl's own `tileidx_monster_base()` and the tile name tables. A hand override map covers the rest.

**Tile delivery:** about 700 × 32 px PNGs at about 1–2 KB each. Use a single sprite sheet plus a CSS/JSON offset map to save files and requests, or individual files, which fit easily under the cap.

**Branch structure** (`branch-data.h`, 0.34.1). Each entry has: id, parent, min/max entry depth in the parent, depth, absdepth and abbrev. Highlights:
- **D** (15 floors)
- **Temple**: D:4–7, 1 floor
- **Orc**: D:9–12, 2 floors
  - **Elf**: Orc:2, 3 floors
- **Lair**: D:8–11, 5 floors
  - **Swamp / Shoals / Snake / Spider**: Lair:2–3, 4 floors each. Only 2 of the 4 appear in a given game.
  - **Slime**: Lair:4–5, 5 floors
- **Vaults**: D:13–14, 5 floors
  - **Crypt**: 3 floors
    - **Tomb**: 3 floors
  - **Forest**: Vaults:2–3, 5 floors. **New since older versions.**
  - **Blade**
- **Depths**: D:15, 4 floors
  - **Zot**: 5 floors
  - **Zig**: 27 floors
- **Hell** vestibule, with **Dis / Geh / Coc / Tar** at 7 floors each
- **Abyss** (7), **Pan**
- **Portals**: Sewer, Ossuary, Bailey, IceCv, Volcano, Lab, Bazaar, Trove, Gauntlet, WizLab, Desolation, and **Necropolis** and **Crucible** (new)
- Some entries are under `#if TAG_MAJOR_VERSION == 34` and are legacy-only, such as Dwarf with depth 0.

**The branch list changes between versions**, so navigation must be driven by a **per-version `branches` table in `meta.json`** and never hard-coded. Composites use the union of the selected versions' branches.

Place key format: `Branch:depth` using crawl's own abbreviations (`D:3`, `Lair:2`, `Zot:5`). One-floor branches drop the depth (`Temple`, `Sewer`). This matches what morgues and logfiles use.

### 5. Hosting

| Host | Cost | Limits that matter | Notes |
|---|---|---|---|
| **Cloudflare Workers Static Assets / Pages** | free | 20k files per site/version on the free tier (100k paid), 25 MiB per file, unlimited bandwidth and asset requests | Custom domain is free. `_headers`/`_redirects` supported. Deploy with `wrangler` from a GH Action. **Recommended.** |
| GitHub Pages | free | 1 GB site, 100 GB/month soft bandwidth, 10-minute deploy timeout, no custom headers | Fine as a fallback. Policy forbids primarily commercial use; we're not. |
| S3 + CloudFront | cents/month (CloudFront's always-free 1 TB/month covers us) | effectively none | Most setup and IAM. Only worth it if we want everything on AWS. |

**Estimated file budget** with query-string versions:
- about 180 place pages + 35 branch pages + 700 monster pages + about 10 others, ≈ 925 pages × 5 = **about 4.6k files**
- about 900 JSON shards
- tiles: 1 sprite sheet, or about 700 PNGs

Total is **about 6–7k files**, which is comfortably under 20k. Path-prefixed versions would add about 4.6k files per version and break the cap at around 3 versions.

**Rebuild cadence:**
- A nightly GH Action pulls the latest aggregate artifact, runs `pnpm build` (well under 2 minutes) and runs `wrangler deploy`.
- Add a manual `workflow_dispatch` trigger.
- Hash shard filenames or add `?b=<buildId>`, and set long `Cache-Control` on `/data/*` and `/_next/static/*`.

## Recommended stack

- Next.js 16 App Router, `output: 'export'`, `trailingSlash: true`, `images.unoptimized: true`
- React 19, TypeScript strict, pnpm
- Plain CSS modules or Tailwind. Tailwind is optional; no component library is needed.
- `webapp/src/lib/` is pure TS: shard loaders, composite summation, metrics (Wilson, shrinkage), `?v=` parsing. Tested with Vitest.
- `webapp/scripts/`:
  - `prepare-data.ts` validates the aggregate input against the contract with zod and writes `public/data/**`
  - `prepare-tiles.ts` builds the sprite sheet from the crawl/tiles CC0 export at a pinned commit
- Deploy: GitHub Actions → wrangler → Cloudflare

## Proposed data contract (what the webapp consumes)

This is the build input, produced by the aggregation step that joins subprojects 1 and 2. All counts are additive.

```ts
// ---- identifiers ----
type VersionKey = string;   // "0.34" — major release line; minor patches (0.34.1) folded in
type PlaceKey = string;     // "D:3", "Lair:2", "Temple", "Zig:14", "Abyss:3"
type MonsterKey = string;   // stable kebab slug of canonical name: "orc-warrior", "sigmund", "player-ghost"
type CauseKey = string;     // non-monster death causes: "poison", "starvation", "trap", "zot", "quit", "other"

// ---- meta.json (one file) ----
interface Meta {
  schemaVersion: 1;
  generatedAt: string;                       // ISO timestamp
  defaultVersion: VersionKey;                // "0.34"
  versions: VersionInfo[];
  monsters: MonsterInfo[];                   // global catalog; union over versions
  causes: { key: CauseKey; label: string }[];
}
interface VersionInfo {
  key: VersionKey;
  label: string;                             // "0.34"
  stable: boolean;                           // false for trunk/alpha
  games: number;                             // games ingested
  firstGame: string; lastGame: string;       // ISO dates
  branches: BranchInfo[];                    // navigation for this version
}
interface BranchInfo {
  abbrev: string;                            // "Lair" — prefix of PlaceKey
  name: string;                              // "the Lair of Beasts"
  depth: number;                             // floors (1 = single-floor; PlaceKey has no ":n")
  parent: string | null;                     // parent abbrev; null for D / Abyss / Pan / portals
  entryMin: number | null; entryMax: number | null;  // entry floor range in parent
  kind: 'main' | 'portal' | 'hell' | 'special';      // Abyss/Pan/Zig = special
}
interface MonsterInfo {
  key: MonsterKey;
  name: string;                              // "orc warrior"
  enumName?: string;                         // "MONS_ORC_WARRIOR"
  unique: boolean;
  tile?: { sheet: string; x: number; y: number; w: number; h: number }; // absent → glyph fallback
  glyph: { char: string; colour: string };
  stats?: { hd: number; hp10x?: number; ac: number; ev: number; xp: number; flags: string[] };
  versions: VersionKey[];                    // where it exists
  aliases?: string[];                        // old names / killer-string variants (for search)
}

// ---- data/place/<encoded PlaceKey>.json  (e.g. place/Lair_2.json) ----
interface PlaceShard {
  place: PlaceKey;
  byVersion: Record<VersionKey, PlaceVersionCounts>;
}
interface PlaceVersionCounts {
  reached: number;                           // games that entered this place
  deathsTotal: number;                       // all deaths here (monsters + causes)
  // columnar, parallel arrays; row i = one monster
  mon: number[];                             // index into Meta.monsters
  exposure: number[];                        // Σ expected count generated over all visits (float)
  deaths: number[];                          // deaths to this monster here
  kills?: number[];                          // (stretch) player kills of this monster here
  causes?: Record<CauseKey, number>;         // non-monster deaths
}

// ---- data/monster/<MonsterKey>.json ----
interface MonsterShard {
  monster: MonsterKey;
  byVersion: Record<VersionKey, {
    place: PlaceKey[];                       // columnar again
    exposure: number[]; deaths: number[]; kills?: number[];
    reached: number[];                       // copy of place reached (so shard is self-contained)
  }>;
}

// ---- derived client-side, never stored ----
type VersionSelection = { kind: 'one'; v: VersionKey } | { kind: 'range'; from: VersionKey; to: VersionKey } | { kind: 'all' };
```

The webapp's build step validates all of this with zod and refuses to build on a mismatch. The monster and place shards are *derivable* from a single long-format table: `(version, place, monster|cause, reached, exposure, deaths, kills)`. The cleanest contract with the aggregation step may simply be that one Parquet/CSV/JSONL table plus `meta`, with the webapp's `prepare-data` script doing the sharding. **That is my recommendation**; the shapes above are then internal to the webapp. Subproject 4 should own the decision.

## Page / route map

| Route | Content | Prerendered params |
|---|---|---|
| `/` | Dungeon map, headline stats, top killers (latest version) | — |
| `/[branch]/` | Branch overview (all floors) | union of branch abbrevs over all versions |
| `/[branch]/[depth]/` | Floor view (multi-floor branches) | each (branch, depth) in the union |
| `/monsters/` | Searchable monster index | — |
| `/monsters/[slug]/` | Monster view | every MonsterKey |
| `/killers/` | Global killer leaderboard incl. causes | — |
| `/about/` | Methodology, caveats, data sources, credits/licenses | — |

- Every page accepts `?v=`.
- Static segments (`monsters`, `killers`, `about`) win over `[branch]`. No branch abbrev collides with them.
- One-floor branches render the floor view at `/[branch]/`.

## Interfaces with other subprojects

- **From 1 (monster sampling):**
  - `expectedPerVisit[version][place][monster]`, including vault and band spawns, ideally split into "on arrival" and "spawned over time"
  - per-version branch table (as `BranchInfo`)
  - monster catalog (name, enum, glyph, stats, tile index)
- **From 2 (scraping):**
  - per (version, place): `reached` and deaths by normalized `MonsterKey` or `CauseKey`
  - optionally kills per (version, place, monster)
  - per-version game counts and date ranges
- **Shared, owned by 4 (architecture):**
  - the canonical `MonsterKey` and normalization (killer strings like "an orc warrior", "Sigmund", "a spectral orc", "a goblin zombie" map to keys; renames across versions get aliases)
  - `PlaceKey` normalization (old branch names and abbreviations)
  - version bucketing (patches folded into a major; how trunk/alpha are labelled)
  - where the aggregate artifact lives (GH Release asset or an R2/S3 object) so the nightly build can fetch it

## Risks

- **The denominator (`reached`) must exist and be trustworthy.** If morgues only give the maximum depth per branch, the "reached D:k for all k ≤ max" assumption is fine. Portals and Abyss need explicit visit evidence.
- **The exposure model is approximate** (generated ≠ met). Lethality is a model-relative number and must be labelled as such. Kills-based loss rate would be a strong sanity check.
- **Monster identity across versions:** renames, removed monsters and derived forms. A bad mapping silently splits or merges rows.
- **Tile licensing edge cases:** mitigated by the CC0 export plus the glyph fallback.
- **Next.js baseline JS (about 170 KB gzipped) and its RSC file overhead** (5 files per page). Fine at our scale, but it is the reason Astro would be the fallback.
- **Query-string versions** mean non-default versions aren't individually indexable by search engines and cause a brief re-render on load. That's acceptable. If needed later, prerender path-prefixed pages for a few headline versions only.

## Open questions for the user

1. Should the version filter key on major lines only (0.34), or also distinguish patch releases (0.34.0 vs 0.34.1)? Trunk builds are excluded by default; should they be shown at all?
2. Do you want per-species, per-background or per-XL facets eventually? This multiplies the cube. It's better to know now so the contract can carry an optional facet dimension.
3. What should the headline metric be: "1 in N encounters kills you" (model-dependent), or "deaths per 1,000 arrivals" (data-only)? My default would be to show both, with lethality as the default sort.
4. Should Zig (27 floors), Abyss levels and Pan be shown per floor, or collapsed to one place each?
5. Domain name and Cloudflare account. Is a public GitHub repo OK? That affects GH Actions minutes and the Pages fallback.
6. Is a glyph-only (ASCII) fallback acceptable for the few tiles we can't clear as CC0?
