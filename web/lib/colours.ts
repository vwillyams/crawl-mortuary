// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * crawl colour names → CSS colours. Glyphs are always drawn on a dark "terminal" chip, so these are
 * tuned for a dark background in both light and dark themes.
 */
const COLOURS: Record<string, string> = {
  black: "#5a5a5a",
  blue: "#4f6fff",
  green: "#2fbf4f",
  cyan: "#2fb8c8",
  red: "#d23a3a",
  magenta: "#c040c0",
  brown: "#b8862f",
  lightgrey: "#c8c8c8",
  lightgray: "#c8c8c8",
  darkgrey: "#7a7a7a",
  darkgray: "#7a7a7a",
  lightblue: "#7f9bff",
  lightgreen: "#6fef7f",
  lightcyan: "#7ff3ff",
  lightred: "#ff6f6f",
  lightmagenta: "#ff7fff",
  yellow: "#f2e24a",
  white: "#ffffff",
};

export function crawlColour(name: string | undefined): string {
  if (!name) return COLOURS.lightgrey!;
  const key = name.toLowerCase().replace(/[^a-z]/g, "");
  // TODO(web): crawl's ETC_* elemental/animated colours (e.g. "etc_fire") need a palette; fall back to grey.
  return COLOURS[key] ?? COLOURS.lightgrey!;
}
