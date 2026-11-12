# 05 — Kill-list calibration (stretch goal 2c)

Using morgue "Vanquished Creatures" lists (plus the Notes and vault-list sections) as real-play data to check and correct subproject 1's sampled encounter rates.

## Summary

- **Morgue kill lists are aggregated over the whole game.** The only per-place detail is a level tag, and it appears only when every kill of that monster type happened on one level. In four real 0.34.1 mid-game morgues, **only 11–26% of kills had an exact place** (early deaths will score higher).
- **The rest of the morgue fills a lot of the gap:**
  1. **"Levels and vault maps discovered"** is in the default dump at game end. It gives the exact set of levels each game generated and visited, and which vaults were placed on each. This is also direct validation data for subproject 1's vault modelling.
  2. **Notes** give `Encountered X` / `Killed X` with turn and place, but only for uniques, player ghosts, Pan lords and monsters at "nasty" threat for the character's XL. That is the dangerous tail we care most about.
  3. The death place and killer come from the logfile (subproject 2).
- **Recommended method:** treat each game's kill counts as Poisson counts spread over its known visited levels. Disaggregate them with EM, using subproject 1's expected-generated counts as the prior/offset. The output is a per-(monster, place) **kill fraction ρ = killed / generated**. That gives calibrated "faced" estimates and flags gaps in the generator model.
- **A useful side result:** play data alone gives a per-place **exchange ratio**, deaths / (kills + deaths), with no generator needed. It's a strong secondary deadliness metric for the webapp.
- **Phasing:** not needed for v1. Do it in v1.x once logfile ingest exists. For 0.34, the full set is about 300–450k morgues, roughly 5–7 GB raw (about 1–1.5 GB gzipped), and ~7 h of polite fetching. A 30–50k stratified sample is enough for D, Lair and Orc.

## Morgue evidence

Source: `crawl-ref/source/kills.{h,cc}`, `chardump.cc`, `notes.cc`, `mon-death.cc`, `mon-util.cc`, `player-notices.cc`, `initfile.cc` at tag `0.34.0`. Samples: four 0.34.1 morgues fetched 2026-11-12 from CDI (×2), CNC and CRG, saved in `scratchpad/kc-samples/`. Each was 15–36 KB. The format was identical across servers.

### What is recorded per kill

- `KillMaster` keeps three categories: **you**, **collateral kills** (allies/pets), and **others** (killed by other monsters, environment, etc.). Each is dumped as its own `Vanquished Creatures (…)` block, followed by `Grand Total`.
- Each kill record has:
  - a key `kill_monster_desc{monnum, modifier}`, where modifier is one of NORMAL, ZOMBIE, DRAUGR, SIMULACRUM, SPECTRE or SHAPESHIFTER. For derived undead, `monnum` is the base species, so "orc zombie" → (orc, ZOMBIE).
  - a `kill_def{kills, exp, places}`. `places` holds up to `PLACE_LIMIT = 5` distinct levels, with **no per-place counts**.
- **What doesn't get recorded:**
  - Summoned monsters, timeouts, resets and tentacle segments. The guard is `leaves_corpse = !summoned && !timeout && !mons_reset && !tentacle_segment`.
  - "Firewood" (plants, fungi and similar) is filtered at dump time.
  - So a kill list is roughly **naturally generated monsters that died while you were on their level**. That is the right population for comparing against a generator.
- **Player ghosts** are recorded separately, one entry each with its place. Pan lords get kill counts such as "(twice)".
- **Dump format** is controlled by the `dump_kill_places` option. The default is `KDO_ONE_PLACE`, which shows `(Place)` only if exactly one distinct place was recorded, or the monster is unique. `all` shows up to 5 places; `none` shows none.
  - So a line without a place means the monster was killed on **≥2 distinct levels**. That is useful censoring information.
- **Pitfalls:**
  - **Plurals:** names are pluralised irregularly ("meliai", "efreet", "ufetubi", "cyclopes"), so we need a reverse plural map generated from crawl's `pluralise_monster`.
  - **Name suffixes and modifiers:** suffixes such as `(shapeshifter)`, and forms such as "redback simulacrum" or "spectral …".
  - **Player config:** players can change the output with `kill_map` (merging categories), `dump_kill_places`, a Lua `c_kill_list` override, or a custom `dump_order`. Detect anything non-standard and drop it.
- Places look like `D:15`, `Lair:3`, `Spider:1`, `Orc:2`, and portals print bare (`Ossuary`, `IceCv`, `Volcano`, `Necropolis`).

Measured share of kills with an exact place (category "you"):

| morgue | XL / death place | kills with place | levels visited |
|---|---|---|---|
| goodsiyeol (CNC) | 11 / D:12 | 59 / 239 (25%) | 13 |
| kamyn (CRG) | 14 / Lair:5 | 47 / 442 (11%) | 18 |
| CowboyBob (CDI) | 15 / D:14 | 109 / 689 (16%) | 21 |
| thesilentllama (CDI) | 16 / Spider:1 | 102 / 441 (23%); collateral 87 / 334 | 23 |

Common monsters (orcs, yaks, killer bees) almost never carry a place. Rare ones (uniques, single out-of-depth kills) usually do. A naive analysis using only placed lines would therefore be **heavily biased**. The censoring has to be modelled (see Method).

### Other sections that help

| Section | Default in 0.34? | Per-place? | Use |
|---|---|---|---|
| `Levels and vault maps discovered:` (`vaults`) | **yes** (dumped at game end) | per level | Exact visited-level set for each game (the exposure covariate), plus vault names per level. Lets subproject 1 check vault frequency, and lets us condition on vault-placed monsters (e.g. `uniq_duvessa`, `orc_0_dummy`). |
| Notes (`notes`) | yes | per note: turn + place | `Encountered X` (first sight of a notable hostile) and `Killed X`. Notable means a unique, a player ghost/illusion, a Pan lord, or **threat = NASTY**: `exp_value / (1 + sqrt(exp_needed(XL)/30)) > 32`. Gives **true encounters, not just kills**, for the dangerous tail. "Entered Level N" is noted only for D:5/10/15…, branch entry and branch end, and portals. Note turn stamps give a rough place-over-time trace. |
| Dungeon Overview | yes | per branch | Levels seen per branch; consistency check. |
| `turns_by_place` | **only in alpha/trunk builds by default** | per branch, plus "Top non-repeatable levels by time" (top 15 levels) | Time spent per level as an exposure weight. Available for 0.35-a0 trunk games, not 0.34 releases (none of the 4 samples had it). |
| `kills_by_place` | no (opt-in) | per branch, % only | Rare; ignore. |
| `monlist` | yes | death level only | Monsters in view at death; context for the killer. |
| Action / skill tables | yes | by XL | Not place data. |

Prior art: dcss-stats (MIT) fetches morgues only on demand for an experimental "suggest" feature and **does not parse kill lists**, so we have nothing to reuse there. Its `apps/extractor` drives crawl's `util/monster/monster-export` to build a monster catalog, which is relevant to the canonical-ID work (04/01).

Verified URL detail (for 02): the logfile `end=20261012174220S` uses a **0-indexed month**. The morgue filename uses a 1-indexed month: `morgue-<name>-20261112-174220.txt`.

## Method

### Observation model

For each game g there are three kinds of input:

- **Visited levels** `V_g`, from the vault list. Exposure `e_{g,p}` is 1 per visited level by default. The death level is downweighted (e.g. 0.5, or estimated from note turn stamps). Trunk games can use actual time.
- **Kill-list entries** for each (monster key m, category c):
  - **exact:** count n, single place p, so `K_{g,m,p} = n`;
  - **censored:** count n, no place, so `Σ_{p∈V_g} K_{g,m,p} = n`, with at least 2 places nonzero;
  - **absent:** `K_{g,m,p} = 0` for every p in V_g.
- **Notes** with exact place for notable encounters/kills, plus death place and killer from the logfile.

### Model

`K_{g,m,p} ~ Poisson(e_{g,p} · θ_g · μ_{m,p} · ρ_{m,p})`, where:

- `μ_{m,p}` is subproject 1's expected number of m generated per visit to p. That includes the initial population, vault placements and wandering spawns over typical time spent. Treat it as a fixed offset (or carry its sampling variance).
- `ρ_{m,p}` is the **kill fraction**: what share of generated m at p a typical player kills (including allies, category you+collateral).
- `θ_g` is a per-game "thoroughness" random effect (log-normal). It absorbs playstyle: full-clear vs stealth/dive, ally-heavy gods, bots. Optionally regress it on species/background/god/XL, or on logfile flags like `tiles`/`bot`.
- `log ρ_{m,p} = α + β_{m} + γ_{branch(p)} + δ_{m,p}`, with partial pooling across monsters (by traits: speed, flies/swims, wanders vs sleeps, band member, stealth-checking) and across depths. This is what makes rare cells estimable.

### Fitting

Fit with **EM / data augmentation**:

- **E-step:** split each censored count n across `V_g` as multinomial(n; π_p ∝ e·θ·μ·ρ). The "≥2 nonzero" condition can be handled exactly with a small correction, or ignored at first since it rarely matters for common monsters.
- **M-step:** Poisson GLM / closed-form rate updates.

Identifiability comes from the structure of the data:

- Games that died on D:1–D:3 pin early-floor rates.
- The near-triangular visit order (D:1…k) plus variation in branch order (Lair vs Orc first, Swamp vs Shoals, etc.) separates the remaining levels.
- Exact lines and notes add hard anchors.

Run it in Python (NumPy, or NumPyro/Stan for full posteriors) offline. It's batch analysis, not a hot path.

### Outputs

- **`ρ̂_{m,p}` with a credible interval.** Calibrated expected kills per visit = `μ·ρ̂`.
- **Generator-gap diagnostics.** If ρ̂ is clearly greater than 1, generated counts are underestimated: missing spawn sources, followers coming down stairs (kills are attributed to the level where the monster died), vaults, or ally kills.
- **Empirical encounter lower bound:** kills + deaths caused at that place.
- **Exchange ratio** `D_{m,p} / (K̂_{m,p} + D_{m,p})`, where D is deaths from the logfile. This approximates P(player dies | fight to the end with m at p). It needs no generator at all, so it doubles as a cross-check on the primary metric (see 04).

### Is "killed" a decent proxy for "faced"?

Partly, and in a biased way:

- **Good proxy:** the dangerous monsters that end runs mostly get fought (killed or killed-by), and the notes give true encounters for NASTY-threat monsters and uniques.
- **Undercounts:**
  - fled-from monsters (stairs, blinking away);
  - monsters avoided by stealth (sleepers);
  - monsters still alive when the player left or died;
  - fast or invisible monsters that escaped.
  - These are typically 10–50%+ for dive/stealth playstyles, absorbed by θ_g.
- **Overcounts relative to the level:** followers killed on the next level, and collateral kills by allies of monsters the player never saw.
- **Recommendation:** "faced" ≈ **kills (you + collateral) + deaths**, treated as a lower bound. Report generator-based "expected present" and play-based "expected fought" side by side rather than claiming either is the truth.

## Combining with subproject 1 (concrete sketch)

1. Subproject 1 emits `μ_{m,p}` (mean, variance, n_samples) per version. It should **exclude summons** (kill lists exclude them) and attribute vault-placed monsters to their vault, so we can condition on vault presence from the morgue.
2. Subproject 2 emits a per-game table `(game_id, version, visited_levels[], vaults_by_level, death_place, killer_key, kill_entries[(key, modifier, category, count, place|null)], notable_notes[(turn, place, kind, key)])`.
3. A new `calibration` step (Python, its own subfolder) fits ρ per version (with pooling across versions to help sparse cells). It emits `calibrated_encounters[(version, place, key)] = {generated_mu, kill_rate, kill_rate_ci, exchange_ratio, n_games_visited}`.
4. The webapp shows the calibrated numbers and falls back to the generator prior where data is thin.

Minimum useful volume: about 100 effective kills per cell for ~10% standard error. With kill rates of 0.1–1 per visit for a native-depth monster, that needs ~100–1000 visits per place.

- Every game visits D:1, but only a few percent reach Zot, and fewer still the hells or Pan.
- **~30–50k morgues** (stratified to oversample games that reached Depths/Zot) are enough for D, Lair, Orc and the Lair branches.
- The **full 0.34 corpus** is needed for Zot, Vaults:5, hells and Pan, and the posterior will still lean on the prior there.

## Data needs and cost

- **Volume:** 0.34 logfiles are 75.6 MB on CDI, 49.1 MB on CUE, 36.7 MB on CNC and 10.7 MB on CRG, at about 610 B per line. That's **~280k games on these four servers**, so probably **300–450k** across all servers.
- **Fetch filter:** drop quits with very few turns and ktyp `leaving`/`quitting` with turn < ~500. Keep early real deaths, because they pin early floors.
- **Size:** samples were 15–36 KB for XL 11–16. Early deaths are smaller (est. 6–12 KB). Average ~15 KB, so **~5–7 GB raw, ~1–1.5 GB gzipped**. Keep raw morgues (compressed) so we can reparse without refetching.
- **Fetch time:** about 2 req/s per server across ~8 servers is ~16 req/s, so **~7 h** for the full corpus, ~1 h for a 50k sample. After that it's incremental: only new games from logfile tails.
- **Parsing:** only three sections matter (Vanquished, Notes, vault list). Easy in any language. It belongs in subproject 2's parser, with the same canonical-key normalization as killer names plus the reverse-plural table.

## Recommendation on phasing

- **v1 (0.34 MVP):** skip calibration. Still have subproject 2's parser store kill entries, visited levels and notes whenever it does fetch a morgue, so nothing has to be refetched later.
- **v1.x:** fetch a stratified ~50k sample of 0.34 morgues, fit ρ, and ship generator-gap diagnostics internally. Expose the exchange ratio in the webapp, which only needs per-place kills and is the cheapest high-value result.
- **v2:** run on the full corpus across versions. Use trunk (0.35-a0) games' `turns_by_place` for real exposure weights.
- **Optional upstream PR** to crawl: dump per-place kill counts (`kill_def` already tracks places, just not counts per place), or turn on `turns_by_place` in releases. A small patch, but it only helps future versions.

## Open questions for the user

1. Is a Python step for the statistical fit acceptable? It's batch, offline, and has the best tooling (NumPyro/Stan). Or must everything be TS/Rust?
2. Should the webapp present "generated (sim)" vs "fought (play)" encounter counts side by side, or only the calibrated blend?
3. Should we exclude bot accounts (dcss-stats keeps a bot list, e.g. `gbos`, `a3bot`) and/or speedrun-style games from calibration? They distort θ.
4. Is a full morgue crawl (~400k requests for 0.34 alone) OK etiquette-wise, or should we cap at a stratified sample and/or contact server admins first?
