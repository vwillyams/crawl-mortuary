// SPDX-License-Identifier: AGPL-3.0-or-later
import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1>You fall through a shaft…</h1>
      <p>
        That page doesn&apos;t exist. <Link href="/">Back to the dungeon</Link>.
      </p>
    </>
  );
}
