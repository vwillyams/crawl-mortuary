// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Catalog } from "@mortuary/contract";

export const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const FIXTURE_CATALOG = `${REPO_ROOT}packages/contract/fixtures/catalog.json`;
export const realCatalogPath = (release: string) => `${REPO_ROOT}data/catalog/${release}.json`;

/**
 * Load the catalog. An explicit path wins. Otherwise use data/catalog/<release>.json if levelgen has
 * produced it, and fall back to the contract fixture.
 */
export function loadCatalog(opts: { path?: string; release?: string } = {}): { catalog: Catalog; path: string } {
  const candidates = [opts.path, opts.release ? realCatalogPath(opts.release) : undefined, FIXTURE_CATALOG];
  for (const p of candidates) {
    if (p && existsSync(p)) return { catalog: Catalog.parse(JSON.parse(readFileSync(p, "utf8"))), path: p };
  }
  throw new Error(`no catalog found (tried ${candidates.filter(Boolean).join(", ")})`);
}
