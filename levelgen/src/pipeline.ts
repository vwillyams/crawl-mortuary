// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * build → catalog → sample → aggregate for one release.
 *
 *   pnpm run pipeline -- --release 0.34.1 [--seeds 300] [--jobs N] [--skip-build]
 *   pnpm run pipeline -- --release 0.34.1 --seeds 10000     # full run (~35 min on 16 cores)
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { aggregate } from "./aggregate.ts";
import { buildCatalog } from "./catalog.ts";
import { LEVELGEN, catalogPath, levelgenPath, parseArgs } from "./common.ts";
import { sample } from "./run.ts";

const args = parseArgs();
const write = (p: string, s: string) => {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, s);
};
const step = async (name: string, f: () => unknown) => {
  const t0 = Date.now();
  console.log(`== ${name}`);
  await f();
  console.log(`== ${name}: ${((Date.now() - t0) / 1000).toFixed(1)} s`);
};

await step("build", () => {
  if (args.skipBuild) return;
  const r = spawnSync("bash", [join(LEVELGEN, "scripts", "build-crawl.sh"), args.release], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("build-crawl.sh failed");
});
await step("catalog", () => write(catalogPath(args.release), JSON.stringify(buildCatalog(args.release), null, 1) + "\n"));
await step("sample", () => sample(args));
await step("aggregate", () => write(levelgenPath(args.release), JSON.stringify(aggregate(args.release)) + "\n"));
