# Top-level pipeline. Each target delegates to its subproject; see README.md.
RELEASE ?= 0.34.1
SERIES  ?= 0.34

.PHONY: contract levelgen ingest aggregate web all
contract:
	cd packages/contract && pnpm install && pnpm typecheck && pnpm validate-fixtures
levelgen:
	cd levelgen && pnpm install && pnpm run pipeline -- --release $(RELEASE)
ingest:
	cd ingest && pnpm install && pnpm run ingest -- --series $(SERIES)
aggregate:
	cd aggregate && pnpm install && pnpm run aggregate
web:
	cd web && pnpm install && pnpm run build
all: levelgen ingest aggregate web
