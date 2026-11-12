// SPDX-License-Identifier: AGPL-3.0-or-later
"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type ComponentProps } from "react";

function VLinkInner({ href, ...rest }: ComponentProps<typeof Link> & { href: string }) {
  const v = useSearchParams().get("v");
  return <Link href={v ? `${href}?v=${encodeURIComponent(v)}` : href} {...rest} />;
}

/** A Link that carries the current `?v=` across navigation. */
export function VLink(props: ComponentProps<typeof Link> & { href: string }) {
  return (
    <Suspense fallback={<Link {...props} />}>
      <VLinkInner {...props} />
    </Suspense>
  );
}
