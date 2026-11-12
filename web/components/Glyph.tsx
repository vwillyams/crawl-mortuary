// SPDX-License-Identifier: AGPL-3.0-or-later
import { crawlColour } from "@/lib/colours";

// TODO(web): render the CC0 tile (github.com/crawl/tiles) when the catalog's `tile` maps to one; ASCII fallback otherwise.
export function Glyph({ glyph }: { glyph?: { char: string; colour: string } }) {
  return (
    <span className="glyph" style={{ color: crawlColour(glyph?.colour) }} aria-hidden>
      {glyph?.char ?? "?"}
    </span>
  );
}
