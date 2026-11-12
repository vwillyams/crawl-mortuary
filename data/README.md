# data/

Every stage writes static, versioned files here (plan D2), so only the stages whose inputs changed need to rerun.

| Path | Producer | In git? | Schema (`packages/contract`) |
|---|---|---|---|
| `catalog/<release>.json` | levelgen | yes | `Catalog` |
| `levelgen/<release>.json` | levelgen | yes | `LevelgenAggregate` |
| `games/<series>.parquet` or `.jsonl` | ingest | **no** | `GameRow` |
| `aggregate/aggregate.json` | aggregate | not yet (built from fixture games until real data lands) | `AggregateFile` |
| `raw/` | levelgen raw JSONL, source dumps | **no** | — |

Small hand-made fixtures for each schema live in `packages/contract/fixtures/`.
