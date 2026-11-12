# 01 — Monster encounter sampling (levelgen)

Goal: for each (version, place, monster), estimate how many of that monster a typical character meets on a visit to that place.

Everything below was verified against **0.34.1** (`1eebc1a289`) on macOS (arm64, 16 cores) unless marked otherwise. The spike artifacts live in the session scratchpad and will not persist; the commands needed to recreate them are listed in §4.

## 1. Summary

- **Simulate, don't parse.** Monster populations come from `mon-pick-data.h` tables *plus* bands, vaults (`dat/des`, Lua-driven), uniques and depth fuzz. Vault-placed monsters alone are 25–35% of a level's population (objstat `NumVault`: D:3 6.1/23.1, D:12 9.2/26.2). The vault code also changes heavily between versions: 207 files changed in mons/des between 0.33 and 0.34. A static parser would have to reimplement the vault system, so it's not viable.
- **Since 0.21, connected branches have no ongoing random spawns.** `spawn_random_monsters()` only fires in the Abyss, in Pan and on the orb run. Outside those, a level's monster set is (≈) fixed at generation time. Generation-time sampling therefore captures nearly everything a player can meet in D, Lair, Orc, Vaults, Depths, Zot, etc. The remaining sources are summons, followers, ghosts, god and Xom effects, and polymorph.
- **Recommended tool: a ~70-line Lua script run by a stock crawl build.** It is run as `crawl -script`, on top of the in-tree `dat/dlua/explorer.lua` (which backs `seed_explorer.lua`).
  - It uses the **real pregen code path**: `branch_generation_order`, the per-seed branch selection (2 of 4 Lair sub-branches), and the portals that the seed actually places.
  - It emits one JSON line per generated level.
  - No C++ patch is needed. The script itself must be GPLv2+.
  - Measured: **~3.0 s per seed for the whole connected dungeon** (≈90 levels incl. Hells and portals). 8 processes ran in parallel without conflicts: 40 seeds (3,604 levels) in 16 s.
  - 10k seeds per version takes about **35 min on 16 cores**.
- **objstat** (`-objstat`, needs `DEBUG_STATISTICS`) works and is fast: 29 ms/level on a release build. It is only a secondary tool, for three reasons:
  - It outputs pre-averaged TSV (2 dp, lossy for merging).
  - It drops non-XP monsters (plants, fungi, bushes) and the base type of derived undead (everything becomes "zombie").
  - It generates branches in the wrong order and builds all 4 Lair sub-branches. Shared state, especially uniques, therefore diverges from real games outside D/Lair.
  It remains useful for places pregen doesn't build: **Abyss, Pan, Zig, Hell vestibule, Trove**.
- **Seeded reproduction of a dead character's levels works** (coordinator Q1). The details are below.
  - `-seed N` with the explorer path gives byte-identical monster lists to the real pregen.
  - objstat with `-seed` matched the explorer on D:1–15 and Lair:2. It diverged on Orc:1, Vaults:3 and Depths:4.
  - Cost: ~0.1 s startup + ~30 ms per level, so ~1–3 s per character.
  - Morgues include the **"Levels and vault maps discovered"** section by default. This lets us verify reproduction per game by comparing vault names per level.

## 2. How DCSS 0.34 generates monsters (what matters for "expected encounters")

Ranked by contribution to what a player faces in connected branches:

1. **Level-generation population** (`dungeon.cc` builder → `mon-place.cc`):
   - Tables in `mon-pick-data.h` give per-branch `{minr, maxr, weight, shape(FLAT/PEAK/SEMI/FALL), MONS_*}` entries.
   - **Depth fuzz** (`_ood_fuzzspan`): 14% of picks roll a left-weighted fuzz, so ~6% end up deeper.
   - **Bands** are a large share of counts (goblin/orc/gnoll/jackal packs, yak herds, Orc:1 warbands).
   - The simulator captures all of these automatically.
2. **Vault/des-placed monsters**:
   - These include `KMONS`/`MONS` lines, Lua, monster-heavy vaults, branch ends, and the `uniques.des` placement.
   - They are 25–35% of counts and dominate rare and out-of-depth threats (e.g. D:15 in the spike had a flayed ghost, a guardian sphinx zombie and spriggan berserker zombies, all from vaults).
   - Simulation is the only practical way to get these.
3. **Uniques**: placed at levelgen, at most once per game (`you.unique_creatures`). Their frequency depends on generation *order*, which is why objstat's order bug matters.
4. **Portals** (Sewer, Ossuary, IceCv, Volcano, Bailey, Gauntlet, Bazaar, WizLab, Desolation):
   - The explorer generates them only when the seed's level actually contains the entrance. That gives a realistic per-game portal probability: 40 seeds gave Sewer 11, IceCv 27, Volcano 17, and so on.
   - Portal *expiry* means a player may never enter one. Normalise by portal visits from milestones, not by games.
   - Trove isn't pregenerated, and Zig is generated level by level on entry. Use objstat for both.
5. **Abyss / Pan**: dominated by **ongoing spawns**.
   - Abyss: rate 5 (≈1 spawn per 5 turns), ramping up sharply after Abyss:5. Halved with the `slow_abyss` passive.
   - Pan: rate 50, with `mons_alloc` picks.
   - A levelgen snapshot alone is meaningless here. Expected encounters ≈ spawn rate × turns spent. Turns-per-place isn't in release morgues; `turns_by_place` is alpha-only, so this needs an open decision. Recommendation: show deaths only for these, with no λ, in the MVP.
6. **Orb run**: spawns at rate 18 (36 with `slow_orb_run`) near the player. These are separate from Zot/D levelgen. Model them as a separate "orb run" pseudo-place if wanted (milestone `orb` gives entry).
7. **Not capturable by levelgen sim**. Show deaths for these anyway; λ is undefined or "n/a":
   - **Summons**: logfile `ikiller`/`kpath` give the summoner, so attribute to the summoner.
   - Monsters following the player across stairs.
   - **Player ghosts**: from server bones files. Offline they fall back to a mirrored player.
   - Shapeshifter forms, polymorph, god wrath, Xom, allied betrayal.
   - Hell effects no longer exist in 0.34.

**"Generated" vs "faced"**: the sim gives *generated per level instance* (λ_gen). A player doesn't meet everything. They skip unexplored corners, stairdive, and leave sleeping monsters. Three morgue sections give calibration data (see 05-kill-calibration.md):
- The **xp_by_level** table: per-level count of monsters killed, split into vault and non-vault.
- **Vanquished creatures**: per-monster totals. Places are given only when the kill was at a single place, or always for uniques; `PLACE_LIMIT` = 5.
- The vault list.

Recommended model: λ_faced(P,m) = f(P, class(m)) · λ_gen(P,m).
- f is an "encounter fraction", estimated from per-level kill totals versus the sim's total per level.
- Per-monster refinement comes from vanquished lists. For the MVP, publish λ_gen and label it "monsters generated per visit".

## 3. Approach comparison

| | (a) Static table parser | (b1) stock `-objstat` | (b2) **Lua sampler via `-script`** (recommended) | (b3) patched C++ objstat |
|---|---|---|---|---|
| Captures vaults/bands/uniques | No (bands partial) | Yes | Yes | Yes |
| Real branch selection & gen order | No | **No** (all 4 Lair subbranches; `branch_iterator` order) | **Yes** (`explorer.generation_order` + `dgn.br_exists`) | If we reimplement it |
| Output | — | Averaged TSV (2dp), per level + per branch + AllLevels | Raw JSONL per level instance | Whatever we want |
| Derived monster base ("orc zombie") | — | Lost (`zombie`) | Yes (`type_name`=zombie, `name`=orc zombie) | Yes |
| Non-XP monsters (plants, etc.) | — | Excluded | Included (filterable) | Configurable |
| Seeded per-game reproduction | No | D/Lair only | **Yes** (matches seed_explorer exactly) | Yes |
| Code we maintain | Big, per-version | None | ~70 lines Lua | C++ patch per tag (rebase risk) |
| Version coverage | — | objstat exists ≥0.20 | `seed_explorer.lua` & same Lua API exist **≥0.24** | any |
| Speed | instant | 29 ms/level | ~33 ms/level (3 s/seed) | ~29 ms/level |

The Lua API (`l-mons.cc`, stable since 0.24, 37 `MDEF`s) exposes:
- `name`, `base_name`, `full_name`, `type_name`, `db_name`, `unique`, `hd`, `experience`, `wont_attack`, `in_local_population`, `shapeshifter`, `dancing_weapon`, `get_info()`.
- Per-position `dgn.in_vault(x,y)`.
- `debug.vault_names()` per level.

It does **not** expose the `monster_type` enum. The key mapping is done from names via the catalog (see §6).

**Language:**
- The sampler is Lua, run inside crawl. It is a GPL piece, so keep it in a GPL-licensed `levelgen/` subproject.
- The orchestrator does the following: build each tag, copy the script into `crawl-ref/source/scripts/` (`-script` only searches there), fan out N processes over seed ranges, and gzip the outputs.
- Write the orchestrator in **TS (node)**, which the user knows best. It is small and shells out to crawl, so Rust brings no benefit.
- Aggregation (raw JSONL → per-version λ tables) can live in the same TS package or the shared aggregator.
- No C++ is required unless we want the exact-plural catalog (§6), which is a small `util/` main.

## 4. Feasibility spike (done)

Build (0.34.1, console, no tiles):
```sh
git worktree add crawl-034 0.34.1
git submodule update --init --depth 1 crawl-ref/source/contrib/{lua,sqlite,zlib}   # pcre not needed
python3 -m venv venv && venv/bin/pip install pyyaml      # ≥0.32: mon-data.h etc. are generated from YAML
cd crawl-034/crawl-ref/source
PATH=$VENV/bin:$PATH make -j16 EXTERNAL_DEFINES=-DDEBUG_STATISTICS   # 44 s wall; the Lua path doesn't even need the define
make util/fake_pty                                                    # console crawl needs a pty for -script
./crawl -builddb                                                      # once; else objstat aborts "des cache is not initialized"
```
`make FULLDEBUG=y DEBUG=y` (optimised, with asserts) also works. It took 80 s to build, ran ~20% slower, and enables `DEBUG_STATISTICS` automatically. `make debug` is `-O0` + coverage; avoid it.

macOS gotchas:
- `pyyaml` is required from 0.32 on.
- The zlib/lua/sqlite contribs must be initialised, or install the deps natively.
- zsh mangles `git show $t:path` (`:c` modifier). Use `"${t}:path"`.
- Nothing else; clang builds cleanly.

objstat runs:
- `crawl -objstat D -iters 10`: 150 levels in **5.5 s** (FULLDEBUG).
- `crawl -objstat -iters 3`: whole game, 146 levels × 3, in **15.3 s** (FULLDEBUG) or **12.8 s** (release).
- Output is `objstat_Monsters.tsv`, with columns `Monster Level Num NumVault NumInBranch NumMin NumMax NumSD NumOOD MonsHD MonsHP MonsXP TotalXP TotalXPVault RelativeDepth DistanceOOD`. Values are per-iteration means.
- Levels are per-level (`D:03`), per-branch (`D`) and `AllLevels`.
- Recording happens once per built level (`dbg-maps.cc:_do_build_level` scans the grid after `builder()`), i.e. generation-time only.
- `-seed N` makes every iteration identical (`rng::reset()` reuses `Options.seed`). Parallel runs should omit `-seed` and use OS entropy, or be patched to use seed+i.

Lua sampler (`mortuary_sample.lua`, scratchpad):
- Command: `util/fake_pty ./crawl -script mortuary_sample.lua <seed0> <count>`.
- For each seed it runs `debug.reset_rng` → `debug.dungeon_setup` → for each level in `explorer.generation_order` it calls `debug.goto_place`, then `debug.generate_level`, then scans `dgn.mons_at`. Portal entrances found on a level are generated too.
- Output line: `{"seed","place","vaults","monsters":[{"type","name","vault","hostile","unique","n"}]}`.
- Measured: 1 seed = 91 levels in 2.97 s. 8 parallel × 5 seeds = 16 s. 0 malformed lines.
- Size is ~150 KB raw / 13.5 KB gz per seed, so **10k seeds ≈ 1.5 GB raw / 135 MB gz** per version.
- Raw is worth keeping for re-aggregation and calibration. Alternatively, aggregate in-process and keep raw only for a subset.

Seeded determinism check (seed 12345):
- objstat D:1-3, run twice: identical.
- D:1–3 generated alone vs as part of all of D: identical. Per-branch RNG streams (`rng::LEVELGEN + branch`) isolate branches.
- seed_explorer (real pregen) vs objstat on D:1–3, D:15 and Lair:2: identical apart from objstat's plant exclusion and zombie base loss.
- Orc:1, Vaults:3 and Depths:4: **different**. Real pregen gets Jorgrun+Nergalle on Orc:1; objstat gets neither. This is caused by generation-order differences in shared state.

## 5. Sampling budget

λ for a monster with mean μ per level, from n level instances, has relative SE ≈ 1/√(nμ).
- For 5% precision at μ=0.1 we need n≈4,000 instances of that level.
- D, Lair, Vaults, Depths, Zot and Hells appear in every seed. Spider/Snake/Shoals/Swamp appear in ~50%, portals in ~20–70%.
- **Suggestion: 10k seeds per release** (≈35 min/16 cores, or ~8 core-hours). Add objstat with `-iters 2000` for Abyss/Pan/Zig/Trove/Hell (vestibule).
- This is cheap enough to run on a laptop or one spot VM per release. The results are committed as data and never rerun unless the script changes.

## 6. Monster identity

Code identity is the `monster_type` enum.
- **≥0.32:** `dat/mons/<slug>.yaml`. `enum` defaults to `MONS_` + `name.upper().replace(" ","_")` (`util/mon-gen.py:111`); 33 files override `enum` explicitly. `mon-data.h` is generated from the YAML.
- **≤0.31:** a hand-written `mon-data.h`. Entries start `MONS_ORC_WARRIOR, 'o', YELLOW, "orc warrior"`, which a regex can handle. The catalog should still be generated from the compiled game, as in 04's proposal.

**Agree with 04's canonical key** (`monster_type` minus `MONS_`, lowercased, e.g. `orc_warrior`), with a curated `lineage.yaml` for renames. Additions:
- **Derived undead and spectral forms need a compound identity:** `key=zombie`, `base=spriggan_berserker`.
  - In 0.34 the sampler shows `type_name="zombie"`, `name="spriggan berserker zombie"` / `"guardian sphinx zombie"`, so the generic class still exists.
  - Aggregate by `key` by default, and keep `base` for drill-down. Same for `skeleton`, `simulacrum`, `spectral_thing`, and draugr if it carries a base.
- **Name → key is not 1:1** for a few classes: "Serpent of Hell" (4 per-Hell variants) and "Bai Suzhen" (2 forms). Disambiguate by place or flag.
- **Variants are stripped from the key but kept as attributes, for grouping and drill-down** (user decision 2026-11-12). The 40-seed spike shows all of them:
  - **Ugly things**:
    - "green ugly thing" → `key=ugly_thing, variant.colour=green`. Same for `very_ugly_thing`.
    - Colour determines the attack brand and resistances, so the per-colour deadliness is worth showing.
    - Family `ugly_things` = {ugly_thing, very_ugly_thing}.
  - **Hydras**:
    - "seven-headed hydra" → `key=hydra, variant.heads=7`. "27-headed Lernaean hydra" → `key=lernaean_hydra, heads=27`.
    - Generation-time head counts come from the sampler, and death-time head counts from the logfile killer ("a 15-headed hydra").
    - The two differ because players cut heads off with non-fire weapons and the hydra regrows more. A heads histogram (generated vs killed-by) is exactly the funny graph.
  - **Draconians**:
    - Base colours are distinct enums: `red_draconian`, … `purple_draconian`, plus the pale/mottled variants depending on version.
    - Job draconians are one enum per job, with the colour as their base. "yellow draconian annihilator" → `key=draconian_annihilator, variant.colour=yellow`.
    - In-game, colour gives the breath weapon and resistances (red fire, white cold, green poison, black lightning, yellow acid, purple dispel/energy). The job gives the spells or melee.
    - Catalog family `draconians` = all base colours + all jobs. That lets the UI show Zot/Depths draconians as one group, drillable by colour or by job.
  - **Derived undead**: `variant.base`, as above.
  - Variants need no special handling in the sampler. The catalog supplies `family` per key and the post-processor parses the variant from `name` vs `type_name`.
- Logfile `killer` is `mons->full_name(DESC_A)` plus suffixes (`hiscores.cc:1415–1438`). Subproject 2's normaliser must handle:
  - leading `a/an/the`;
  - `" (shapeshifter)"`, `" (glowing shapeshifter)"` → `shapeshifter`/`glowing_shapeshifter` (the disguise form is in the name);
  - `" the pandemonium lord"` → `pandemonium_lord`;
  - `" (illusionary)"` → the same monster, flagged as an illusion;
  - `"X's ghost"` → `player_ghost`;
  - named monsters such as `"Grunt the orc warrior"` → suffix match on the catalog;
  - uniques (`killer_flags=unique`);
  - dancing weapons, whose killer is an item name like `"a +2 broad axe"`. Use `ktyp`/the `killer` shape and `kaux`;
  - `"their own shadow"`, `"themself"`, `"an ally"`.
  Use `ikiller`/`kpath` for summons and spawned things.
- The **vanquished list uses plurals** ("13 orc warriors"). Two options:
  - Port crawl's `pluralise_monster()`/`pluralise()` (`english.cc`) to TS.
  - Have the catalog generator (C++ `util/` main) emit the exact plural for every class. This is preferred because it is exact per version.
- Tile names are derivable (`tilep_<enum>` / rltiles). rltiles is CC0 (note for 03).

## 7. Proposed output schema

Raw (per release, gzipped JSONL, one line per generated level instance):
```json
{"release":"0.34.1","seed":12345,"place":"D:15","vaults":["layout_gridville","eino_tiny_chamber"],
 "monsters":[{"key":"zombie","variant":{"base":"spriggan_berserker"},"name":"spriggan berserker zombie",
              "n":2,"vault":2,"hostile":2,"unique":false,"firewood":false},
             {"key":"hydra","variant":{"heads":7},"name":"seven-headed hydra","n":1,"vault":0,"hostile":1,"unique":false,"firewood":false}]}
```
The spike emits names; the `key`/`variant` mapping is applied in post-processing via the catalog.

The aggregate is keyed at **(place, key, variantKey)** granularity. `variantKey` is a canonical string such as `""`, `"base=orc"`, `"colour=red"` or `"heads=7"`. All statistics are additive, so class rows, family rows (via the catalog's `family`) and histograms (e.g. hydra heads) are plain sums in the aggregator/UI.

Aggregate (per release, the contract with 03/aggregator). Keep **additive sufficient statistics** so the webapp or aggregator can combine versions exactly:
```ts
type PlaceSample = { release: string; place: string;   // "Lair:3"
  instances: number;                                    // level instances generated (denominator)
  seeds: number;                                        // seeds in run (gives P(place exists per game))
  source: "pregen-lua" | "objstat" };
type MonsterAtPlace = { release: string; place: string; key: string;
  variantKey: string;             // "" | "base=orc" | "colour=red" | "heads=7" (UI groups/drills on this)
  sum: number; sumSq: number;     // Σ count, Σ count² over instances → mean, variance
  present: number;                // instances with ≥1 → P(at least one)
  vaultSum: number;               // Σ count placed by vaults
  hostileSum: number;             // excludes neutrals/allies (e.g. Beogh/vault friendlies)
  oodSum: number;                 // Σ count flagged OOD at generation (see below)
  nativeSum: number;              // Σ count with in_local_population (branch-table native)
  uniq: boolean; firewood: boolean };
```

**Classification data for the UI (per user decision, 2026-11-12).** The UI groups rows into expandable categories: OOD (expanded by default), summons, and "shouldn't be on this floor". The sampler doesn't classify anything for display. It only has to expose clean fields, from two sources:
- **Per generated instance**, via the Lua API, aggregated into `oodSum`/`nativeSum`:
  - `mons.in_local_population` (the monster is native to this branch's table);
  - `mi:avg_local_depth()` / `mi:avg_local_prob()`, which give an OOD distance;
  - the builder's `mons_is_ood` prop (the generator rolled an OOD pick).
- **Per release, in the catalog**: the parsed `mon-pick-data.h` population tables, `{branch, minDepth, maxDepth, weight, shape, key}`. With these the UI/aggregator can classify *any* killer at *any* place, including deaths with no generation sample: native in range, OOD by N levels, or not native to this branch at all.
  - This covers monsters that "shouldn't appear": a monster that isn't in the place's table and has λ_gen≈0 there. Most of these arrived through summons, followers, Xom or wrath.
  - The tables are a simple C initializer format, stable across versions, so they're trivial to parse in TS. Alternatively, export them from the C++ catalog main.
- **Summons** are identified from subproject 2's logfile fields (`ikiller`/`kpath`, `killer_flags`), not from the sampler.
- λ_gen(P,m) = `sum / instances`.
- Composite across releases: Σsum / Σinstances, or weight by game counts from subproject 2. That weighting is the aggregator's decision; see 04 §4.3.
- Abyss/Pan rows are flagged `source:"objstat"` and are **snapshot only**. The UI should not compute lethality-per-encounter for them unless a spawn × time model is added.

## 8. Version handling

- Tables are retuned every release. The 0.33→0.34 diff of `mon-pick-data.h` changed weights on dozens of entries, plus new monsters (clockroach, chonchon, kobold fleshcrafter) and removals (giant cockroach). The des files churn too.
- **Sample every release separately.** Reuse one sample when the spawn-relevant inputs hash identically.
  - **0.34.0 → 0.34.1** changed none of `mon-pick-data.h`, `dat/des`, `dat/mons`, `mon-pick.cc` or `branch-data.h`.
  - Only `dungeon.cc` (a slime hatch landing fixup, which runs on arrival, not at generation) and `mon-place.cc` (summon placement) changed.
  - So one sample serves the series. For **seeded reproduction**, build the exact `vlong` commit anyway.
- The same pipeline works for any tag ≥0.24, where `seed_explorer.lua`/`explorer.lua` and the Lua API exist.
  - Expected per-tag build friction: pyyaml ≥0.32; older tags may need an older compiler.
  - Recommend doing the batch builds in a **Linux Docker image** (pinned gcc), with macOS for dev.
  - Seeded generation stability itself dates from 0.23; incremental pregen is the default.

## 9. Seeded reproduction for validation (coordinator Q1)

- Logfile `seed` + exact version → run the sampler with `<seed> 1`, optionally stopping at the death place.
- The result is the exact monster set of every connected-branch level the character could have seen. Cost: ~1–3 s per game.
  - A 30k-game validation set ≈ 1 core-day.
- **Verify** each reproduction by matching our `vaults` per level against the morgue's "Levels and vault maps discovered" section. It is in the default `dump_order` and printed in death morgues. Discard mismatches.
- Mismatches are expected for:
  - server builds with local patches;
  - games whose saves were upgraded across versions mid-game (manual: "upgrading your save … will naturally lead to seed divergence");
  - servers or players using `pregen_dungeon = false`;
  - any non-stable areas (portals, Abyss, Pan, Zigs, and per the manual some unique-artefact placement).
- This is the strongest calibration source for "faced vs generated":
  - The exact generated set is known per level.
  - The morgue gives kills per level (xp_by_level) and per monster (vanquished list).
  - The logfile gives the death. Observed f(P,m) can then be fitted directly.

## 10. Interfaces with other subprojects

- **Provides to 03/aggregator:**
  - `levelgen/<release>/population.json` (the `PlaceSample[]`, `MonsterAtPlace[]` above);
  - raw JSONL archives (out of git: release assets or object storage);
  - `catalog/<release>.json` (monsters: key, name, plural, glyph, tile, hd, xp, unique, flags; places + branch tree; **per-branch population tables** for native/OOD classification). This is shared with 04's `packages/contract`.
- **Needs from 02:**
  - visits per place (milestones `br.enter`/morgue), as the denominator of lethality;
  - for calibration: seed, `vlong`, the per-level vault list, xp_by_level kills and vanquished lists from a sample of morgues.
- **Provides to 02:**
  - the catalog name→key table and plural table;
  - the derived/special-form rules above;
  - a "reproduce this seed" CLI for validation.

## 11. Risks

- **Old-tag builds** (≤0.28) on modern toolchains may need patches or Docker. The scope is 0.34 for now, so this is deferred.
- **`-script` requires a pty** for console builds (`util/fake_pty`). It works on macOS and Linux. Headless or tiles builds have different flags.
- The sampler relies on **debug Lua APIs** (`debug.goto_place`, `debug.generate_level`) that are stable since 0.24 but undocumented. Pin per tag.
- **Unique depletion**: the sample is faithful to real games only because we generate in the real order. Future script changes must preserve that order.
- **"Generated ≠ faced"**: without calibration, λ_gen overstates encounters, especially for deep or optional areas and big vaults. The UI must label the number honestly.
- **Ghosts, summons, Abyss/Pan and the orb run** can't be expressed as levelgen λ. The UI needs a "no expected-count" state.
- **Raw data volume**: about 1.5 GB per release uncompressed. Keep it out of git.

## 12. Decisions (user, 2026-11-12)

1. **MVP metric = monsters *generated* per visit.** "Faced" calibration (morgue kill tables, seeded replays) comes in a later phase.
2. **Abyss, Pan, Zigs, orb run: deaths only** is the core requirement.
   - An expected-encounter estimate is optional later work: spawn rate × estimated turns per place. Turns can be estimated from milestone timestamps (turn of `br.enter`/next milestone) once 02 delivers milestones.
   - The sampler emits objstat snapshots for these places but no λ is required.
3. **Firewood and neutrals count**, and the UI hides them by default. The sampler needs nothing special; the `firewood`/`hostileSum` fields above suffice.
4. **One row per class with drill-down**:
   - Derived forms: `zombie` → per-`base` rows.
   - **Uniques** are grouped the same way, e.g. a "uniques" row expanding to Sigmund, Grinder, ….
   - **OOD**, **summons**, and **monsters that shouldn't appear on this floor** are expandable categories, with only OOD expanded by default.
   - All of this is UI logic over clean fields: §7's classification data from 01, plus killer attribution fields from 02.
   - **Variant attributes** (ugly thing colour, draconian colour and job, hydra heads, undead base) are stripped from the key but kept as `variant` for grouping. Catalog `family` enables groups such as "draconians" in Zot. The hydra-heads histogram is a candidate for a graph. See §6.
5. **Run the sampler locally** (~35 min per release on the 16-core Mac). Docker is only a fallback for old tags that don't build with the current toolchain.

## 13. Remaining open questions

- None blocking for 0.34. When older versions are in scope, we'll need to decide how far back to go: the Lua sampler works for ≥0.24, and build friction grows with age.
