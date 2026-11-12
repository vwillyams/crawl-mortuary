// SPDX-License-Identifier: AGPL-3.0-or-later
import type { GameRow } from "@mortuary/contract";

/**
 * What an adapter yields: one finished game. Field meanings follow the crawl logfile, but values are
 * already decoded (ISO times, numbers). Killer resolution, bot flagging, ids and series
 * bucketing happen later in normalize.ts, so they behave the same for every source.
 */
export interface RawGame {
  source: GameRow["source"];
  /** Server abbreviation, e.g. "CDI". */
  server: string;
  player: string;
  /** Source-specific bot flag (e.g. dcss-stats Player.isBot). It's ORed with our own bot list. */
  isBotHint?: boolean;
  /** Logfile `v`, e.g. "0.34.1", "0.35-a0". */
  version: string;
  isWin: boolean;
  xl: number;
  race: string;
  cls: string;
  god: string | null;
  turns: number;
  runes: number;
  uniqueRunes: number;
  /** ISO UTC. */
  startAt: string;
  endAt: string;
  /** Logfile `br` / `lvl`. */
  branch: string;
  lvl: number;
  /**
   * Logfile `ktyp`. Null when the source doesn't have it: dcss-stats doesn't store ktyp. Its
   * `killerType` column is only "unique" or null. normalize.ts then infers it from endMessage.
   */
  ktyp: string | null;
  /** Logfile `killer`; empty or null for non-monster deaths. */
  killer: string | null;
  /** Logfile `killer_flags`, e.g. "unique". */
  killerFlags: string | null;
  /** Logfile `tmsg` (one-line death message). */
  endMessage: string;

  // future fields (plan D5)
  ikiller?: string;
  killermap?: string;
  kaux?: string;
  seed?: string;
}

export interface SourceOptions {
  /** Only yield games of this series where the source can filter cheaply. normalize.ts filters again. */
  series?: string;
}

export interface GameSourceAdapter {
  readonly name: GameRow["source"];
  read(opts: SourceOptions): AsyncIterable<RawGame>;
}
