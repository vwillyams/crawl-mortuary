// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from "node:fs";

const file = new URL("../data/bots.json", import.meta.url);
const BOTS = new Set<string>(
  (JSON.parse(readFileSync(file, "utf8")) as { bots: string[] }).bots.map((b) => b.toLowerCase()),
);

/** True if the player is a known bot, or the source already flagged them. */
export function isBot(player: string, hint?: boolean): boolean {
  return Boolean(hint) || BOTS.has(player.toLowerCase());
}
