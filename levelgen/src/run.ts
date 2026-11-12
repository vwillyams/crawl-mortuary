// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Sampler runner: N seeds split into chunks across P parallel crawl processes.
 * Each chunk writes data/raw/levelgen/<release>/part-<seed0>-<count>.jsonl.gz, and chunks that
 * already exist are skipped, so the run is resumable.
 *
 *   pnpm sample --release 0.34.1 --seeds 300 [--seed0 1] [--jobs 16] [--chunk 5]
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { type Catalog, type LevelgenRawLine, LevelgenRawLine as RawLineSchema } from "@mortuary/contract";
import { crawlSrc, loadCatalog, parseArgs, rawDir } from "./common.ts";
import { NameResolver } from "./names.ts";

interface LuaMonster { type: string; name: string; vault: boolean; hostile: boolean; unique: boolean; n: number }
interface LuaLine { seed: number; place: string; vaults: string; monsters: LuaMonster[] }

const splitVaults = (s: string) => s.split(/, | and /).map((v) => v.trim()).filter(Boolean);

export function toRawLine(release: string, l: LuaLine, resolver: NameResolver, catalog: Catalog): LevelgenRawLine {
  const firewood = new Set(catalog.monsters.filter((m) => m.flags.includes("firewood")).map((m) => m.key));
  const merged = new Map<string, LevelgenRawLine["monsters"][number]>();
  for (const m of l.monsters) {
    const r = resolver.resolve(m.type, m.name, l.place);
    const id = `${r.key}|${r.variant}`;
    const cur = merged.get(id) ?? {
      key: r.key, variant: r.variant, name: m.name, n: 0, vault: 0, hostile: 0,
      unique: false, firewood: firewood.has(r.key),
    };
    cur.n += m.n;
    if (m.vault) cur.vault += m.n;
    if (m.hostile) cur.hostile += m.n;
    cur.unique ||= m.unique;
    merged.set(id, cur);
  }
  return RawLineSchema.parse({
    release, seed: l.seed, place: l.place, vaults: splitVaults(l.vaults), monsters: [...merged.values()],
  });
}

function runChunk(release: string, seed0: number, count: number): Promise<LuaLine[]> {
  const src = crawlSrc(release);
  return new Promise((resolve, reject) => {
    const p = spawn("util/fake_pty", ["./crawl", "-script", "mortuary_sample.lua", String(seed0), String(count)], {
      cwd: src, stdio: ["ignore", "pipe", "pipe"],
    });
    const lines: LuaLine[] = [];
    const done = new Set<number>();
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, "");
        buf = buf.slice(i + 1);
        const j = line.indexOf("MORTUARY ");
        const k = line.indexOf("MORTUARY-DONE ");
        if (k >= 0) done.add(Number(line.slice(k + 14)));
        else if (j >= 0) lines.push(JSON.parse(line.slice(j + 9)) as LuaLine);
      }
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("error", reject);
    p.on("close", (code) => {
      if (buf) onData(Buffer.from("\n"));
      if (done.size !== count)
        reject(new Error(`chunk ${seed0}+${count}: exit ${code}, finished ${done.size}/${count} seeds`));
      else resolve(lines);
    });
  });
}

export async function sample(opts: { release: string; seeds: number; seed0: number; jobs: number; chunk: number }) {
  const { release, seeds, seed0, jobs, chunk } = opts;
  const catalog = loadCatalog(release);
  const resolver = new NameResolver(catalog);
  const dir = rawDir(release);
  mkdirSync(dir, { recursive: true });

  const queue: [number, number][] = [];
  for (let s = seed0; s < seed0 + seeds; s += chunk) queue.push([s, Math.min(chunk, seed0 + seeds - s)]);
  const todo = queue.filter(([s, n]) => !existsSync(join(dir, `part-${s}-${n}.jsonl.gz`)));
  console.log(`sample ${release}: ${seeds} seeds from ${seed0}, ${queue.length} chunks (${todo.length} to run), ${jobs} jobs`);

  const t0 = Date.now();
  let finished = 0;
  let levels = 0;
  const worker = async () => {
    for (let c = todo.shift(); c; c = todo.shift()) {
      const [s, n] = c;
      const lua = await runChunk(release, s, n);
      const out = lua.map((l) => JSON.stringify(toRawLine(release, l, resolver, catalog))).join("\n") + "\n";
      const f = join(dir, `part-${s}-${n}.jsonl.gz`);
      writeFileSync(f + ".tmp", gzipSync(out));
      renameSync(f + ".tmp", f);
      finished++;
      levels += lua.length;
      if (finished % 10 === 0 || todo.length === 0)
        console.log(`  ${finished} chunks, ${levels} levels, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, Math.max(1, todo.length)) }, worker));
  if (resolver.unknown.size) {
    writeFileSync(join(dir, "unmapped.json"), JSON.stringify(Object.fromEntries(resolver.unknown), null, 1));
    console.warn(`  ${resolver.unknown.size} unmapped type names → ${join(dir, "unmapped.json")}`);
  }
  console.log(`sample done: ${levels} levels in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  sample(parseArgs()).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
