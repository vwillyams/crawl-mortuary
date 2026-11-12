#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-or-later
#
# Fetch and build a stock crawl console binary at a release tag, plus our catalog exporter.
#
#   scripts/build-crawl.sh <release>            e.g. 0.34.1
#
# Env:
#   CRAWL_REPO  git URL or local path to clone from (default: GitHub). A local clone is much faster.
#   JOBS        make parallelism (default: all cores)
#   PYTHON      python3 with pyyaml (default: auto. If pyyaml is missing, a venv is created in .build/venv)
#
# Result: levelgen/.crawl/<release>/crawl-ref/source/{crawl,util/fake_pty,util/mortuary/catalog}
set -euo pipefail

REL=${1:?usage: build-crawl.sh <release>}
HERE=$(cd "$(dirname "$0")/.." && pwd)
DEST="$HERE/.crawl/$REL"
SRC="$DEST/crawl-ref/source"
REPO=${CRAWL_REPO:-https://github.com/crawl/crawl.git}
JOBS=${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}

log() { printf '[build-crawl %s] %s\n' "$REL" "$*" >&2; }

# 1. Source at the tag (shallow).
if [ ! -d "$DEST/.git" ]; then
  log "cloning $REPO @ $REL"
  mkdir -p "$HERE/.crawl"
  case "$REPO" in
    /*|./*|../*) REPO="file://$(cd "$REPO" && pwd)" ;;
  esac
  git -c advice.detachedHead=false clone --quiet --depth 1 --branch "$REL" "$REPO" "$DEST"
fi
# The submodules the console build needs. pcre isn't needed; luajit is off by default.
# Submodule URLs in .gitmodules are absolute GitHub URLs.
git -C "$DEST" submodule update --init --depth 1 --quiet \
  crawl-ref/source/contrib/lua crawl-ref/source/contrib/sqlite crawl-ref/source/contrib/zlib

# 2. pyyaml: from 0.32 on, mon-data.h and friends are generated from YAML.
if [ -z "${PYTHON:-}" ]; then
  if python3 -c 'import yaml' 2>/dev/null; then
    PYTHON=$(command -v python3)
  else
    if [ ! -x "$HERE/.build/venv/bin/python3" ]; then
      log "creating venv with pyyaml"
      python3 -m venv "$HERE/.build/venv"
      "$HERE/.build/venv/bin/pip" install --quiet pyyaml
    fi
    PYTHON="$HERE/.build/venv/bin/python3"
  fi
fi
export PATH="$(dirname "$PYTHON"):$PATH"

# 3. Game binary + fake_pty (console crawl needs a pty for -script) + des cache.
cd "$SRC"
log "make -j$JOBS (console, release)"
# TODO(levelgen): old tags (< 0.24) may need different flags or a Docker toolchain; not handled yet.
make -j"$JOBS" >"$HERE/.crawl/$REL.build.log" 2>&1 || { tail -40 "$HERE/.crawl/$REL.build.log"; exit 1; }
make util/fake_pty >>"$HERE/.crawl/$REL.build.log" 2>&1
if [ ! -f "$SRC/saves/des/.mortuary-builddb" ] ; then
  log "building des cache"
  ./crawl -builddb >>"$HERE/.crawl/$REL.build.log" 2>&1 || true
  mkdir -p saves/des && touch saves/des/.mortuary-builddb
fi

# 4. Catalog exporter (our own util main, linked against the same objects).
mkdir -p util/mortuary
cp "$HERE/cpp/mortuary-catalog-main.cc" util/mortuary/catalog-main.cc
# The enum-name table comes from the generated mon-data.h. Every live entry starts with "MONS_X, '<glyph>'".
# Axed monsters use AXED_MON(...) and are skipped by this pattern.
grep -E "^[[:space:]]*MONS_[A-Z0-9_]+, '" mon-data.h \
  | sed -E 's/^[[:space:]]*(MONS_[A-Z0-9_]+),.*/{ \1, "\1" },/' > util/mortuary/mortuary-enum-names.h.tmp
if ! cmp -s util/mortuary/mortuary-enum-names.h.tmp util/mortuary/mortuary-enum-names.h 2>/dev/null; then
  mv util/mortuary/mortuary-enum-names.h.tmp util/mortuary/mortuary-enum-names.h
else
  rm util/mortuary/mortuary-enum-names.h.tmp
fi
log "building util/mortuary/catalog"
make -j"$JOBS" -f "$HERE/cpp/mortuary.mk" util/mortuary/catalog >>"$HERE/.crawl/$REL.build.log" 2>&1 \
  || { tail -40 "$HERE/.crawl/$REL.build.log"; exit 1; }

# 5. Sampler script. crawl -script looks in its own scripts/ directory.
cp "$HERE/lua/mortuary_sample.lua" "$SRC/scripts/mortuary_sample.lua"

git -C "$DEST" describe --tags --always > "$DEST/.mortuary-describe"
log "ok: $(cat "$DEST/.mortuary-describe")"
