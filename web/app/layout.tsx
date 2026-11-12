// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Metadata } from "next";
import Link from "next/link";
import { VersionPicker } from "@/components/VersionPicker";
import { getMeta } from "@/lib/data";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Crawl Mortuary", template: "%s · Crawl Mortuary" },
  description: "How deadly is each monster on each floor of Dungeon Crawl Stone Soup?",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const meta = getMeta();
  const ctx = { available: meta.series.map((s) => s.series), defaultSeries: meta.defaultSeries };
  return (
    <html lang="en">
      <body>
        <header className="site">
          <div className="wrap">
            <Link href="/" className="brand">
              Crawl Mortuary
            </Link>
            <nav>
              <Link href="/">Dungeon</Link>
              <Link href="/monsters/">Monsters</Link>
              <Link href="/about/">About</Link>
            </nav>
            <VersionPicker ctx={ctx} />
          </div>
        </header>
        <main className="wrap">{children}</main>
        <footer className="site">
          <div className="wrap">
            Data: public DCSS game records ({meta.dataSource.aggregate}) and level-generation sampling. Code licensed
            AGPL-3.0-or-later. Not affiliated with the DCSS dev team. <Link href="/about/">Methodology</Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
