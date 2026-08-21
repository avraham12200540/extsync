/**
 * GET /ctf/meridian/<id> - where the ledger's proof pointed.
 *
 * The same shape as /ctf/beacon/<id> and /ctf/constellation/<id>, for the
 * same reason: a literal folder would put the answer in this public
 * repository's directory tree, so the segment has to be dynamic, and a
 * dynamic segment's wrong-guess 404 has to be indistinguishable from an
 * undefined route's.
 *
 * `dynamicParams = false` with `generateStaticParams` returning only the one
 * valid id closes that gap: any other id 404s at the routing layer, before
 * this handler ever runs, byte-for-byte the same as a path that was never
 * defined - not the bare, bodyless 404 a Route Handler's own `notFound()`
 * call would give (see ../../beacon/[id]/route.ts for the full account of
 * why, and of the configurations already tried and rejected for restoring
 * an explicit 405 on this shape of route - not re-litigated per stage,
 * since the constraint is Next's, not this route's). `notFound()` below is
 * the same defensive backstop as the earlier two stages, not the actual
 * mechanism. Deliberately GET-only for the same reason: exporting another
 * method flips this route back to dynamic rendering and reopens the
 * bare-404 gap.
 *
 * The id is derivable only by validating the ledger's Merkle proof against
 * its 64 candidates and reading off the winning leaf hash (see
 * ../../ledger/_ledger.ts); nothing the site serves before that names it,
 * and nothing here echoes it back on a miss.
 */

import { notFound } from "next/navigation";

import { MESSAGE_CSS } from "../../_lib/message";
import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";

const MERIDIAN_ID = "4a848281629d1625";

/** Only this id is ever generated; every other id 404s before GET runs. */
export const dynamicParams = false;
export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: MERIDIAN_ID }];
}

const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">MERIDIAN REACHED</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub" lang="he" dir="rtl">המרידיאן אומת. שום דבר מעבר לנקודה הזו עדיין לא נבנה.</p>
    <p class="msg__sub" lang="en" dir="ltr">The meridian was verified. Nothing beyond this point exists yet.</p>
  </div>
</main>`;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (id !== MERIDIAN_ID) {
    notFound();
  }

  return htmlResponse({
    title: "Meridian",
    lang: "en",
    dir: "ltr",
    css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}`,
    body: BODY,
  });
}
