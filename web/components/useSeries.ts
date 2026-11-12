// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import { useSearchParams } from "next/navigation";
import { parseSelection, resolveSelection, type Selection } from "@/lib/select";

export interface SeriesContext {
  available: string[];
  defaultSeries: string;
}

/**
 * Reads `?v=` and resolves it to the series keys to sum. It must be rendered inside <Suspense>. At
 * prerender time the Suspense fallback renders the same view with the default series, so static HTML
 * always has real content.
 */
export function useSeries(ctx: SeriesContext): { selection: Selection; series: string[] } {
  const params = useSearchParams();
  const selection = parseSelection(params.get("v"), ctx.available, ctx.defaultSeries);
  return { selection, series: resolveSelection(selection, ctx.available) };
}

export function defaultSeries(ctx: SeriesContext): { selection: Selection; series: string[] } {
  const selection: Selection = { kind: "one", v: ctx.defaultSeries };
  return { selection, series: [ctx.defaultSeries] };
}
