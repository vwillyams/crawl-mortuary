# aggregate/

Joins normalized games (`ingest/`), levelgen sampling and the catalog (`levelgen/`) into
`data/aggregate/aggregate.json` (`AggregateFile` in `packages/contract`). The webapp consumes that file.
All counts are additive across series. See `docs/research/00-plan.md` §3–§6.

```sh
pnpm install
pnpm run aggregate                     # defaults: --series 0.34, inputs from data/, else contract fixtures
pnpm run aggregate -- --games x.jsonl --catalog c.json --levelgen l.json --out o.json
pnpm run aggregate -- --config overrides.json   # { "params": { "pOrc": 0.7 }, "rules": [...], "mainRoute": {...} }
pnpm test && pnpm typecheck
```

Input resolution for each series:
1. explicit flag;
2. the newest `data/{catalog,levelgen}/<release>.json` in that series, and `data/games/<series>.jsonl[.gz]`;
3. `packages/contract/fixtures/*`, with a warning.

Bots and prerelease builds (`-a0`, `-b1`) are excluded by default (`--include-bots`, `--include-prerelease`).

## "Reached" estimate (`src/reached.ts`, tunables in `src/config.ts`)

Each game yields a credit map, place → P(reached). Sources are combined with **max**, and the maps
are summed over games.

1. **Death branch:** dying at B:d credits B:1..d.
2. **Branch tree:** a branch's entrance depth in its parent is uniform over the catalog's
   `[entryMin, entryMax]`, or `params.entryDist`. So parent level k gets P(entrance ≥ k). This applies
   recursively up to D.
3. **Prerequisite rules:** data, in `DEFAULT_CONFIG.rules`. Each credited branch also gets its own path to D.

| Rule | Fires on deaths in | Credits |
|---|---|---|
| `lair` | Elf, Vaults, Depths, the hells; any descendant of Lair, Vaults or Depths; wins | Lair, all floors, at `lairCredit` (1) |
| `s-branches` | Vaults, Depths, the hells, their descendants; wins | `sBranchesCompleted` (1), split over Swamp, Shoals, Snake and Spider by levelgen presence. If `useRunes`, raised to min(uniqueRunes, `sBranchesPerGame`=2) |
| `orc` | same as `s-branches` | Orc at `pOrc` (0.8) |
| `vaults` | descendants of Vaults (Crypt, Tomb, …); Zot; wins | Vaults:1..`vaultsLevels` (4) at `vaultsCredit` (0.9) |
| `hell-depths` | the hells | Depths, all floors (and so D:1–15) |
| `win-zot` | wins | Zot, all floors (and so Depths and D) |

The death place of a win isn't credited. "leaving" games credit nothing.

`grade` is `main` for D, Lair, Orc, the S-branches, V:1–4, Depths and Zot (`mainRoute`), and
`lowerBound` for everything else. `explain(place)` produces the tooltip text, which is stored as
`PlaceRow.reachedNote`.

## Killer rows

One row per (series, place, killer key, variant) with deaths > 0 or levelgen presence.
- `class` comes from the catalog spawn tables: `native` if in range at this depth (or levelgen
  generated it there), `ood` if shallower than its range, `unexpected` otherwise, `cause` for `@…`,
  `unresolved` for `unresolved:…`.
- `exposure` = reached × sum/instances.
- `presentExposure` = reached × present/instances.

## TODO
- Entrance-depth frequencies from levelgen, instead of uniform.
- Milestones (`reachedMethod: "milestones"` / `"ratio"`).
- Parquet input via DuckDB.
- Split "summon" from "unexpected" once `ikiller` is available.
- Lower the S-branch credit for 0-rune late deaths.
- Decide what "leaving" games credit.
- Audit report for resolved keys missing from the catalog.
