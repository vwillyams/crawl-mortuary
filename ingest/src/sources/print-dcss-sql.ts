// SPDX-License-Identifier: AGPL-3.0-or-later
// Prints the dcss-stats export query for a series, for use in a psql one-liner.
import { dcssStatsSqlFor } from "./dcss-stats.ts";
process.stdout.write(dcssStatsSqlFor(process.argv[2] ?? "0.34"));
