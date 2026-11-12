# 00 — Combined plan (v1: DCSS 0.34)

Status: draft for agreement, 2026-11-12. Detail lives in 01–05. Where this file disagrees with them, **this file wins**. It records the user's decisions and resolves the conflicts between the forks.

## 1. Decisions so far

| # | Decision | Source |
|---|---|---|
| D1 | **v1 game data comes from a dcss-stats DB dump** (Postgres `Game` + `Player` tables). We do not scrape logfiles or morgues for v1. Our own scraping (02) is a later enrichment. | user |
| D2 | **Every stage writes static, versioned files.** We don't push everything into one DB that has to be rebuilt from scratch on each run. Monster sampling in particular runs **once per release** and its output is committed. | user |
| D3 | **Primary deadliness = share of deaths on the floor** (`deaths to X on P / all deaths on P`). **Deaths per character who reached P** is a secondary column. Its "reached" count carries an asterisk, with a tooltip explaining how it was estimated. | user |
| D4 | **"Reached" is inferred from where characters died**, using implied-path rules (§3). It's good enough on the main route and knowingly weaker elsewhere. Milestones are a bonus, not a requirement. | user |
| D5 | Not needed for v1: `ikiller`, `killermap`, `seed`, `place`, `kaux`. If we ever build our own scraper, it should store **all** of them. | user |
| D6 | Later: offer our static sampling output to dcss-stats as a PR. It could enrich the `locations` in their monster catalog. | user (future) |
| D7 | **Game-data source is a pluggable adapter.** The user is getting the data themselves, either a dcss-stats dump or a scrape on request. `ingest/` defines a source interface that outputs one normalized games table. v1 ships with a small fixture adapter, and the dump adapter fills the gap later. Nothing downstream depends on where the games came from. | user |
| D8 | **Licence: AGPL-3.0-or-later for the whole repo.** Crawl is GPL-2.0-or-later, so its "or later" lets us use v3, and GPLv3 §13 allows combining it with AGPLv3. Any patch to crawl's own source that we hope to upstream stays under crawl's own licence. Code given to MIT projects such as dcss-stats needs the author to dual-license it. Generated data isn't covered by the AGPL. | user |
| D9 | **Hosting-agnostic.** The output is a plain static directory (HTML, JS, JSON) that runs on any static host: Cloudflare Pages, Vercel, GitHub Pages, or S3. We don't use features specific to one host, and serving cost is minimised wherever it's hosted. The GitHub repo is public. | user |

Notes on D5:
- `ikiller` *is* recoverable from morgues. The long death description prints `... summoned by X` lines (`hiscores.cc`, `DDV_VERBOSE`/`DDV_LOGVERBOSE`).
- dcss-stats' `endMessage` is the one-line message, which leaves the summoner out. So v1 credits each death to the **monster that dealt the killing blow**. Summons and other monsters that never appear in level generation get a deadliness figure but no per-encounter figure.
- `killermap` is not recoverable from morgues, which list only the vaults on each level.

## 2. Architecture (v1)

```
levelgen/  (GPL-2.0+)   crawl 0.34.1 build + mortuary_sample.lua  ──►  data/levelgen/0.34/*.json   (committed, static)
                         + catalog export (monsters, names, plurals, glyph/tile, branch table) ──►  data/catalog/0.34.json
ingest/    (TS)          source adapter (dcss-stats dump | own scrape | fixture) ──► normalize (killer → monster key, branch:lvl → place key, bots flagged)
                                            ──► data/games/0.34.parquet  (raw dump kept outside git, e.g. R2 or local)
aggregate/ (TS + DuckDB) games + levelgen + catalog ──► data/aggregate/0.34.jsonl  (long table, additive counts)
web/       (Next.js 16, output: 'export')  aggregate + catalog ──► out/ (plain static files, any host)
packages/contract (TS)   zod schemas + types for every file above; curated lineage.yaml / killer overrides
```

- **Monorepo, with each subproject a self-contained top-level folder**, so any of them can be split into its own repo later. The whole repo is AGPL-3.0-or-later (D8).
- **Languages:**
  - **TS** for everything except the crawl build and its Lua script.
  - The 02 fork's Rust-vs-TS conclusion was TS, so the question is moot.
  - Python stays an option only for the later kill-list calibration model (05).
- **Incrementality comes free from D2:**
  - levelgen reruns only when a release changes (0.34.0 → 0.34.1 changed no spawn data).
  - ingest reruns when a new dump arrives.
  - aggregate and web are cheap and rerun every time.

## 3. Estimating "reached" without milestones (D4)

Each death at place P counts as having passed through a set of earlier places, credited fractionally where the route is uncertain. Branch facts below are from `branch-data.h` at 0.34.1.

| Branch | Entry (0.34.1) | Rule |
|---|---|---|
| D | — | A death anywhere at or below D:k credits D:1…k. A death in a branch credits D down to that branch's entry depth. Where the entry depth is a range, credit fractionally using the entry-depth frequencies from levelgen. |
| Lair (5 floors) | D:8–11 | Deaths in Vaults, Depths, Elf, Crypt, Tomb, Forest, Zot, the hells, and all wins: credit Lair:1–5 in full (assume Lair completed). Deaths inside Lair, or in S-branches/Slime (entered from Lair:2–5), credit Lair only down to that floor or entry depth, via the ordinary path rule. |
| S-branches (4 floors each, 2 of 4 per game) | Lair:2–3 | Deaths in Vaults, Depths, Zot and below, and wins: credit "one S-branch completed" (user's "50%"), split across the four by how often levelgen places each one. **Tunable.** The DB's `runes`/`uniqueRunes` fields can tighten this (e.g. wins have ≥3 runes). |
| Orc (2 floors) | D:9–12 | Deaths in Elf: credit Orc in full. Deaths in Vaults, Depths and Zot: credit Orc at a tunable probability (most players do it). |
| Vaults (5) | D:13–14 | Deaths in Crypt, Tomb or Forest, Zot deaths, and wins: credit Vaults:1–4 (tunable). V:5 is credited only for deaths at V:5. |
| Depths (4), Zot (5) | D:15, Depths:4 | Main route: deeper deaths and wins credit the earlier floors. |
| Hells, Pan, Abyss, portals, Slime, Elf, Crypt, Tomb | — | Credit only deaths at the **same or a deeper level of that branch**. These counts are strict lower bounds, and the tooltip says so plainly. |

- **The tooltip appears on every "reached" figure.** It states the rule used, and for the extended branches it says the number is a lower bound.
- **Two estimate grades per place, carried as a field in the data** rather than hard-coded in the UI:
  - `main`: D, Lair, Orc, the two S-branches, V:1–4, Depths and Zot.
  - `lowerBound`: everything else.
- **Later, with milestones from only some servers:** don't just scale up by total game count, because server populations differ in skill and bot share. Use a **ratio estimator**:
  1. On the servers that have milestones, measure `reached(P) / implied_reached(P)`.
  2. Apply that correction factor to the implied counts from all servers.
  - The correction factor is also a direct check on the §3 heuristics.

## 4. Metrics shown (floor view, per monster)

1. **Share of deaths on this floor** (primary; sort default). It needs no denominator.
2. **Expected number per floor visit** (from levelgen), plus P(at least one present). This is the "how many will a typical adventurer face" number.
3. **Deaths per 1,000 characters reaching the floor**, with an asterisk and the tooltip from §3.
4. **Deaths per monster generated** = deaths ÷ (reached × expected per visit). This is a lower bound on danger per encounter, since not every generated monster is actually met. It also gets the asterisk, because it depends on "reached".

**Small samples:**
- Jeffreys intervals for display.
- Empirical-Bayes shrinkage for rank order.
- Rows with fewer than 3 deaths are greyed out.
- Non-monster causes (poison, starvation, Zot clock, traps, quits) are listed with their share of deaths. They have no per-encounter column.

## 5. Identifiers (conflicts resolved)

- **Monster key:**
  - Crawl's enum name, lowercased: `orc_warrior`. This was the conflict: 03 proposed `orc-warrior`, and we take 04's version. The same key is used in URLs (`/monsters/orc_warrior/`).
  - Colour, head count and the base monster of derived undead go in a separate `variant` field, not in the key (01 §6–7). Examples:
    - `ugly_thing` + `colour=red`
    - `draconian_annihilator` + `colour=yellow`
    - `hydra` + `heads=7`
    - `zombie` + `base=orc`
  - Counts are stored per (place, key, variant), so a monster row, a group row ("draconians", "ugly things") or a breakdown by variant is just a sum. Groups come from the per-version catalog.
  - Hydra heads from sampling are heads *when generated*. Heads from killer strings are heads *at death*, which runs higher because cut heads regrow. Treat them as two separate measurements.
  - Renames across versions go in a hand-curated `lineage.yaml`, never merged automatically.
- **Killer string → key:**
  - Port go-sequell's normalizer (MIT) to TS. It handles articles, named monsters, `X's ghost`, colour/head-count prefixes and draconian colours.
  - Exact names come from the catalog export; plurals are used later for the kill lists.
  - Strings that can't be resolved become `unresolved:<raw>` and land in an audit report. The raw string is always kept.
- **Place key:** `Branch:depth` built from the dump's `branch` + `lvl`, for example `Lair:3`. Single-floor places have no depth: `Temple`.
- **Version key:**
  - v1 has one bucket, `0.34`, holding 0.34.0 and 0.34.1. Trunk and alpha builds are excluded.
  - The contract already supports multiple versions. Version is chosen with `?v=` (03), so composites across versions are summed in the browser from additive counts.
- **Bots** are excluded by default, using dcss-stats' `Player.isBot` plus Sequell's bot names.

## 6. Data contract changes against 03

03's `PlaceVersionCounts` stays, with these changes:
- Add `deathsByMonster` alongside `deathsTotal`.
- Change `reached` to `{ value: number; method: 'implied' | 'milestones' | 'ratio'; grade: 'main' | 'lowerBound' }`.
- Keep `exposure = reached × λ`. It is additive, but it inherits the `grade` of `reached`.
- The aggregate step writes the single long table, plus `meta`/catalog. The webapp's `prepare-data` step splits it into shards (03's recommendation, accepted).

## 7. Phasing

| Phase | Deliverable | Blocked on |
|---|---|---|
| P0 | `packages/contract`; catalog export from the crawl 0.34.1 build; killer normalizer and its tests | — |
| P1 | levelgen sampling for 0.34: about 10k seeds (~35 min on 16 cores), aggregate committed | — |
| P2 | ingest (source interface plus a fixture adapter), then the aggregate | Nothing blocks the build. The real data adapter is added when the user has the data (D7). |
| P3 | webapp v1 (0.34): dungeon map, floor view, monster view, about/methodology page | P1, P2 |
| Later | milestones (ratio estimator); our own logfile ingest (`ikiller`, `killermap`, `kaux`); morgue kill lists and calibration (05); more versions; PR to dcss-stats | — |

P0 and P1 don't depend on the dump and can start immediately.

## 8. Still open (needs the user)

1. **Already decided with the 01 fork (see 01 §12):**
   - **Abyss, Pan, Zigs and the orb run:** deaths only.
   - **Plants and neutrals:** counted, but hidden by default.
   - **One row per monster class, with drill-down:**
     - derived undead, grouped by base monster;
     - uniques, as a single "uniques" row;
     - three expandable categories: OOD, summons, and monsters not expected on this floor. Only OOD is expanded by default.
   - **Where sampling runs:** locally.
   - **Summons in v1:** with no `ikiller`, a summoned killer can't be traced back to its summoner. It falls into "summons" or "not expected on this floor" by checking its monster type against the generation tables.
   - **Still my default unless you object:** Ziggurat is shown as one place.
