# 04 — Architecture & cross-cutting concerns

Status: research draft (2026-11-12). Scope: whole-system view. Covers prior art, the core metric definition, shared identifiers, repo/pipeline layout, licensing, and phasing. Subproject details are in 01 (levelgen sampling), 02 (scraping), 03 (webapp), and 05 (kill-list calibration).

Unless noted, all source facts were checked against the `0.34.1` tag of crawl/crawl. Paths are relative to `crawl-ref/source/`.

---

## 1. Summary

- **Biggest prior art: dcss-stats** ([O4epegb/dcss-stats](https://github.com/O4epegb/dcss-stats), MIT, active). It already ingests logfiles from every server and has a monster catalog extractor that builds crawl and dumps spawn tables. It does **not** compute deadliness per floor. It also doesn't store the fields we need: `ikiller`, `killer_flags`, `killermap`, milestones, or morgue sections. We should write our own scraper, but reuse its server list and its extractor approach, and probably talk to its maintainer.
- **The empirical half of the metric needs no levelgen at all.** P(die to X | reached floor P) = deaths(P, X) / visitors(P) comes straight from logfiles plus milestones. Ship that first (MVP). Levelgen sampling then adds a per-encounter metric on top: deaths per monster met.
- **Ship additive counts, not ratios.** Per version we publish `N_P` (visitors), `D_{P,m}` (deaths), and exposure `X_{P,m} = N_P·λ_{P,m}`. The static site can then sum any version range in the browser and recompute ratios and intervals. This is the single most important constraint on the data contract between 01/02 and 03.
- **Identity needs to be a first-class package, not a full subproject.** It holds monster keys, place keys, version keys, and killer-name resolution. The generator runs inside the GPL levelgen build, because it needs a compiled crawl. The output is plain JSON plus TS/Rust types in `packages/contract`.
- **Repo shape:** a monorepo. `levelgen/` is GPL-2.0-or-later. Everything else is MIT, or all GPL if you want simplicity. Large raw data goes in object storage (R2/B2), small curated outputs are committed, and pipeline steps run from a top-level `justfile`.
- **Unexpected finding for 01/05:** the logfile records the game `seed` for every game, and default `pregen_dungeon=incremental` makes the connected dungeon stable per seed. For games played on an exact build we can reproduce, we could regenerate the actual levels a player saw. Portals, Abyss and Pan are excluded. This is a calibration/validation option, not MVP.

---

## 2. Ecosystem / prior art

### 2.1 dcss-stats (dcss-stats.com)

What it is: a Yarn monorepo with `apps/api` (Fastify + Prisma/Postgres), `apps/web` (Next.js, server-rendered against the API, not static), `apps/extractor`, and a browser extension.

**Ingestion** (`apps/api/src/parser/`):
- Fetches logfiles incrementally. It stores `Logfile.bytesRead` per (server, path), so each fetch is effectively a byte-range continuation.
- Parses each logfile line into a `Game` row. Columns include `version`, `branch`, `lvl`, `killer`, `killerType` (ktyp), race/class/god, `turns`, `xl`, runes, and more.
- **Not stored:** `ikiller`, `kpath`, `killer_flags`, `kaux`, `killermap`, `absdepth`, `place`, `seed`, `explbr`.
- **No milestones table**, so it cannot say who *reached* a floor, only where people died.
- Fetches morgues on demand for single games (`fetchMorgue.ts`, URL pattern `{morgueUrl}/{name}/morgue-{name}-{YYYYMMDD-HHmmss}.txt`) but doesn't parse sections in bulk.
- `Player.isBot` flags bots.
- `prisma/seedData.ts` holds a curated list of current and dormant servers. It includes archive mirrors such as `archive.nemelex.cards` and the Backblaze mirror of dobrazupa (CSZO). This list is directly reusable (MIT).

**Monster catalog** (`apps/extractor`):
- TS scripts clone and build crawl with an extra `util/monster/monster-export-main.cc`. That file is a modified version of crawl's `util/monster` tool.
- The tool dumps JSON per monster: stats, attacks, spells, resistances, tile, and **`locations`**. Locations come from the `mon-pick-data.h` population tables: branch, minDepth/maxDepth, rarity, distribution, plus water/lava tables.
- It covers **population tables only**. It does not model vaults, bands, uniques' placement rules, or level-wide generation counts. That is exactly the gap subproject 01 fills.
- The `/monsters` page renders the catalog.

**Overlap and gaps:**
- *Overlaps:* server list, logfile fetching, killer field, monster catalog with tiles.
- *Not covered:*
  - visitors per floor (needs milestones or morgue overview);
  - expected encounter counts (needs levelgen sampling);
  - per-floor deadliness;
  - root-cause attribution via `ikiller`;
  - morgue kill lists;
  - a fully static deployment.

**Reuse and collaboration options, in order of preference:**
1. Borrow, with attribution: the server/logfile/morgue URL table and the extractor technique, i.e. a custom `util/` main compiled against crawl. 01's C++ tool can use the same approach.
2. Talk to the maintainer. Ask whether they'd accept a "deaths by floor" feature, share a Postgres dump of the `Game` table (that saves the logfile backfill), or link to us from monster pages. Note that their dump still lacks `ikiller`, milestones and `killermap`, so we'd need our own logfile pass anyway. The dump would help bootstrap and cross-check, but can't replace our scraper.
3. **Don't** bulk-scrape their API. It's a hobby production service, and its data is a lossy subset of the public logfiles.

### 2.2 Sequell / go-sequell (crawl/sequell, crawl/go-sequell)

- This is the IRC stats bot behind `!lg` and `!lm`. Its loader, go-sequell, is MIT.
- `config/sources.yml` is the canonical community list of servers with their logfile and milestone paths, per version. It also has `botnames` restrictions. Compare it with dcss-stats' list (that's 02's job).
- `config/crawl-data.yml` has data we can use: uniques lists, named-orc names, `special-killer-phrases`, and `place-fixups` for historic branch spellings.
- `go-sequell/crawl/killer/killer.go` is a proven **killer-name normalizer**:
  - N-headed hydras → hydra
  - `X's ghost` → player ghost
  - coloured draconians → base draconian
  - ugly things
  - shapeshifter suffixes
  - miscast / unwield
  - a unique-name normalizer

  Port its rules (MIT) into our resolver rather than rediscovering them.
- Sequell can already answer `!lg * ktyp=mon place=Lair:3 s=killer` ad hoc, so "top killers on a floor" exists as an IRC query. It is not normalized by visitors or by encounter rate, and it can't be browsed.

### 2.3 Other

- **Crawl wiki (crawl.chaosforge.org) monster pages** have hand-maintained "Native to / depth" info, often stale. We add live numbers; we don't replace prose.
- **Dev team blog** posts tournament summaries. For example, 0.34 had 3,278 non-bot players. No per-monster death breakdown.
- I found no published per-floor, exposure-normalized DCSS deadliness analysis. The closest analogue is the NetHack "what kills players" logfile analysis series on R-bloggers.

**What would make this project new:** normalizing by **who reached the floor**, and then by **how often the monster is actually there**. That is what separates "kills lots of people because it's everywhere" from "rare but lethal". The project would also be browsable per floor, per version, and as cross-version composites, at zero hosting cost.

---

## 3. Metric definition

Calibration mechanics (how 05 estimates the "faced" factor `c`) are out of scope here. This section only fixes the definitions and statistics.

### 3.1 Notation

Fix a version bucket `v`, a place `P` (e.g. `Lair:3`), and a canonical monster key `m`.

| Symbol | Meaning | Source |
|---|---|---|
| `N_P` | Number of eligible games that **visited** P (unique games, not visits) | milestones + death place (MVP); morgue overview (exact) — 02 |
| `D_{P,m}` | Eligible games whose death place = P and whose attributed killer resolves to m | logfile — 02 + resolver |
| `D_P` | All eligible deaths at P (monster and non-monster) | logfile |
| `λ_{P,m}` | Expected number of m present on P per level generation (levelgen + vault/band placement) | levelgen sampling — 01 |
| `σ_{P,m}` | Optional: expected spawns of m on P per 1000 turns spent there (wandering generation) | 01 (if feasible) |
| `c_{P,m}` | Fraction of present m that a visitor actually faces | calibration — 05 (defaults to 1) |
| `X_{P,m}` | Encounter exposure = `N_P · λ_{P,m} · c_{P,m}` (summed over versions in a composite) | derived |

### 3.2 Primary metric: floor lethality

**Lethality** `L_{P,m} = D_{P,m} / N_P`: the probability that a character who reaches P dies to m on P. Display it per 1,000 visitors.

- This answers the user's question directly: "how deadly is X on this floor for a typical adventurer who gets here".
- It is purely empirical, robust, and needs no levelgen, so it can ship in the MVP.
- It conditions on reaching P, which is the right estimand. Characters who never reach P aren't at risk there.

### 3.3 Secondary metrics

1. **Per-encounter lethality** `K_{P,m} = D_{P,m} / X_{P,m}`: deaths per monster faced.
   - This separates rare-but-lethal (e.g. an out-of-depth ogre on D:3, or uniques) from common-and-moderately-lethal.
   - It needs 01, and 05 for `c`. Until 05 delivers, label it "per monster generated" with `c = 1`. That is a lower bound on per-encounter danger, since not every generated monster is faced.
2. **Share of deaths** `S_{P,m} = D_{P,m} / D_P`: "what kills people here". Good for the floor view's ranked list.
3. **Expected encounters** `E_{P,m} = λ_{P,m} · c_{P,m}`, plus `p_any` = P(at least one present on a level). The "how many of these will I face" number the user asked for.
4. **Branch-cumulative lethality**: P(die to m anywhere in branch B | entered B) = Σ_{P∈B} D_{P,m} / N_{B:1}. Good for the branch overview.

### 3.4 Attribution rules (the resolver's contract)

The logfile (0.34.1, `hiscores.cc`) provides these fields:
- `killer`: the direct killer's display name, from `mons->name()`/`full_name()`. Pan lords get the suffix " the pandemonium lord", shapeshifters "(shapeshifter)", phantom mirror copies "(illusionary)".
- `ikiller`: the **root of the blame chain**, e.g. the summoner. It equals `killer` when there is no blame.
- `kpath`: the full blame chain.
- `killer_flags` (e.g. `unique`).
- `kaux`: the weapon or spell.
- `killermap`: the vault the killer was placed by.
- `ktyp`: the death type.

Rules:
- **Default attribution is to `ikiller`.** Our exposure `λ` counts generated monsters (the summoner), not their summons (spectral weapons, ball lightning, demons, etc.). Root attribution keeps numerator and denominator consistent. Keep `killer` as a secondary breakdown: "via spectral weapon (40%)".
- **Monster-sourced non-melee deaths count as monster deaths.** This covers `ktyp ∈ {mon, pois, beam, cloud, reflect, …}` when the source name resolves to a monster. For poison the killer is the poisoner (`POISONER_KEY`).
- **Non-monster deaths** go to a fixed set of pseudo-keys shown alongside monsters: `@zot` (Zot clock), `@terrain` (lava/water), `@self` (own spells, "themself"), `@trap`, `@starvation`/`@misc`. Pseudo-keys are prefixed with `@` so they can never collide with monster keys.
- **Excluded from deaths, treated as censoring:** `quitting`, `leaving`, `winning`, plus `wizmode`/`explore` (already excluded by game eligibility).
- **Followers are a known limitation.** A monster that followed the player downstairs gets the death attributed at P, but `λ_P` doesn't include it, so `K` is biased upward for fast followers. Document it rather than model it.
- **Unresolvable killer strings** go to `unresolved:<raw>` and appear in an audit report. A curated override file fixes them. Resolution happens **downstream of raw storage**, so resolver improvements never require re-scraping.

### 3.5 Eligibility and selection bias

**Games we include by default:**
- normal games only: no sprint/tutorial/seeded-challenge logfiles, no `explbr` (experimental branches), no `wiz`/`explore`;
- no bot accounts (Sequell `botnames` ∪ dcss-stats `isBot`);
- no **reroll games**: `ktyp=quitting` with turns < T or XL=1 on D:1. These would otherwise swamp `N_{D:1}`. Choose T empirically, around 50–200 turns.

**Censoring.** A game whose terminal event at P is quit or leave counts in `N_P` with weight ½ (actuarial convention), and fully in all earlier places. This is a competing-risks / life-table framing. Each game contributes exposure to every place it visited. The terminal event at its last place is death-by-m, death-by-other, win, or censored.

**Selection bias.** We can't remove it; we disclose and stratify:
- *Player mix shifts with depth.* Players who reach Zot are far stronger than D:3 visitors. `L` is correct as "for those who get here", but comparing the same monster across floors confounds monster danger with player strength. Offer strata rather than adjusting:
  - "all players"
  - "experienced": ≥1 prior win at game start, computable from logfile history
  - optional "new players": ≤N prior games
- *Species/background mix:* filters would multiply data size. Defer, or precompute only a handful of popular strata (open question).
- *Speedrunners and streak players* are just part of "experienced". No special handling.
- *Server/time effects:* ignore.

**Shafts.** Shafts skip levels, and a skipped level was not visited. Exposure must come from actual visits: milestones (`br.enter`, `br.end`, `shaft`) plus the death place in the MVP, and the morgue overview / `turns_by_place` when available. Do not assume "died at D:9, therefore visited D:1–8". Use that assumption only as a fallback, and measure its error on games where morgues exist.

### 3.6 Small-sample statistics

- `L` and `S` are binomial proportions.
  - Show **Jeffreys intervals**: Beta(D+½, N−D+½). They behave at D=0 and need no special cases.
  - For **ranking** ("deadliest on this floor"), sort by the posterior mean under an **empirical-Bayes Beta prior**. Fit the prior per (branch, monster) across adjacent depths, or per place across monsters. This stops a 1-of-3 cell from topping the chart.
- `K` is a Poisson rate on exposure X.
  - Use a Gamma(α, β) prior with posterior Gamma(α+D, β+X), and report the 90% interval.
  - Levelgen sampling error in `λ` is negligible at ≥10k sampled levels per place. Carry `λ`'s standard error anyway so it can be propagated (delta method) for rare monsters.
- **Display thresholds:** grey out cells with `N_P < 30` or `D < 3`. Always show N and D in tooltips.
- **Composites across versions:** sum `N`, `D`, `X` (never average ratios), then recompute. A monster absent from a version contributes 0 to both D and X, so the composite stays consistent. All of these must stay additive. That is why the aggregate files carry counts and exposures, not rates.

---

## 4. Shared identifiers

### 4.1 Monster key

- **Canonical key = crawl's `monster_type` enum name without `MONS_`, lowercased**: `orc_warrior`, `deep_elf_fire_mage`, `player_ghost`.
- It is stable within a version, and the enum persists across versions while the save-compat `TAG_MAJOR_VERSION` stays at 34. Display name and tile come from the catalog.
- Since **0.32**, monster definitions are YAML in `dat/mons/*.yaml`, with `enum` defaulting to `name`. `mon-data.h` is generated from it at build time. 0.30–0.31 still use a hand-written `mon-data.h`. So the catalog generator should use the compiled game (via the levelgen/C++ util route) rather than parsing source, which gives one code path for all versions.

**Churn is real.** Added/removed YAML files:
- 0.32→0.33: e.g. `deep-dwarf`, `quasit`, `spellforged-servitor` removed; ~35 added.
- 0.33→0.34: e.g. `doom-hound` removed and `oblivion-hound` added; `giant-cockroach` removed and `clockroach` added; zombie/skeleton/simulacrum size variants removed and `draugr` added.
- 0.34.0→0.34.1: **no changes** to `mon-pick-data.h`, `dat/des` or `dat/mons`.
- trunk (0.35-a): `deep-elf-fire-mage` → `deep-elf-pyromancer`, `deep-elf-air-mage` → `deep-elf-zephyrmancer`, and more.

Policy:
- **Don't merge across versions automatically.** A curated `lineage.yaml` (`{from: deep_elf_fire_mage, to: deep_elf_pyromancer, kind: rename|replacement}`) lets the UI optionally group them in composites.
- The default composite keys by the exact enum. A monster absent from a version shows as "not in this version" rather than 0%.

**Derived and special monsters:**
- Zombies, skeletons and simulacra: the logfile name is "an orc zombie". In ≤0.33 this resolves to the derived type (`zombie`) with a `base` qualifier. 0.34 restructured them (draugr etc.); the resolver needs per-version rules.
- Player ghost, Pan lord, illusions, shapeshifters (resolve to the *shapeshifter*), dancing weapons (killer looks like "a +2 broad axe"), and named vault monsters (`killermap` helps). Sequell's normalizer covers most of these.

### 4.2 Place key

- **Format `${branchAbbrev}:${depth}`**, using crawl's `abbrevname` from `branch-data.h`. This matches the logfile `place`/`br`/`lvl` fields.
- Always include the depth internally, even for single-level branches (`Temple:1`, `Pan:1`, `Bazaar:1`). The UI may drop `:1`.
- Abbreviations at 0.34.1: `D Temple Orc Elf Lair Swamp Shoals Snake Spider Slime Vaults Crypt Tomb Depths Hell Dis Geh Coc Tar Zot Abyss Pan Zig Bazaar Trove Sewer Ossuary Bailey Gauntlet IceCv Volcano WizLab Desolation Arena Crucible Necropolis`.
- Save-compat-only (unreachable) entries exist under `TAG_MAJOR_VERSION == 34`: `Dwarf`, `Blade`, `Forest`, `Lab`.
- **Pitfall:** `TAG_MAJOR_VERSION` 34 is the *save format* major and has nothing to do with game 0.34. Don't let anyone key on it.
- Each place also carries `absdepth`, from the branch's `absdepth` + depth−1, which drives monster generation level. It is useful for cross-branch comparisons.
- Branch entry depths vary per game (e.g. Lair entry is on D:8–11, Orc D:9–12). The catalog stores `[mindepth, maxdepth]` for the nav tree, from `branches[]`.
- Historic spellings (`Vault`→`Vaults`, `Shoal`, etc.) are normalized via a fixups table, as in Sequell's `place-fixups`. Only relevant if we go before 0.30.
- **Place kinds** for the UI: `main` (D, Depths, Zot), `branch` (Lair, Orc, …), `rune_branch`, `hell`, `portal` (Bazaar, Trove, Sewer, Ossuary, Bailey, Gauntlet, IceCv, Volcano, WizLab, Desolation, Arena, Crucible, Necropolis, Zig), `special` (Abyss, Pan).
- Portals, Abyss and Pan get **no levelgen λ in MVP**. They are hard to sample meaningfully, so 01 should decide which of them are feasible. They still get `L` and `S`.

### 4.3 Version key

- **`series`** (e.g. `0.34`): the bucket the UI filters on. It includes `0.34.0`, `0.34.1`, later point releases, and `0.34-b*` betas. Betas may be excluded by default (open question).
- **`release`** (e.g. `0.34.1`): the exact tag. Levelgen is sampled per release.
  - When the spawn-relevant inputs are identical (hash of `mon-pick-data.h`, `dat/des/**`, `dat/mons/**`, and levelgen code), a series reuses one sample. 0.34.0 and 0.34.1 qualify.
  - Otherwise the series λ is the `N`-weighted mix of release λs.
- **`trunk`**: a separate series key `0.35-trunk` covering all `0.35-a*`. It is a moving target, so it's excluded from default views. Level data can't be matched to an exact build without `vlong` (the git describe), and we'd only sample one trunk snapshot.
- Logfile `v` gives e.g. `0.34.1` or `0.35-a0-123-gabcdef`. Keep `vlong` raw.
- **Integer sort key**: dcss-stats has one, `versionInteger`. Reuse the idea: `major*10000 + minor*100 + patch`.

### 4.4 Should identity be its own subproject?

It should be **its own package, but not its own build**.

- `packages/contract/` holds:
  - JSON Schemas for every inter-project artifact (catalog, levelgen output, normalized games, aggregates);
  - generated TS types (`json-schema-to-typescript`) and Rust types (`typify`);
  - the curated `lineage.yaml`, `killer-overrides.yaml`, `pseudo-keys.yaml`, and the bot list.
- The **catalog generator** lives inside `levelgen/`. It is the same C++ build, a second `util/` main in the style of dcss-stats' `monster-export-main.cc`. It writes `data/catalog/<release>.json` (monsters, places, branches tree, plus a name→key table) and commits it.
- This keeps GPL code in one place and gives one compile per tag, while every consumer (scraper, aggregator, web) reads plain data.

---

## 5. Repo layout & data pipeline

### 5.1 Monorepo vs separate repos

**Recommendation: one monorepo.**

- The contract (schemas, keys, resolver tables) changes in lockstep with the producers and consumers. Atomic PRs across 01/02/03 are worth far more than repo independence at this stage.
- Licensing works fine per directory: `levelgen/LICENSE` is GPL-2.0-or-later, and the root is MIT. The only coupling is data files, which aren't derivative code.
- Split `levelgen/` out later only if it grows a separate contributor base (e.g. upstreaming it to crawl as a `util/`).

```
crawl-mortuary/
  packages/contract/        JSON Schemas + generated TS/Rust types + curated YAML (lineage, overrides, bots, pseudo-keys)
  levelgen/                 01 — C++ (GPL-2.0+). crawl as a git submodule (or fetched per tag); objstat-style sampler + catalog exporter
  scraper/                  02 — fetch logfiles/milestones/morgues incrementally; emit normalized Parquet; keeps raw verbatim
  aggregate/                metric computation: DuckDB SQL over Parquet + catalog + levelgen → per-series aggregate JSON
  web/                      03 — Next.js `output: 'export'`; reads aggregate JSON at build time
  data/                     committed, small, reviewable: catalog/<release>.json, levelgen/<release>.json, aggregates/<series>.json (if small)
  docs/research/
  justfile                  `just catalog 0.34.1`, `just levelgen 0.34.1`, `just scrape`, `just aggregate`, `just web`
```

Workspaces: pnpm workspace for `packages/contract`, `web`, and the scraper if it's TS; a Cargo workspace if the scraper is Rust.

**Make the aggregation step a separate small subproject** (DuckDB SQL + a thin driver). It doesn't belong in the scraper or the web build. It is where the resolver, eligibility rules, censoring and statistics live. Then 02 only ingests, and 03 only renders.

### 5.2 Data flow

```
crawl tag ──► levelgen (C++) ──► data/catalog/<rel>.json, data/levelgen/<rel>.json   (committed; deterministic given tag+seed+N)

servers ──► scraper ──► raw store (R2/B2): logfiles, milestones (append-only, byte offsets), morgues (immutable, zstd tarballs per server/month)
                     └► normalized Parquet: games, milestones(visits), morgue_extracts(overview, kills, notes-derived) — raw strings preserved

Parquet + catalog + levelgen + contract YAML ──► aggregate (DuckDB) ──► aggregates/<series>.json  (+ stratum variants)

aggregates ──► web build (Next.js static export) ──► Cloudflare Pages / GitHub Pages
```

**Size intuition (estimates — 02 should confirm):**
- *Aggregates:* about 120 places × 50–150 monsters → ~10k cells × ~4 numbers → roughly 0.5 MB raw / ~60 KB gzipped per series per stratum. Small enough to commit and to sum client-side.
- *Logfiles:* the full multi-server history is low single-digit GB uncompressed. Fine on local disk or R2.
- *Morgues:* the big item. One series probably has a few hundred thousand games at tens of KB each, i.e. **tens of GB raw**, compressing ~10× with zstd. Never commit them. Store the extracted sections (overview, kills, notes-derived visits) as Parquet and keep raw morgues in R2 so re-parsing doesn't need re-fetching.

**Where intermediate data lives:**
- *Committed:* catalog, levelgen outputs, aggregates, all curated YAML. They're small, diffable and reviewable. A levelgen diff between 0.34 and 0.35 becomes a readable PR.
- *Object storage* (Cloudflare R2 preferred: zero egress, S3 API, pairs with Cloudflare Pages): raw logfiles, milestones and morgues, plus normalized Parquet snapshots.
- *Not GH Releases.* They're awkward for incremental append and have file-size limits. Fine as a fallback for publishing Parquet snapshots for others.

### 5.3 Orchestration

- **Scrape + aggregate + deploy:** a GitHub Actions cron (daily or weekly).
  - Each run restores scraper state (byte offsets and fetched-morgue manifest) from R2, appends, re-aggregates and rebuilds the site.
  - The initial backfill runs locally, because it's polite to spread it out and it exceeds runner time budgets.
- **Levelgen:** `workflow_dispatch` per tag, or local runs. It reruns only when a new tag appears or the sampler changes. It's CPU-heavy but embarrassingly parallel, so a matrix across places works.
- **Reproducibility:** levelgen output records crawl tag + commit, sampler version, base seed and N. Aggregates record the input Parquet snapshot hash, the catalog/levelgen file hashes and the contract version. The web build pins an aggregate version.

---

## 6. Licensing & etiquette

**DCSS code** is GPL-2.0-or-later (`LICENSE`). Some components are BSD, MIT, zlib, Apache, Boost or CC0, all GPL-compatible.
- Any binary linking crawl code, i.e. levelgen and the catalog exporter, must be GPL-2.0+, with source available. That's fine: license `levelgen/` GPL-2.0-or-later.
- The **output data** (counts, λ, stats) is factual output, not a derivative work. Consumers under MIT are fine.
- **Caveat:** if we copy creative text from crawl (monster descriptions from `dat/descript/`, quotes) into the site, that text is GPL. Either attribute it and license it as GPL on the site, or don't ship descriptions and link to the wiki instead.

**Tiles:** "the majority of Crawl's tiles and artwork are released under CC0", but "the licensing situation may be complex, especially for older pieces" (`LICENSE`). The RLTiles portion is public domain. Use monster tiles from `rltiles/` with attribution, and have 03 check the specific tiles against [crawl/tiles](https://github.com/crawl/tiles) for exceptions before shipping a sprite sheet.

**dcss-stats** is MIT. Reusing its server list or extractor approach needs attribution only. **go-sequell** is MIT, so the killer-normalizer rules can be ported. **Sequell's `crawl-data.yml`**: the repo shows no license, so treat it as a reference and re-derive rather than copy wholesale.

**Server etiquette** (02 owns the details):
- Logfiles, milestones and morgues are published for exactly this kind of use, but servers are volunteer-run.
- Use incremental `Range` requests from stored byte offsets.
- Rate-limit to ~1 request/s per host, with concurrency 1–2 per host.
- Send a descriptive User-Agent with the project URL. Per our privacy rules, no personal email.
- Honour robots.txt.
- Morgues are immutable, so fetch each one once, ever.
- Fetch morgues only for games in target series.
- Prefer archive mirrors (nemelex archive, B2 dobrazupa mirror) for dormant servers.
- Consider announcing on the crawl dev channel or tavern before the backfill.

---

## 7. Phasing

| Milestone | Content | Depends on |
|---|---|---|
| **M0 — Contract** | JSON Schemas for catalog/levelgen/games/aggregates; key specs (§4); pseudo-keys; eligibility rules; catalog for 0.34.1 (via the C++ exporter, or a quick YAML+header parse as a stopgap) | — |
| **M1 — Empirical MVP (0.34)** | Scrape 0.34 logfiles + milestones from all servers → `N_P` (milestone visits + death place), `D_{P,m}` with resolver → aggregate → static site: dungeon tree nav, floor view with `L`, `S`, Jeffreys intervals, monster view across floors | M0; **no levelgen needed** |
| **M2 — Encounters** | Levelgen sampling for 0.34.1 (`λ`, `p_any`, maybe spawn rate `σ`) → `E`, per-generated `K` (with `c=1`) | M0, 01 |
| **M3 — Morgues** | Fetch 0.34 morgues → exact visits from the overview, and kill lists → `c` calibration (05). Validate the shaft/visit assumptions from M1 | M1, 05 |
| **M4 — Multi-version** | Backfill 0.30–0.33 (catalog + levelgen per release; logfiles; maybe morgues), lineage table, client-side composites over version ranges | M1–M2 |
| **M5 — Strata & polish** | Experienced/new player strata, killer "via" breakdowns, trunk series, optional per-seed regeneration study (below) | — |

**Stretch idea for 01/05: seed replay.**
- Every logfile line has `seed`. With the default `pregen_dungeon=incremental`, "the game always generates levels in the same order", so the connected dungeon is stable per seed.
- For release-build games (`vlong` == a tag we build), levelgen could regenerate the exact D/Lair/… levels a dead character saw. That gives ground truth for "was X on the level" and validates `λ` and `c` against real games.
- Excluded: portals, Abyss and Pan (they vary), and trunk builds we can't reproduce exactly.
- This is not needed for the MVP, but it's a uniquely strong validation tool.

---

## 8. Open questions for the user

1. **License:** root MIT with `levelgen/` GPL-2.0+ (recommended), or everything GPL-2.0+ for simplicity?
2. **Hosting/storage:** Cloudflare Pages + R2 (recommended: free egress, one vendor), or GitHub Pages + Releases/B2?
3. **dcss-stats:** are you OK with us contacting the maintainer about collaborating or asking for a data dump? That's an outward-facing action, so it's your call.
4. **Default attribution:** root blame (`ikiller`, recommended, consistent with exposure), or direct killer?
5. **Strata:** is "experienced players" worth precomputing? Do we want species/background filters at all? They multiply data size.
6. **Version scope:** for M4, how far back? I suggest **0.30+**, or 0.32+ (the YAML-monster era) to keep resolver/catalog work small. Include trunk at all? Include betas in their series?
7. **Raw morgue retention:** keep all raw morgues in R2 (~a few GB compressed per series), or only extracted sections?
8. **Reroll filter threshold** and the quit-as-censoring convention. Fine to leave to the aggregate subproject's judgment unless you have a view.

---

Sources:
- [O4epegb/dcss-stats](https://github.com/O4epegb/dcss-stats) — README, `apps/api/prisma/schema.prisma`, `apps/api/prisma/seedData.ts`, `apps/api/src/parser/*`, `apps/extractor/*`
- [crawl/sequell](https://github.com/crawl/sequell) — `config/sources.yml`, `config/crawl-data.yml`
- [crawl/go-sequell](https://github.com/crawl/go-sequell) — `crawl/killer/killer.go` (MIT)
- crawl/crawl @ 0.34.1 — `LICENSE`, `branch-data.h`, `hiscores.cc`, `chardump.cc`, `initfile.cc`, `dat/mons/README.md`, `docs/options_guide.txt`
- [Crawl scoring sources.yml docs (unofficial mirror)](https://ohotnik.duckdns.org/crawl/scoring)
- [DCSS dev blog — 0.34 tournament results](https://crawl.develz.org/wordpress/blog)
- [Analyzing NetHack data (R-bloggers)](https://r-bloggers.com/2018/11/analyzing-nethack-data-part-2-what-players-kill-the-most) — closest analogous analysis found
