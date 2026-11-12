# ingest

Turns finished-game records from any source into normalized `GameRow`s (`packages/contract/src/games.ts`).
Output goes to `data/games/<series>.jsonl` plus a `<series>.report.json` audit file. Neither is committed.

```
pnpm install
pnpm run ingest -- --series 0.34                              # fixture source (default)
pnpm run ingest -- --series 0.34 --synthesize 5000            # fixture + 5000 synthetic games (for load/pipeline testing)
pnpm run ingest -- --series 0.34 --source dcss-stats          # needs DCSS_STATS_ROWS_JSONL (see below)
pnpm run ingest -- --series 0.34 --source logfile --logfile path/to/logfile --server CDI
pnpm test        # vitest
pnpm typecheck
```

Other flags: `--catalog <path>`, `--out <path>`, `--include-prerelease`.

## Structure

| File | What |
|---|---|
| `src/types.ts` | `RawGame` (what adapters yield) and the `GameSourceAdapter` interface |
| `src/sources/fixture.ts` | Working. It replays `packages/contract/fixtures/games.jsonl`, and can synthesize more games from catalog spawn tables. |
| `src/sources/dcss-stats.ts` | Maps dcss-stats `Game` ⨝ `Player` rows to RawGame, with the export SQL. Reads a JSONL export today; direct Postgres is a TODO. |
| `src/sources/logfile.ts` | Reads **local** xlog logfiles. Network fetching and milestones are TODO. |
| `src/xlog.ts` | xlog line parser (go-sequell port). It unescapes every `::` and keeps `=` inside values. |
| `src/killer/resolve.ts` | Killer string → `KillerKey` + `Variant` (go-sequell port, extended to keep variants) |
| `src/killer/causes.ts` | ktyp → `@cause` keys, labels, and ktyp inference from the one-line death message |
| `src/normalize.ts` | RawGame → GameRow: ids, series bucketing, bots, place keys, killer resolution |
| `data/bots.json` | Bot account list (from dcss-stats, MIT) |

## Policies

- **Series and prerelease:** `series = seriesOf(v)`, so "0.34.1" → "0.34". Prerelease builds (`-a`/`-b`, e.g. `0.35-a0`
  trunk, `0.34-b1`) are **excluded** from series output by default and counted under `excluded.prerelease` in the
  report. `--include-prerelease` keeps them.
- **Bots** are **kept** with `isBot: true`, and the aggregate step excludes them. The flag is our list OR the source's own flag
  (dcss-stats `Player.isBot`).
- **Game id:** `sha1(server | lowercased name | start ISO)`. It's identical across adapters, so a dcss-stats game and the same
  game from our own logfile scrape dedupe.
- **Killer attribution:** the logfile `killer` (direct killer) is used. When crawl records a poisoner, burner and so on, the death is
  credited to that monster whatever the ktyp. A missing or empty killer → `@<cause>` from ktyp. Special strings: "you" and "themself" → `@self`,
  "an ally" → `@ally`, "their own shadow" → `player_shadow`.
- **Place key:** `br` + `lvl`. Single-floor branches (catalog `depth === 1`, e.g. Temple, Pan, Hell) have no `:n`.

## dcss-stats specifics

dcss-stats does **not** store ktyp (`Game.killerType` is only `"unique"` or null). The normalizer infers ktyp from
`endMessage` (tmsg) using the DDV_ONELINE wordings from crawl 0.34.1 `hiscores.cc`. Monster deaths don't depend on this
(their `killer` is set). It only affects how non-monster causes are labelled.

To load a dump: restore it into Postgres, then

```
psql "$DCSS_STATS_DATABASE_URL" -At -c "SELECT row_to_json(t) FROM ($(pnpm -s tsx src/sources/print-dcss-sql.ts 0.34)) t" > rows.jsonl
DCSS_STATS_ROWS_JSONL=rows.jsonl pnpm run ingest -- --series 0.34 --source dcss-stats
```

## Catalog

Killer resolution needs a catalog. By default it uses the newest `data/catalog/<series>.*.json` (from levelgen), and falls back to
`packages/contract/fixtures/catalog.json`. Tests use the fixture plus extra test monsters. If the real 0.34.1 catalog exists, tests also check it:
the structural keys exist, every monster's own name resolves to itself, and the whole killer table resolves.

## TODO(ingest)

- Direct Postgres reading for dcss-stats (`pg` + cursor); pg_restore notes once the dump format is known.
- Logfile fetching (sources.yaml, Range continuation, rate limit) and a milestones reader for the "reached" denominator.
- Parquet output (DuckDB) at real volumes.
- Check the endMessage → ktyp table and the killer rules against a large real sample; review `report.unresolved`.
- Merge Sequell's bot list if one is published.

## Credits

Killer and xlog rules are ported from [go-sequell](https://github.com/crawl/go-sequell) (MIT). The bot list and the dcss-stats schema mapping
come from [dcss-stats](https://github.com/O4epegb/dcss-stats) (MIT). Licence: AGPL-3.0-or-later.
