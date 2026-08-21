/**
 * GET /ctf/constellation/<id> - where the package's manifest pointed.
 *
 * The same shape as /ctf/beacon/<id>, for the same reason: a literal folder
 * would put the answer in this public repository's directory tree, so the
 * segment has to be dynamic, and a dynamic segment's wrong-guess 404 has to
 * be indistinguishable from an undefined route's.
 *
 * `dynamicParams = false` with `generateStaticParams` returning only the one
 * valid id closes that gap: any other id 404s at the routing layer, before
 * this handler ever runs, byte-for-byte the same as a path that was never
 * defined - not the bare, bodyless 404 a Route Handler's own `notFound()`
 * call would give (see ../../beacon/[id]/route.ts for why, and for the three
 * configurations already tried and rejected for restoring an explicit 405 on
 * this shape of route). `notFound()` below is the same defensive backstop as
 * there, not the actual mechanism. Deliberately GET-only for the same
 * reason: exporting another method flips this route back to dynamic
 * rendering and reopens the bare-404 gap, confirmed the same way as before -
 * not re-litigated per stage, since the constraint is Next's, not this
 * route's.
 *
 * The id is carried only inside the package's decoded fragments (see
 * ../../package/_package.ts); nothing the site serves before that names it,
 * and nothing here echoes it back on a miss.
 */

import { notFound } from "next/navigation";

import { MESSAGE_CSS } from "../../_lib/message";
import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";

const CONSTELLATION_ID = "b71f02c984d63ae5";

/** Only this id is ever generated; every other id 404s before GET runs. */
export const dynamicParams = false;
export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: CONSTELLATION_ID }];
}

const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">CONSTELLATION ASSEMBLED</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub" lang="he" dir="rtl">הקבוצה הורכבה. שום דבר מעבר לנקודה הזו עדיין לא נבנה.</p>
    <p class="msg__sub" lang="en" dir="ltr">The constellation was assembled. Nothing beyond this point exists yet.</p>
  </div>
</main>`;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (id !== CONSTELLATION_ID) {
    notFound();
  }

  return htmlResponse({
    title: "Constellation",
    lang: "en",
    dir: "ltr",
    css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}`,
    body: BODY,
  });
}
