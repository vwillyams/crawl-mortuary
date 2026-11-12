# 02 — Game-record scraping (logfiles, milestones, morgues)

Status: research, 2026-11-12. Owner: subproject 2 fork. The deep analysis of morgue
"Vanquished Creatures" kill lists and calibration against sampling belongs to
`05-kill-calibration.md`. This doc covers only kill-list URL derivation and fetch cost.

## 1. Summary

- **The logfiles alone answer both core questions.** Each finished game is one
  `key=value` line that records where the character died (`place`, `br`, `lvl`,
  `absdepth`), what killed it (`ktyp`, `killer`, `kaux`, `ikiller`, `kpath`,
  `killer_flags`) and even which vault the killer came from (`killermap`). We need
  morgues only for kill lists and for an exact per-level "levels visited" set.
- **Milestones give the denominator.** That is, how many characters reached each
  level. The `br.enter`, `br.end`, `shaft` and `uniq` events, plus the `place` field
  on every milestone, give a good per-game "deepest level reached per branch". No
  milestone fires for every level, so this is an inference. Morgue "Notes" contain
  `Entered Level N of <branch>` for every new level, so they give the exact set and
  can check the inference on a sample.
- **Size for 0.34:** about 420 MB of logfiles (≈700k games) and about 2.4 GB of
  milestones, across 10 live servers. All servers support HTTP Range on append-only
  files, so incremental sync is cheap.
- **Size for all history:** about 8.3 GB of logfiles (≈14M games, half of them trunk)
  and roughly 50 GB of milestones. This is fine to backfill once at a polite rate.
- **Morgues cannot be bulk-scraped everywhere.** The CAO robots.txt disallows
  `/rawdata` (its morgues). CNC's archive disallows `/` entirely. CUE morgues sit
  behind HTTP Basic auth. Plan for sampled morgues from the servers that permit
  them, and ask admins before going further.
- **Recommendation:** write the ingest in **TypeScript** (Node 22, streaming). Keep
  the raw files as a byte-exact mirror, parse into **DuckDB**, and export additive
  pre-aggregated count tables (JSON or Parquet) for the webapp. The network and
  courtesy limits are the bottleneck, not CPU, so Rust buys little. The killer
  normalizer is the hard part, and it should share a monster table with
  subprojects 1 and 3.

## 2. Prior art

| Project | What it does | Reusable | License |
|---|---|---|---|
| **O4epegb/dcss-stats** (`apps/api/src/parser`, `prisma/seedData.ts`) | Postgres/Prisma + Next.js. Its server list is in `seedData.ts`: 15 servers (some marked `isDormant`) with `baseUrl`, `morgueUrl` and logfile paths per version. The fetcher runs `wget --continue` (resume by local size) on a queue: one at a time, every 5 min for current versions and 25 min for old ones. The reader keeps `bytesRead` per logfile and parses 10 MB chunks. Game id = hash(name, server, start). It stores `br`, `lvl`, `killer` and `killer_flags=unique`, but **not** `place`, `ktyp`, `kaux`, `ikiller` or `killermap`, and it **ignores milestones**. Its morgue URL is `${morgueUrl}/${name}/morgue-${name}-${YYYYMMDD-HHmmss}.txt`. It has a bot-name list and race/class renames. **`apps/extractor`** builds crawl with a custom `util/monster/monster-export` (C++, cJSON) that dumps every monster as JSON (id, name, glyph, tile, hd, hp, ac, …). | Server/URL list (most current), bot list, race/class normalization, morgue URL scheme, and the monster-export idea for subprojects 1/3. Its parser has bugs we should not copy: `value.replace('::', ':')` only replaces the first `::`, and splitting on `=` truncates values that contain `=`. | MIT |
| **crawl/go-sequell** | Go loader for Sequell's Postgres. `xlog/xlog.go` is a correct xlog tokenizer (`FindSeparator` skips `::`). `crawl/killer/killer.go` normalizes killer names: hydra heads, `X's ghost`→player ghost, draconian colours, ugly-thing colours, `(shapeshifter)`, named monsters (`Bogdan the orc`→`an orc`), pan lords. `NormalizeKmod` covers zombie, skeleton, simulacrum and spectre. It also handles version parsing and `kaux` normalization. | Port the killer normalizer rules and tests to TS. | MIT |
| **crawl/sequell** (`config/sources.yml`, `config/crawl-data.yml`) | Canonical source list with glob patterns for logfile and milestones per server, including dead servers and morgue URL rules with per-version regexes. `crawl-data.yml` has the branch-name variants across versions, place fixups (`Vault`→`Vaults`, `Shoal`→`Shoals`, `Ice`→`IceCv`…), uniques, and ktyp fixups. Its lists stop at 0.33 (last push 2025-12). | Historical sources, branch and place normalization tables, unique list. | No LICENSE file at the root. Re-derive facts rather than copy files. |
| **crawl/scoring** (Python; CAO scoring pages) | Scoring and tournament scripts. | Little beyond Sequell. | Not stated |
| Misc. morgue parsers (`caiman-dorohedoro/dcss-morgue-parser` TS, `Fuzzwah/dcss-morgue-report` Py, `qvant/dcss_morgue_parser` Java) | Single-user morgue parsing. | Section-splitting ideas, for fork 05. | Various |

The loom.shalott.org `server-xlogs/` mirror (used by dcss-stats) hosts logfiles of
dead servers (CSZO, RHF, CJR).

## 3. Data sources and fields

### 3.1 logfile (one line per finished game)

The writer is `hiscores.cc` (`scorefile_entry::fields_to_string`, `init_death_cause`).
It escapes `:` as `::`. Fields (0.34): `v vlong lv vsav vsavrv explbr tiles name race cls char xl sk sklev title place banisher br lvl absdepth hp mhp mmhp mp mmp bmmp str int dex ac ev sh god piety pen wiz explore start dur turn aut urune nrune fgem igem kills maxskills fifteenskills status gold goldfound goldspent zigscompleted zigdeepest scrollsused potionsused sc ktyp killer killer_flags dam sdam tdam kaux ikiller kpath map mapdesc killermap seed end tmsg vmsg`.

Sample line (CDI 0.34, verified via Range fetch):
```
v=0.34.1:vlong=0.34.1-5-gfd259fce64:lv=0.1:tiles=1:name=…:race=Gargoyle:cls=Fire Elementalist:char=GrFE:xl=2:…:place=D::1:br=D:lvl=1:absdepth=1:…:start=20261012174912S:…:ktyp=mon:killer=a gnoll:dam=5:sdam=5:tdam=5:kaux=a +0 spear:end=20261012175041S:seed=…:tmsg=slain by a gnoll:vmsg=slain by a gnoll (a +0 spear)
```
The average line is about 595 bytes.

- **Where they died:** `place` (`D:10`, `Lair:5`, `Bailey`, `Abyss:1`, `Zig:7`, `Pan`).
  Also `br`, `lvl`, and `absdepth` (absolute depth, useful for cross-branch
  difficulty). `map`/`mapdesc` name the vault the player died in, when there is one.
- **What killed them:**
  - `ktyp` is the kill method. The 0.34 list is `mon pois cloud beam lava water
    stupidity weakness clumsiness trap leaving winning quitting wizmode draining
    starvation freezing burning wild_magic xom rotting targeting death_explosion
    tso_smiting petrification something falling_down_stairs acid curare
    beogh_smiting divine_wrath bounce reflect self_aimed falling_through_gate
    disintegration headbutt rolling mirror_damage spines frailty barbs
    being_thrown collision zot constriction exploremode blinking "death curse"`.
  - `killer` is `mons->full_name(DESC_A)`: `a gnoll`, `Sigmund`, `Foo's ghost`,
    `a yak (shapeshifter)`, `Ghib the pandemonium lord`, `their own shadow`,
    `an ally`, `… (illusionary)`.
  - `killer_flags=unique` is set when the killer is a unique.
  - `ikiller` is the indirect killer, such as the summoner. `kpath` is the blame
    chain (`:`-joined, escaped).
  - `kaux` is the weapon or spell/beam name.
  - **`killermap`** is the vault the killing monster originated from, for example
    `uniq_sigmund` or `uniq_crazy_yiuf_cottage`. It appeared in about 30% of
    sampled lines. Subproject 1 should care: it separates vault-placed killers from
    `mon-pick` random generation.
  - `pois`/`burning` deaths take the killer name from the poisoner or sticky-flame
    source prop. That is a monster for `ktyp=pois` by e.g. a green ugly thing.
- **Pitfalls:**
  - Months in `start`/`end` are **0-based** (`20261012…S` = 2026-11-12). The
    suffix `S`/`D` is std/dst; modern servers write UTC.
  - Filter `wiz=1` and `explore=1` games.
  - Exclude or separate bots (dcss-stats keeps a list: qw, autorobin, …). CDI also
    has separate `crawl-bot-*` logfiles.
  - Treat `ktyp in (quitting, leaving, winning, wizmode, exploremode)` as
    non-deaths.
  - A sample tail showed 26 quits in about 317 lines, and many D:1 quick deaths.

### 3.2 milestones (one line per in-game event)

These are the same character fields plus `type`, `milestone` (text), `time`,
`oplace` (origin place), and `turn`. They are about 6× the logfile size
(≈476 B/line). Types in the 0.34 source (`mark_milestone`):

`begin, br.enter, br.end, br.exit, zig.enter, zig, zig.exit, shaft, abyss.enter,
abyss.exit, uniq, ghost, rune, orb, gem.found, gem.lost, god.*, ancestor.class,
monstrous, sacrifice, death, crash, tesseract.*, dreamshard, mark, zotorb`.

- `br.enter` fires when depth == 1 of a branch. Its `oplace` is the parent level,
  which gives the branch entry depth (e.g. Lair entered from `D::9`).
- `br.end` fires on reaching a branch's last level.
- `shaft` reads "fell down a shaft to D::7", with `place` = origin, so the skipped
  levels are known.
- `uniq` reads "killed Jessica." with a place. This gives free ground truth on
  where uniques are met (useful for fork 05/subproject 1).
- **Denominator inference per game:** for each branch, take the deepest level seen
  in any milestone `place`, `oplace`, shaft target, or the death `place`. Mark
  depths 1..max as reached, minus the levels shafts skipped. Deep Descent and other
  non-shaft drops are not recorded, so there is some error.
- Joining milestones to games: there is no game id. Use the key
  (server, name, `start`), which is present on both. The `begin` milestone also
  exists for every game.

### 3.3 Morgues (per-game text dump)

- `Notes` has a `Turn | Place | Note` table with `Entered Level N of the Dungeon` /
  `Entered a bailey` for every newly created level (`NOTE_DUNGEON_LEVEL_CHANGE`).
  This gives an exact levels-visited set plus the turn of first entry.
- `Dungeon Overview` lists branches and depth ranges.
- `Vanquished Creatures` lists entries like `A hydra (D:10)`, `42 orcs`,
  `2 hornets (D:7)` and the ghost lines. A place appears only when all kills of
  that type happened on one level. This is fork 05's topic.
- Size measured on 8 fetched samples: 6.7–23.8 KB, about 14 KB average.

**Morgue URL** = `<morgue_base>/<name>/morgue-<name>-<YYYYMMDD-HHMMSS>.txt`, using the
logfile `end` with month + 1. I verified it by fetching one morgue each from the
servers marked 200 below.

## 4. Server inventory for 0.34 (HEAD-checked 2026-11-12)

| Server | 0.34 logfile | logfile MB | milestones MB | Morgue base | Morgue status |
|---|---|---|---|---|---|
| CAO | `http://crawl.akrasiac.org/logfile34` (`milestones34`) | 103.7 | 599.5 | `https://crawl.akrasiac.org/rawdata` | 200, but robots.txt **disallows `/rawdata`** |
| CBR2 | `https://cbro.berotato.org/meta/0.34/logfile` | 66.1 | 379.5 | `https://cbro.berotato.org/morgue` | 200 |
| CDI | `https://crawl.dcss.io/crawl/meta/crawl-0.34/logfile` | 75.6 | 380.8 | `https://crawl.dcss.io/crawl/morgue` | 200 |
| CUE | `https://underhound.eu/crawl/meta/0.34/logfile` | 49.1 | 294.9 | `https://underhound.eu/crawl/morgue` | **401 Basic auth** ("find the password where you play"). Do not bypass. |
| CXC | `https://crawl.xtahua.com/crawl/meta/0.34/logfile` | 44.2 | 266.6 | `https://crawl.xtahua.com/crawl/morgue` | 200 |
| CNC | `https://archive.nemelex.cards/meta/crawl-0.34/logfile` | 36.7 | 209.8 | `https://archive.nemelex.cards/morgue` | 200, but robots.txt **`Disallow: /`** for the whole archive host |
| CPO | `https://crawl.project357.org/dcss-logfiles-0.34` (`dcss-milestones-0.34`) | 16.8 | 93.7 | `https://crawl.project357.org/morgue` | 200 |
| CRG | `https://crawl.roguelikes.gg/meta/0.34/logfile` | 10.7 | 48.6 | `https://crawl.roguelikes.gg/morgue` | 200 |
| CBRG | `https://crawl-br.roguelikes.gg/meta/0.34/logfile` | 9.6 | 47.8 | `https://crawl-br.roguelikes.gg/morgue` | not tested (same software as CRG) |
| LLD | `http://lazy-life.ddo.jp/mirror/meta/0.34/logfile` | 7.3 | 50.4 | Sequell says `http://lazy-life.ddo.jp:8080/morgue-0.34` | **404**. Location unknown. |
| CWZ | `https://webzook.net/soup/…` | — | — | — | **dead** (connection fails) |
| CKO, CDO, CSZO, CJR, RHF, CBRO | old versions only | — | — | various | dormant |

Every live server returned `Accept-Ranges: bytes` and served `206` for Range
requests. Tested on CDI and CAO. None compress the response.

Trunk is a separate file per server (`…/git/logfile`, `logfile-git`, `…/trunk/…`,
`dcss-logfiles-trunk`). It contains `v=0.35-a0` now, and `0.34-a0` games from before
the 0.34 branch point (0.35-a0 was tagged 2026-01-26). The 0.34 release files also
contain `0.34-b1` games. 0.34.0 was released 2026-02-05 and 0.34.1 on 2026-03-14.

**Totals (HEAD of about 180 logfile URLs, all versions and servers):** about
8.27 GB of logfiles (4.09 GB release, 4.17 GB trunk). At 400–600 B/line that is
about 14–18M games. 0.34 is 420 MB, about 700k games in about 9 months. The
milestones ratio is about 5.7×, so roughly 47 GB for everything and 2.37 GB for
0.34.

## 5. Ingest strategy

1. **Source registry:** a checked-in `sources.yaml` modelled on dcss-stats `seedData`
   and Sequell `sources.yml`. Each entry has server, version label, kind
   (logfile/milestones), URL, morgue base, `morgue_allowed` flag and `dormant` flag.
2. **Raw mirror:** keep the remote files as a byte-exact mirror, e.g.
   `raw/<server>/<version>/{logfile,milestones}`. Each sync does:
   - HEAD, then compare `Content-Length`. If it grew, send `Range: bytes=<local>-`.
   - If it shrank, or the last 1 KB overlap no longer matches, treat the file as
     rotated and re-fetch it in full.
   - Track `parsed_offset` = the last newline, so a partially written final line is
     not parsed.
   - Poll daily. That is ample for a static site; dcss-stats uses 5–25 min.
   - Dormant versions are fetched once.
3. **Politeness:**
   - Send one request at a time per host. Use a fixed generic User-Agent that names
     the project and a project URL, with no personal info.
   - Throttle the backfill to a few MB/s per host, and back off on 429/5xx.
   - The 0.34 backfill is about 2.8 GB total. The full-history backfill is about
     55 GB. Spread it over days, or get admins to say it's fine.
   - Respect robots.txt and auth.
4. **Dedup:** game key = `sha1(server|name|start)`, as Sequell and dcss-stats do.
   Mirrored archive copies of dead servers map to the canonical server code, so
   duplicates collapse. Duplicate lines inside a file (rare re-appends) are also
   handled by the key.
5. **Version handling:** `v` gives the major (`0.34`) and a qualifier
   (`release` | `b1` | `a0`). Store `vlong` too. The webapp's "0.34" bucket should
   be release + beta from the 0.34 files. `0.34-a0` trunk games are optional,
   off by default.
6. **Morgues (limited):** fetch only for (a) a stratified sample used by fork 05 and
   to validate the denominator inference, and only (b) from servers where
   `morgue_allowed`. Fetch 1 request/s per host at most. Cache forever, since
   morgues are immutable, and record 404s.
   - **Cost:** about 14 KB per morgue. All 0.34 games would be ≈10 GB and ≈700k
     requests (about 1 day across 8 hosts at 1 rps). All history would be about
     200 GB, which is not reasonable.
   - Skip D:1–D:2 sub-1000-turn games, which are most of the volume and carry
     little signal.

## 6. Parsing and normalization

- **xlog tokenizer:** scan left to right. `::` is a literal `:`, and a lone `:` ends
  the field. The first `=` in a field splits key from value, and the value may
  contain `=`. Unescape every `::`, not just the first. Port go-sequell's
  `FindSeparator` and its tests.
- **Place:** `D::10` becomes `D:10`, giving `{branch, depth|null}`. Apply Sequell's
  place fixups for old versions (`Vault`/`Vaults`, `Shoal`/`Shoals`, `Ice`/`IceCv`,
  `Hive`, `Forest`, `Depths`, `Lab`…). Branch depths change between versions; for
  example, D was shortened and Depths was added. Store `absdepth` as well.
  Portals (`Bailey`, `Ossuary`, `Sewer`, `IceCv`, `Volcano`, `WizLab`,
  `Desolation`, `Gauntlet`, `Bazaar`, `Trove`, `Necropolis`, `Arena`, `Crucible`)
  have no depth.
- **Death category from ktyp:**
  - *monster-attributable*: `mon, beam, pois, cloud (if killer set), freezing,
    burning, death_explosion, constriction, headbutt, acid, draining, rolling,
    spines, water (if killer set), being_thrown, collision, reflect,
    disintegration, curare, barbs, mirror_damage, petrification(if killer)`.
  - *environment/self*: `lava, trap, starvation, falling_*, self_aimed, targeting,
    wild_magic, zot, blinking, frailty, stupidity/weakness/clumsiness, rotting,
    death curse, something`.
  - *divine*: `xom, tso_smiting, beogh_smiting, divine_wrath`.
  - *non-death*: `quitting, leaving, winning, wizmode, exploremode`.
  - Store the raw ktyp and keep the category as a derived column, so the webapp can
    let users toggle.
- **Killer → canonical monster key** (needs a shared table from subproject 1):
  - Strip the article (`a`/`an`/`the`) and suffixes: ` (shapeshifter)`,
    ` (glowing shapeshifter)`, ` (illusionary)`, ` the pandemonium lord`.
  - Pull out derived-undead modifiers (`… zombie`, `… skeleton`, `… simulacrum`,
    `spectral …`), giving key = the derived type (`zombie`, …) plus `base`.
  - Normalize hydra heads, draconian colours (`a red draconian shifter` →
    `draconian_shifter`, `a red draconian` → `red_draconian`) and ugly-thing
    colours.
  - `X's ghost` → `player_ghost`. `X's illusion` → `player_illusion`.
  - Uniques match by exact name, using `killer_flags=unique` as a hint.
  - Named non-uniques (`Bogdan the orc`) take the part after ` the `.
  - `an ally` and `their own shadow` → special keys.
  - Prefer `ikiller` when the blame chain shows a summon? Decision: keep both. The
    direct killer is the default; summoner credit is an optional view.
  - Emit an "unmatched killer strings" report per run, so gaps in the table show up
    at once.
  - **Needs from subproject 1:** a per-version JSON table of
    `{key (MONS_* lowercased, e.g. orc_warrior), display_name, plural (from the
    crawl pluralise logic, for fork 05), is_unique, genus/base}`. It should be
    generated from a built crawl like dcss-stats' `monster-export`, so names match
    `full_name()` exactly.

## 7. Language and storage

- **TypeScript (Node 22)** for fetch + parse + aggregate:
  - Throughput is bounded by polite network rates (MB/s), not parsing. A streamed
    TS xlog parser handles 50–100 MB/s, so the whole 55 GB corpus parses in well
    under an hour once mirrored.
  - Monster and place types can be shared with the webapp (zod schemas in a shared
    package).
  - The user is fluent in TS, and dcss-stats (TS) is the closest reference.
  - Rust is only worth it if we later re-parse 200 GB of morgues often; if so, a
    Rust morgue parser could be added as a separate CLI later.
- **Storage:** raw mirror on disk, which is the source of truth and lets us re-parse
  at any time. Parse into **DuckDB** through `@duckdb/node-api`: columnar, a single
  file, fast GROUP BYs over about 15M games and about 80M milestones (only the
  useful types need keeping). Export **Parquet** snapshots if other tools need them.
  No Postgres server is needed.
- **Output to the webapp:** small, additive count tables, so composites across
  versions can be summed on the client:
  - `deaths.json`: `{version, branch, depth, killer_key, death_category, n}`
  - `reached.json`: `{version, branch, depth, games_reached, games_started}`
  - `deaths_by_place.json`: `{version, branch, depth, ktyp, n}`, covering all causes
  - optional `killer_vault.json`: `{version, killer_key, killermap, n}`

  Shard these per version. The final layout is settled in 04-architecture.

## 8. Data model (DuckDB)

```
source_file(server, version_label, kind, url, bytes_mirrored, parsed_offset, last_modified, etag, last_sync)
game(game_id PK, server, name, start_ts, end_ts, v, v_major, v_qual, vlong, tiles, race, cls, char, god, xl,
     turn, dur, place_raw, branch, depth, absdepth, ktyp, death_category, killer_raw, killer_key, killer_mod,
     ikiller_raw, ikiller_key, kpath, kaux, killer_flags, killermap, map, sc, kills, nrune, wiz, explore,
     is_bot, seed, morgue_url, source_file_id, line_offset)
milestone(game_id FK, time_ts, type, place, branch, depth, oplace, text)  -- only br.*, shaft, abyss.*, zig*, uniq, rune, orb, begin
game_level_reached(game_id, branch, depth, source 'milestone_inferred'|'morgue_notes', first_turn NULL)
morgue_fetch(game_id, url, status, bytes, fetched_at, local_path)  -- parsed by fork 05
killer_unmatched(v_major, killer_raw, n)
```

## 9. Interfaces with other subprojects

- **← Subproject 1 (monster sampling):** the canonical monster key set and name table
  per version (above). Use the same place encoding, `{branch, depth}` with branch
  codes as in logfile `br`. In return, subproject 2 provides `killermap` frequencies
  and `uniq` milestone places, as calibration data for vault and unique placement.
- **→ Subproject 3 (webapp):** the additive count tables in §7, plus a branch/depth
  structure per version (max depths, which can be derived from the data or from
  subproject 1).
- **→ Fork 05 (kill calibration):** morgue URLs, the fetch queue/cache, levels-visited
  from Notes, and the sampling frame (games per version/place).

## 10. Risks and ethics

- **Servers run on volunteer resources.** Logfile and milestones fetching is
  ecosystem-standard (Sequell, dcss-stats, scoring and tournament bots all do it),
  so incremental Range fetches are low-impact. The one-time backfill (about 55 GB
  for all history) is not, so rate-limit it or ask.
- **robots.txt:**
  - CAO disallows `/rawdata` (morgues) for all agents; logfiles are not disallowed.
  - `archive.nemelex.cards` disallows everything. dcss-stats and Sequell still pull
    its logfiles, but we should ask the CNC admin.
  - CUE morgues require a password on purpose. Never automate around that.
- **This spike:** about 25 HEAD requests, about 1 MB of logfile/milestone Range
  reads, and one morgue each from CAO, CBR2, CDI(×2), CXC, CNC, CPO and CRG. The CAO
  and CNC morgue fetches were before I read their robots.txt; I won't repeat them.
- **Player names are public on these servers.** The webapp should publish only
  aggregates, not per-player pages, unless that is decided deliberately.
- **Coverage bias:** some servers have no usable morgues. Morgue-derived stats are
  then a biased sample (by server, so by region and player pool). Logfile/milestone
  stats cover all servers.
- **Format drift:** the killer naming, branch set and ktyp list change across
  versions. The unmatched-killer report and per-version tables mitigate this.

## 11. Open questions for the user

1. Should we contact server admins (on the DCSS Discord or #crawl-dev) before the
   backfill? The CAO, CNC and CUE morgue restrictions effectively require it if we
   want morgues from the three biggest pools.
2. **Scope of history:** just 0.34 now (about 2.8 GB to mirror), or backfill all
   versions immediately (about 55 GB)? I'd start with 0.30+.
3. Should "killed by" credit the direct killer or the summoner/blame-chain root
   (`ikiller`) by default?
4. Should bots, quits, and very short games (e.g. under 1000 turns on D:1) be
   excluded by default?
5. Is a milestone-inferred "reached level" denominator acceptable, given it is
   validated against morgue Notes on a sample? Or do we require morgue-exact
   denominators, which shrinks us to the morgue-accessible servers?
6. Should trunk games (`0.34-a0`) count toward the 0.34 bucket?
