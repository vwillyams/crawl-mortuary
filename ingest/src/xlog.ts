// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * xlog (crawl logfile / milestones) line parser.
 *
 * Format: `key=value:key=value:...`. Inside a value, a literal ':' is escaped as "::".
 * A value may contain '=' (e.g. `tmsg=...`), so only the first '=' of each field
 * separates key from value.
 *
 * Ported from go-sequell's xlog.Parse / FindSeparator (MIT, https://github.com/crawl/go-sequell).
 * It deliberately avoids two bugs in dcss-stats' parser: it unescapes *every* "::", not just the first,
 * and it doesn't truncate values that contain '='.
 */

export type Xlog = Record<string, string>;

export class XlogParseError extends Error {
  constructor(
    readonly line: string,
    readonly cause: string,
    readonly index: number,
  ) {
    super(`malformed xlog line at ${index}: ${cause}`);
  }
}

/** Index of the first unescaped ':' in s, or -1. "::" is an escaped colon; ":::" is an escaped colon then a separator. */
export function findSeparator(s: string, from = 0): number {
  let i = from;
  for (;;) {
    const sep = s.indexOf(":", i);
    if (sep === -1) return -1;
    if (s[sep + 1] === ":") {
      i = sep + 2;
      continue;
    }
    return sep;
  }
}

export const unquoteValue = (v: string) => v.replaceAll("::", ":");
export const quoteValue = (v: string) => v.replaceAll(":", "::");

export function parseXlogLine(rawLine: string): Xlog {
  const line = rawLine.trim();
  const out: Xlog = {};
  let start = 0;
  while (start < line.length) {
    const eq = line.indexOf("=", start);
    if (eq === -1) throw new XlogParseError(line, "trailing characters", start);
    const key = line.slice(start, eq).trim();
    const valueStart = eq + 1;
    const sep = findSeparator(line, valueStart);
    const end = sep === -1 ? line.length : sep;
    out[key] = unquoteValue(line.slice(valueStart, end));
    start = sep === -1 ? line.length : sep + 1;
  }
  return out;
}

/** Cheap pre-filter (go-sequell's IsPotentialXlogLine): skip blank lines and lines starting with ':'. */
export const isPotentialXlogLine = (line: string) => line.length > 0 && line[0] !== ":";

/**
 * Logfile timestamps look like "20261012174912S" (YYYYMMDDhhmmss + S/D for DST), with a
 * **0-based month**. Converts to an ISO UTC string. dcss-stats does the same (month + 1).
 */
export function xlogTimeToIso(t: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(t);
  if (!m) throw new Error(`bad xlog timestamp: ${t}`);
  const [, y, mo, d, h, mi, s] = m;
  return new Date(Date.UTC(+y!, +mo!, +d!, +h!, +mi!, +s!)).toISOString();
}
