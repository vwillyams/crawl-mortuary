-- SPDX-License-Identifier: AGPL-3.0-or-later
-- (Runs inside Dungeon Crawl Stone Soup, GPL-2.0-or-later.)
--
-- crawl-mortuary level sampler. For each seed, it runs crawl's real dungeon pregeneration
-- (the same path as crawl's own dat/dlua/seed_explorer / explorer.lua), generates every level
-- in generation order plus the portals the seed actually places, and emits one JSON line per
-- generated level.
--
-- Usage (from crawl-ref/source, after build-crawl.sh copied this into scripts/):
--   util/fake_pty ./crawl -script mortuary_sample.lua <seed0> <count>
--
-- Output goes to stderr, because fake_pty swallows the console. Each line is prefixed
-- "MORTUARY " so the TS runner can ignore other noise. Line shape (raw; the TS runner maps
-- names to contract keys/variants):
--   {"seed":N,"place":"D:3","vaults":"a, b and c",
--    "monsters":[{"type":"zombie","name":"orc zombie","vault":true,"hostile":true,"unique":false,"n":2}]}
--
-- TODO(levelgen): Abyss / Pan / Zig / Trove aren't in generation_order; use -objstat for them.
-- TODO(levelgen): out-of-depth flag per monster isn't exposed to Lua; oodSum stays empty.
crawl_require('dlua/explorer.lua')

local args = script.simple_args()
local seed0 = tonumber(args[1] or "1")
local count = tonumber(args[2] or "1")

local function esc(s)
  s = tostring(s):gsub('\\', '\\\\'):gsub('"', '\\"'):gsub('[%c]', ' ')
  return '"' .. s .. '"'
end

local function dump_level(seed, lvl)
  local counts, order = {}, {}
  local gxm, gym = dgn.max_bounds()
  for x = 1, gxm - 2 do
    for y = 1, gym - 2 do
      local m = dgn.mons_at(x, y)
      if m then
        -- type_name = class name ("zombie"); name = specific ("orc zombie")
        local key = m.type_name .. "|" .. m.name .. "|" ..
          (dgn.in_vault(x, y) and "v" or "n") .. "|" ..
          (m.wont_attack and "a" or "h") .. "|" .. (m.unique and "u" or "")
        if not counts[key] then counts[key] = 0; order[#order + 1] = key end
        counts[key] = counts[key] + 1
      end
    end
  end
  local parts = {}
  for _, k in ipairs(order) do
    local t, n, v, a, u = k:match("^(.-)|(.-)|(.)|(.)|(.*)$")
    parts[#parts + 1] = "{" .. "\"type\":" .. esc(t) .. ",\"name\":" .. esc(n)
      .. ",\"vault\":" .. (v == "v" and "true" or "false")
      .. ",\"hostile\":" .. (a == "h" and "true" or "false")
      .. ",\"unique\":" .. (u == "u" and "true" or "false")
      .. ",\"n\":" .. counts[k] .. "}"
  end
  crawl.stderr("MORTUARY {\"seed\":" .. seed .. ",\"place\":" .. esc(lvl) ..
    ",\"vaults\":" .. esc(debug.vault_names()) ..
    ",\"monsters\":[" .. table.concat(parts, ",") .. "]}")
end

local function build(seed, lvl)
  if dgn.br_exists(string.match(lvl, "[^:]+")) then
    debug.goto_place(lvl)
    debug.generate_level()
    dump_level(seed, lvl)
    return true
  end
  return false
end

for s = seed0, seed0 + count - 1 do
  debug.reset_rng(s)
  dgn.reset_level()
  debug.reset_player_data()
  debug.dungeon_setup()
  for _, lvl in ipairs(explorer.generation_order) do
    if build(s, lvl) then
      local here = you.where()
      for _, port in ipairs(explorer.portal_order) do
        if here == dgn.level_name(dgn.br_entrance(port)) then
          build(s, port)
          debug.goto_place(here)
        end
      end
    end
  end
  crawl.stderr("MORTUARY-DONE " .. s)
end
