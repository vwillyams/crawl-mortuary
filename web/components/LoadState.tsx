// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Loaded } from "./useData";

/** Placeholder shown while data loads, or if it fails. Returns null once everything is loaded. */
export function LoadState({ of }: { of: Loaded<unknown>[] }) {
  const err = of.find((l) => l.state === "error");
  if (err && err.state === "error") return <p className="muted">Couldn’t load data ({err.error}).</p>;
  if (of.some((l) => l.state === "loading")) return <p className="muted loading">Loading…</p>;
  return null;
}
