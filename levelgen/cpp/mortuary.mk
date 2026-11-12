# SPDX-License-Identifier: AGPL-3.0-or-later
# Extra make targets, layered on crawl's own Makefile. Usage, from crawl-ref/source:
#   make -f <levelgen>/cpp/mortuary.mk util/mortuary/catalog
# This mirrors crawl's util/monster/monster target: the same objects, with a different main.
include Makefile

MORTUARY_CATALOG_OBJS = $(OBJECTS) util/mortuary/catalog-main.o $(EXTRA_OBJECTS)

util/mortuary/catalog-main.o: util/mortuary/catalog-main.cc util/mortuary/mortuary-enum-names.h | $(GENERATED_HEADERS)
	$(QUIET_CXX)$(CXX) $(STDFLAG) $(ALL_CFLAGS) -Iutil/mortuary -c $< -o $@

util/mortuary/catalog: $(MORTUARY_CATALOG_OBJS) $(CONTRIB_LIBS)
	+$(QUIET_LINK)$(CXX) $(LDFLAGS) $(MORTUARY_CATALOG_OBJS) -o $@ $(LIBS)
