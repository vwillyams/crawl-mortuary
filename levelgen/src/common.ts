// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Catalog } from "@mortuary/contract";

export const LEVELGEN = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = resolve(LEVELGEN, "..");
export const DATA = join(ROOT, "data");

export const crawlDir = (release: string) => join(LEVELGEN, ".crawl", release);
export const crawlSrc = (release: string) => join(crawlDir(release), "crawl-ref", "source");
export const catalogPath = (release: string) => join(DATA, "catalog", `${release}.json`);
export const levelgenPath = (release: string) => join(DATA, "levelgen", `${release}.json`);
export const rawDir = (release: string) => join(DATA, "raw", "levelgen", release);

export function crawlDescribe(release: string): string {
  const f = join(crawlDir(release), ".mortuary-describe");
  return existsSync(f) ? readFileSync(f, "utf8").trim() : "unknown";
}

export function loadCatalog(release: string): Catalog {
  const p = catalogPath(release);
  if (!existsSync(p)) throw new Error(`no catalog at ${p}; run \`pnpm catalog --release ${release}\` first`);
  return Catalog.parse(JSON.parse(readFileSync(p, "utf8")));
}

export interface Args {
  release: string;
  seeds: number;
  seed0: number;
  jobs: number;
  chunk: number;
  skipBuild: boolean;
}

/** Minimal flag parser: --release 0.34.1 --seeds 300 --seed0 1 --jobs 8 --chunk 5 --skip-build */
export function parseArgs(argv = process.argv.slice(2)): Args {
  const a = argv.filter((x) => x !== "--");
  const get = (name: string) => {
    const i = a.indexOf(`--${name}`);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const num = (name: string, dflt: number) => {
    const v = get(name);
    if (v === undefined) return dflt;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
    return n;
  };
  return {
    release: get("release") ?? "0.34.1",
    seeds: num("seeds", 300),
    seed0: num("seed0", 1),
    jobs: num("jobs", availableParallelism()),
    chunk: num("chunk", 5),
    skipBuild: a.includes("--skip-build"),
  };
}
