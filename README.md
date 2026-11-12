# crawl-mortuary

How deadly is each monster on each floor of Dungeon Crawl Stone Soup? This repo samples
monster generation from the real crawl level generator. It joins that sample with
game-end records from public servers and publishes a fully static website.

Planning and research: [`docs/research/00-plan.md`](docs/research/00-plan.md). Start there.

## Layout

| Path | What | Lang |
|---|---|---|
| `packages/contract/` | Shared identifiers, zod schemas and fixtures for every file passed between stages | TS |
| `levelgen/` | Builds crawl at a release tag. It samples level generation (Lua inside crawl) and exports the monster/branch catalog | C++ build + Lua + TS runner |
| `ingest/` | Pluggable game-data source adapters (dcss-stats dump, own scrape, fixture) that produce normalized game rows | TS |
| `aggregate/` | Joins games, levelgen and catalog into the additive aggregate the site consumes | TS + DuckDB |
| `web/` | Next.js static export. Output is plain files for any static host | TS/React |
| `data/` | Pipeline outputs. Small, static ones are committed; see `data/README.md` | — |

Each subproject is a self-contained pnpm project (no workspace), so it can be split into its
own repo later. Subprojects depend on the contract through `link:../packages/contract`.

## Pipeline

```
make levelgen   # once per crawl release → data/catalog/<rel>.json, data/levelgen/<rel>.json
make ingest     # → data/games/<series>.*   (adapter chosen by config)
make aggregate  # → data/aggregate/aggregate.json
make web        # → web/out/  (static site)
```

## License

AGPL-3.0-or-later; see `LICENSE`. Dungeon Crawl Stone Soup is GPL-2.0-or-later. The data this
pipeline generates is not covered by the code licence.
