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

/** The slice of monster metadata a set of killer keys needs, to keep client props small. */
export function monstersFor(meta: Meta, keys: Iterable<string>): Meta["monsters"] {
  const out: Meta["monsters"] = {};
  for (const k of keys) if (meta.monsters[k]) out[k] = meta.monsters[k]!;
  return out;
}
