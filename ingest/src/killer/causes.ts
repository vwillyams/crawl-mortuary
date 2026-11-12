// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Non-monster death causes.
 *
 * ktyp values come from crawl 0.34.1 hiscores.cc `kill_method_names[]`. One-line death messages
 * (logfile `tmsg`, dcss-stats `endMessage`) come from `scorefile_entry::death_description`
 * with DDV_ONELINE. Both were checked against the 0.34.1 source.
 */

/** ktyp values that mean the game wasn't a death. */
export const NON_DEATH_KTYP = new Set(["winning"]);

/** ktyp values for games that shouldn't count as real games (excluded downstream; we still emit them). */
export const ABNORMAL_KTYP = new Set(["wizmode", "exploremode"]);

/** ktyp → cause key, used when there's no monster killer. Anything unlisted becomes "@" + ktyp. */
const KTYP_CAUSE: Record<string, string> = {
  quitting: "@quit",
  leaving: "@leaving",
  pois: "@poison",
  something: "@unknown",
  "death curse": "@death_curse",
  falling_down_stairs: "@stairs",
  falling_through_gate: "@gate",
};

export function causeForKtyp(ktyp: string | null): string {
  if (!ktyp) return "@unknown";
  return KTYP_CAUSE[ktyp] ?? `@${ktyp.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

/** Human labels for cause keys. The aggregate step copies these into AggregateFile.causes. */
export const CAUSE_LABELS: Record<string, string> = {
  "@quit": "quit",
  "@leaving": "left the dungeon",
  "@poison": "poison",
  "@unknown": "unknown",
  "@self": "self-inflicted",
  "@ally": "an ally",
  "@cloud": "cloud",
  "@lava": "lava",
  "@water": "drowning",
  "@stupidity": "intelligence loss",
  "@weakness": "strength loss",
  "@clumsiness": "dexterity loss",
  "@trap": "trap",
  "@starvation": "starvation",
  "@draining": "draining",
  "@freezing": "freezing",
  "@burning": "burning",
  "@wild_magic": "wild magic / miscast",
  "@xom": "Xom",
  "@rotting": "rotting",
  "@targeting": "own bad targeting",
  "@reflect": "reflected bolt",
  "@bounce": "bounced beam",
  "@self_aimed": "shot themself",
  "@death_explosion": "death explosion",
  "@tso_smiting": "smitten by the Shining One",
  "@beogh_smiting": "smitten by Beogh",
  "@divine_wrath": "divine wrath",
  "@petrification": "petrification",
  "@stairs": "fell down stairs",
  "@gate": "fell through a gate",
  "@acid": "acid",
  "@curare": "asphyxiation",
  "@disintegration": "disintegration",
  "@mirror_damage": "mirror damage",
  "@frailty": "frailty",
  "@barbs": "barbed spikes",
  "@collision": "collision",
  "@zot": "Zot",
  "@blinking": "disjunction",
  "@death_curse": "death curse",
  "@wizmode": "wizard mode",
  "@exploremode": "explore mode",
};

/**
 * Infer ktyp from a one-line death message. dcss-stats doesn't store ktyp, so this is the only way
 * to classify its non-monster deaths. The order matters: the first match wins. Patterns use the
 * DDV_ONELINE wording, matched case-insensitively.
 *
 * TODO(ingest): check against a large real sample. Some ONELINE wordings for rare causes
 * (e.g. divine wrath variants, collision text) are guessed from source and haven't been seen in the wild yet.
 */
const MESSAGE_KTYP: [RegExp, string][] = [
  [/^escaped with the orb/, "winning"],
  [/^quit the game/, "quitting"],
  [/^(safely )?got out of the dungeon/, "leaving"],
  [/^entered wizard mode/, "wizmode"],
  [/^entered explore mode/, "exploremode"],
  [/^slain by /, "mon"],
  [/^succumbed to .*poison/, "pois"],
  [/^succumbed to barbed spike/, "barbs"],
  [/^engulfed by /, "cloud"],
  [/lava/, "lava"],
  [/^(drowned|sank and fell apart|soaked and fell apart|fell apart)/, "water"],
  [/^forgot to (exist|breathe)/, "stupidity"],
  [/^collapsed under/, "weakness"],
  [/^slipped on a banana peel/, "clumsiness"],
  [/^killed by triggering/, "trap"],
  [/^starved to death/, "starvation"],
  [/^drained of all life/, "draining"],
  [/^frozen to death/, "freezing"],
  [/^(incinerated by|burnt to a crisp)/, "burning"],
  [/^disjoined/, "blinking"],
  [/wild magic|miscast/, "wild_magic"],
  [/xom/, "xom"],
  [/^rotted away/, "rotting"],
  [/^killed themself with a bounced/, "bounce"],
  [/^killed themself with/, "targeting"],
  [/^killed by a reflected/, "reflect"],
  [/^shot themself with/, "self_aimed"],
  [/^killed by an exploding/, "death_explosion"],
  [/^smitten by the shining one/, "tso_smiting"],
  [/^smitten by beogh/, "beogh_smiting"],
  [/^turned to stone/, "petrification"],
  [/death curse/, "death curse"],
  [/^fell down a flight of stairs/, "falling_down_stairs"],
  [/^fell down through a gate/, "falling_through_gate"],
  [/^splashed (by|with)/, "acid"],
  [/^asphyxiated/, "curare"],
  [/^(blown up by|blew themself up)/, "disintegration"],
  [/^killed by mirror damage/, "mirror_damage"],
  [/^became unviable/, "frailty"],
  [/^thrown by /, "being_thrown"],
  [/^collided with/, "collision"],
  [/consumed by zot/, "zot"],
  [/^constricted to death/, "constriction"],
  [/^headbutted by/, "headbutt"],
  [/^rolled over by/, "rolling"],
  [/^impaled on/, "spines"],
  [/^killed by divine wrath|wrath of|retribution/, "divine_wrath"],
  [/^(shot with|hit by|killed from afar by|killed by)/, "beam"],
  [/^died$/, "something"],
];

export function inferKtypFromMessage(msg: string | null | undefined): string | null {
  if (!msg) return null;
  const m = msg.trim().toLowerCase();
  for (const [re, ktyp] of MESSAGE_KTYP) if (re.test(m)) return ktyp;
  return null;
}
