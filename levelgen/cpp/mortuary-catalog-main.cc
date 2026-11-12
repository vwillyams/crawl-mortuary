// SPDX-License-Identifier: AGPL-3.0-or-later
// (Linked against Dungeon Crawl Stone Soup, GPL-2.0-or-later. The combined binary is
//  distributed under AGPL-3.0-or-later, which GPLv3 §13 permits.)
/**
 * crawl-mortuary catalog exporter.
 *
 * It's built inside a crawl checkout as util/mortuary/catalog and replaces crawl's main.cc,
 * the same way crawl's own util/monster/monster-main.cc does. The approach follows
 * dcss-stats' apps/extractor monster-export (MIT, https://github.com/O4epegb/dcss-stats),
 * but this is a much smaller, independent implementation that hand-writes its JSON.
 *
 * Output (stdout): one JSON object {"crawlVersion", "monsters":[...], "branches":[...]}.
 * The TS side (src/catalog.ts) post-processes it into the contract's Catalog.
 *
 * The generated header mortuary-enum-names.h is produced by scripts/build-crawl.sh from
 * mon-data.h. It is a table of { MONS_X, "MONS_X" } for every live monster entry.
 */

#include "AppHdr.h"

#include "fake-main.hpp"

#include "branch.h"
#include "colour.h"
#include "english.h"
#include "item-name.h"
#include "item-prop.h"
#include "mon-pick.h"
#include "mon-pick-data.h"
#include "mon-util.h"
#include "version.h"
#include "viewchar.h"

#include <cstdio>
#include <string>
#include <vector>

struct mortuary_enum_name { monster_type mt; const char *name; };
static const mortuary_enum_name mortuary_enum_names[] = {
#include "mortuary-enum-names.h"
};

static string jstr(const string &s)
{
    string out = "\"";
    for (unsigned char c : s)
    {
        switch (c)
        {
        case '"':  out += "\\\""; break;
        case '\\': out += "\\\\"; break;
        case '\n': out += "\\n"; break;
        case '\t': out += "\\t"; break;
        default:
            if (c < 0x20)
                out += make_stringf("\\u%04x", c);
            else
                out += (char)c;
        }
    }
    return out + "\"";
}

static const char *distrib_name(distrib_type d)
{
    switch (d)
    {
    case FLAT: return "flat";
    case SEMI: return "semi";
    case PEAK: return "peak";
    case RISE: return "rise";
    case FALL: return "fall";
    }
    return "unknown";
}

static string enum_name_of(monster_type mt)
{
    for (const auto &e : mortuary_enum_names)
        if (e.mt == mt)
            return e.name;
    return "";
}

static void initialize_crawl()
{
    // Same init sequence as crawl's util/monster/monster-main.cc, minus the parts
    // that need a level.
    init_monsters();
    init_properties();
    init_item_name_cache();
    init_monster_symbols();
    init_mon_name_cache();
    init_element_colours();
}

static string spawns_json(monster_type mt)
{
    vector<string> parts;
    for (int b = 0; b < NUM_BRANCHES; ++b)
    {
        const branch_type br = static_cast<branch_type>(b);
        if (branch_is_unfinished(br))
            continue;
        for (const pop_entry &e : population[b])
        {
            if (e.value != mt)
                continue;
            parts.push_back(make_stringf(
                "{\"branch\":%s,\"minDepth\":%d,\"maxDepth\":%d,\"rarity\":%d,\"distribution\":\"%s\"}",
                jstr(branches[b].abbrevname).c_str(), e.minr, e.maxr, e.rarity,
                distrib_name(e.distrib)));
        }
        // TODO(levelgen): population_water / population_lava (fish tables) are not exported yet.
    }
    return "[" + comma_separated_line(parts.begin(), parts.end(), ",", ",") + "]";
}

static string flags_json(monster_type mt)
{
    vector<string> f;
    if (mons_class_flag(mt, M_UNIQUE))     f.push_back("\"unique\"");
    if (mons_class_flag(mt, M_CANT_SPAWN)) f.push_back("\"cant_spawn\"");
    if (mons_class_flag(mt, M_NO_EXP_GAIN)) f.push_back("\"no_exp\"");
    if (mons_class_flag(mt, M_FLIES))      f.push_back("\"fly\"");
    if (mons_class_is_firewood(mt))        f.push_back("\"firewood\"");
    if (mons_is_removed(mt))               f.push_back("\"removed\"");
    // TODO(levelgen): resistances / holiness / speed / attacks, if the web side needs them.
    return "[" + comma_separated_line(f.begin(), f.end(), ",", ",") + "]";
}

static void dump_monsters()
{
    bool first = true;
    printf("\"monsters\":[\n");
    for (const auto &e : mortuary_enum_names)
    {
        const monster_type mt = e.mt;
        const monsterentry *me = get_monster_data(mt);
        if (!me || me->mc != mt)
            continue;

        const string name = mons_type_name(mt, DESC_PLAIN);
        const bool unique = mons_is_unique(mt);
        const string plural = unique ? name : pluralise_monster(name);
        const monster_type genus = mons_genus(mt);

        printf("%s{\"enumName\":%s,\"id\":%d,\"name\":%s,\"entryName\":%s,\"plural\":%s,"
               "\"unique\":%s,\"glyph\":{\"char\":%s,\"colour\":%s},"
               "\"hd\":%d,\"hp\":%.1f,\"ac\":%d,\"ev\":%d,\"exp\":%d,"
               "\"genus\":%s,\"flags\":%s,\"spawns\":%s}",
               first ? "" : ",\n",
               jstr(e.name).c_str(), (int)mt, jstr(name).c_str(),
               jstr(me->name).c_str(), jstr(plural).c_str(),
               unique ? "true" : "false",
               jstr(stringize_glyph(mons_char(mt))).c_str(),
               jstr(colour_to_str(mons_class_colour(mt))).c_str(),
               me->HD, me->avg_hp_10x / 10.0, me->AC, me->ev, me->exp,
               jstr(enum_name_of(genus)).c_str(),
               flags_json(mt).c_str(), spawns_json(mt).c_str());
        first = false;
    }
    printf("\n]");
}

static const char *branch_kind(branch_type br)
{
    if (br == BRANCH_ABYSS || br == BRANCH_PANDEMONIUM || br == BRANCH_ZIGGURAT)
        return "special";
    if (is_hell_branch(br))
        return "hell";
    if (!is_connected_branch(br))
        return "portal";
    return "main";
}

static void dump_branches()
{
    bool first = true;
    printf("\"branches\":[\n");
    for (branch_iterator it; it; ++it)
    {
        const Branch &b = **it;
        if (branch_is_unfinished(b.id))
            continue;
        vector<string> runes;
        for (rune_type r : b.runes)
            runes.push_back(jstr(rune_type_name(r)));
        const bool has_parent = b.parent_branch != NUM_BRANCHES;
        printf("%s{\"abbrev\":%s,\"name\":%s,\"longName\":%s,\"depth\":%d,\"parent\":%s,"
               "\"entryMin\":%s,\"entryMax\":%s,\"absdepth\":%d,\"kind\":\"%s\",\"runes\":[%s]}",
               first ? "" : ",\n",
               jstr(b.abbrevname).c_str(), jstr(b.shortname).c_str(),
               jstr(b.longname).c_str(), b.numlevels,
               has_parent ? jstr(branches[b.parent_branch].abbrevname).c_str() : "null",
               (has_parent && b.mindepth > 0) ? to_string(b.mindepth).c_str() : "null",
               (has_parent && b.maxdepth > 0) ? to_string(b.maxdepth).c_str() : "null",
               b.absdepth, branch_kind(b.id),
               comma_separated_line(runes.begin(), runes.end(), ",", ",").c_str());
        first = false;
    }
    printf("\n]");
}

int main(int /*argc*/, char * /*argv*/[])
{
    crawl_state.test = true;
    initialize_crawl();
    printf("{\"crawlVersion\":%s,\n", jstr(Version::Long).c_str());
    dump_monsters();
    printf(",\n");
    dump_branches();
    printf("}\n");
    return 0;
}
