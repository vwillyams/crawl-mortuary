// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Server-rendered one-line summary (default series). It is also in the page's meta description.
 * It is shown only without JS: with JS, the interactive table below carries the same information.
 */
export function Summary({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <noscript>
      <p className="sub">{text}</p>
    </noscript>
  );
}
