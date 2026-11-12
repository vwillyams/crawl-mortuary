// SPDX-License-Identifier: AGPL-3.0-or-later
import path from "node:path";
import type { NextConfig } from "next";

// Fully static export (plan D9): `next build` writes plain files to out/, servable by any static host.
const config: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ["@mortuary/contract"],
  // The contract package lives outside web/ (linked), so let the bundler see the repo root.
  turbopack: { root: path.join(import.meta.dirname, "..") },
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
};

export default config;
