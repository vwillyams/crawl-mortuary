// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { parseSelection, selectionToParam } from "@/lib/select";
import type { SeriesContext } from "./useSeries";

function Picker({ ctx, value }: { ctx: SeriesContext; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const options = [...ctx.available.map((s) => ({ v: s, label: s })), { v: "all", label: "all versions" }];
  if (!options.some((o) => o.v === value)) options.push({ v: value, label: value.replace("..", "–") });
  return (
    <label className="toggle">
      version
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          router.replace(v === ctx.defaultSeries ? pathname : `${pathname}?v=${encodeURIComponent(v)}`, { scroll: false });
        }}
      >
        {options.map((o) => (
          <option key={o.v} value={o.v}>
            {o.label}
          </option>
        ))}
      </select>
      {/* TODO(web): a range picker (from/to). `?v=0.30..0.34` already works if typed into the URL. */}
    </label>
  );
}

function PickerWithParams({ ctx }: { ctx: SeriesContext }) {
  const params = useSearchParams();
  const sel = parseSelection(params.get("v"), ctx.available, ctx.defaultSeries);
  return <Picker ctx={ctx} value={selectionToParam(sel)} />;
}

export function VersionPicker({ ctx }: { ctx: SeriesContext }) {
  return (
    <Suspense fallback={<Picker ctx={ctx} value={ctx.defaultSeries} />}>
      <PickerWithParams ctx={ctx} />
    </Suspense>
  );
}
