# levelgen

Samples crawl's **real** level generator to estimate how many of each monster a level holds,
per release, and exports the monster/branch catalog. Background is in
[`docs/research/01-monster-sampling.md`](../docs/research/01-monster-sampling.md).

Outputs, both committed (schemas are in `packages/contract`):

| File | Schema | What |
|---|---|---|
| `data/catalog/<release>.json` | `Catalog` | Monsters (key, enum, name, plural, glyph, tile, stats, flags, spawn tables, group, variant dims) and branches (depth, parent, entry range, kind, runes) |
| `data/levelgen/<release>.json` | `LevelgenAggregate` | Per (place, monster, variant): Σcount, Σcount², #levels present, vault/hostile parts. Plus instances per place |
| `data/raw/levelgen/<release>/part-*.jsonl.gz` | `LevelgenRawLine` | One line per generated level (**not** committed) |

## Usage

```sh
pnpm install
pnpm run pipeline -- --release 0.34.1                 # build → catalog → sample (300 seeds) → aggregate
pnpm run pipeline -- --release 0.34.1 --seeds 10000   # full run, ~35 min on 16 cores
pnpm run pipeline -- --release 0.34.1 --skip-build    # reuse the existing build

# individual steps
bash scripts/build-crawl.sh 0.34.1                    # → .crawl/0.34.1 (gitignored)
pnpm catalog   --release 0.34.1
pnpm sample    --release 0.34.1 --seeds 300 --jobs 16 --chunk 5 [--seed0 1]
pnpm aggregate --release 0.34.1
pnpm test
```

`CRAWL_REPO=/path/to/local/crawl/clone` makes the clone step fast. A pyyaml venv is created
automatically in `.build/venv` if your `python3` lacks it.

Sampling is **resumable**. Each chunk of seeds writes its own `part-<seed0>-<count>.jsonl.gz`,
and chunks that already exist are skipped. To extend a run, raise `--seeds`. Seeds are deterministic
(1…N by default).

## How it works

- **`scripts/build-crawl.sh`**: shallow-clones the tag, initialises the lua/sqlite/zlib submodules, and builds the
  stock console binary, `util/fake_pty` and the des cache. It then builds our catalog exporter,
  `cpp/mortuary-catalog-main.cc`, as `util/mortuary/catalog`. That uses `cpp/mortuary.mk`, layered on
  crawl's own Makefile like crawl's `util/monster` target. The exporter's approach follows
  [dcss-stats](https://github.com/O4epegb/dcss-stats)' `apps/extractor` (MIT).
- **`lua/mortuary_sample.lua`**: runs inside crawl (`crawl -script`). Per seed it does crawl's real
  dungeon pregeneration in generation order, plus the portals that seed places, and prints one
  line per level.
- **`src/run.ts`**: runs the chunks in parallel. It maps in-game names to contract keys and variants
  (`src/names.ts`; e.g. `seven-headed hydra` → `hydra` + `heads=7`) and writes the raw parts.
- **`src/aggregate.ts`**: reduces the raw parts into additive sums.

## Licence

AGPL-3.0-or-later. The Lua script and the C++ exporter run inside, or link against, Dungeon Crawl
Stone Soup (GPL-2.0-or-later). That combination is permitted under the AGPLv3/GPLv3 compatibility clause.

## TODO

- Abyss / Pan / Ziggurat / Trove aren't in crawl's generation order. Add `crawl -objstat` rows (`source: "objstat"`).
- Out-of-depth flag per monster (`oodSum`). Lua can't see it yet.
- Fish tables (`population_water` / `population_lava`) aren't exported in spawns.
- Tiles for uniques and variants with non-default tiles; real XP values; more display groups.
- Older tags (< 0.32 have no YAML; < 0.24 the Lua path differs). Docker toolchain fallback.
