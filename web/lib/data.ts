// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Build-time data loading for server components. It reads what scripts/prepare-data.ts wrote to public/data/.
 * Only import this from server components (pages/layouts), never from "use client" files.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { placeFile, type Meta, type MonsterShard, type PlaceShard } from "./shards";

const dataDir = path.join(process.cwd(), "public/data");
const cache = new Map<string, unknown>();

function load<T>(rel: string): T {
  if (!cache.has(rel)) cache.set(rel, JSON.parse(readFileSync(path.join(dataDir, rel), "utf8")));
  return cache.get(rel) as T;
}

export const getMeta = () => load<Meta>("meta.json");
export const getPlace = (place: string) => load<PlaceShard>(`place/${placeFile(place)}.json`);
export const getMonster = (key: string) => load<MonsterShard>(`monster/${key}.json`);
export const getReachedParams = () => load<Record<string, unknown> | null>("reached-params.json");

/** Places in a branch, in floor order. */
export function branchPlaces(meta: Meta, abbrev: string): string[] {
  return meta.places.filter((p) => p === abbrev || p.startsWith(`${abbrev}:`));
}

/**
 * A one-line, server-rendered summary of a place for the default series, e.g. "Top killers on D:3 in 0.34:
 * orc 23%, …". It goes in <meta name="description"> and a no-JS fallback. Keep it tiny: it is the
 * only data embedded in the page itself.
 */
export function placeSummary(place: string, n = 5): string | null {
  const meta = getMeta();
  const p = getPlace(place).bySeries[meta.defaultSeries];
  if (!p || p.deathsTotal === 0) return null;
  const byKey = new Map<string, number>();
  for (const k of p.killers) byKey.set(k.key, (byKey.get(k.key) ?? 0) + k.deaths);
  const top = [...byKey].filter(([, d]) => d > 0).sort((a, b) => b[1] - a[1]).slice(0, n);
  const label = (k: string) => meta.monsters[k]?.name ?? meta.causes[k] ?? k.replace(/^unresolved:/, "");
  return `Top killers on ${place} in ${meta.defaultSeries}: ${top
    .map(([k, d]) => `${label(k)} ${Math.round((100 * d) / p.deathsTotal)}%`)
    .join(", ")} (of ${p.deathsTotal} deaths).`;
}

/** Monster counterpart of placeSummary: where it kills most in the default series. */
export function monsterSummary(key: string, n = 3): string | null {
  const meta = getMeta();
  const rows = getMonster(key).bySeries[meta.defaultSeries] ?? [];
  const byPlace = new Map<string, number>();
  for (const r of rows) byPlace.set(r.place, (byPlace.get(r.place) ?? 0) + r.deaths);
  const total = [...byPlace.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const top = [...byPlace].sort((a, b) => b[1] - a[1]).slice(0, n);
  const name = meta.monsters[key]?.name ?? key;
  return `${name} killed ${total} characters in ${meta.defaultSeries}, most often on ${top.map(([p, d]) => `${p} (${d})`).join(", ")}.`;
}
