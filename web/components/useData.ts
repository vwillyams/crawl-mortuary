// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
/**
 * Client-side loading of the JSON files that prepare-data writes to public/data/.
 *
 * Pages deliberately don't pass data as props to client components. Next serializes props into
 * every page's HTML and into several RSC payload files, so passing data copied each shard ~5× per
 * page. Instead, each fact lives once in a static JSON file. The browser and CDN cache it, and
 * pages share it (meta.json is fetched once per session).
 */
import { useEffect, useState } from "react";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
export const dataUrl = (rel: string) => `${basePath}/data/${rel}`;

const pending = new Map<string, Promise<unknown>>();
const resolved = new Map<string, unknown>();

export function fetchData<T>(rel: string): Promise<T> {
  let p = pending.get(rel);
  if (!p) {
    p = fetch(dataUrl(rel))
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${rel}`);
        return r.json();
      })
      .then((j) => {
        resolved.set(rel, j);
        return j;
      });
    p.catch(() => pending.delete(rel)); // allow a retry on the next mount
    pending.set(rel, p);
  }
  return p as Promise<T>;
}

export type Loaded<T> = { state: "loading" } | { state: "error"; error: string } | { state: "ok"; data: T };

/** Loads several data files; ok only once all have arrived. Previously fetched files are synchronous. */
export function useDataMany<T>(rels: string[]): Loaded<T[]> {
  const key = rels.join("\n");
  const fromCache = (): Loaded<T[]> =>
    rels.every((r) => resolved.has(r)) ? { state: "ok", data: rels.map((r) => resolved.get(r) as T) } : { state: "loading" };
  const [loaded, setLoaded] = useState<Loaded<T[]>>(fromCache);

  useEffect(() => {
    let live = true;
    const now = fromCache();
    if (now.state === "ok") {
      setLoaded(now);
      return;
    }
    setLoaded({ state: "loading" });
    Promise.all(rels.map((r) => fetchData<T>(r))).then(
      (data) => live && setLoaded({ state: "ok", data }),
      (e: unknown) => live && setLoaded({ state: "error", error: String(e) }),
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures rels
  }, [key]);

  return loaded;
}

export function useData<T>(rel: string): Loaded<T> {
  const l = useDataMany<T>([rel]);
  return l.state === "ok" ? { state: "ok", data: l.data[0]! } : l;
}
