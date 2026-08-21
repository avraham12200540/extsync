/**
 * GET /ctf/beacon/<id> - where the waypoint's PNG metadata pointed.
 *
 * Every earlier destination in this trail is a literal folder precisely so a
 * wrong guess matches no route at all and gets the site's ordinary 404. That
 * trick is not available here: the folder name would then be the answer
 * itself, sitting in this public repository's directory tree for anyone to
 * read without ever touching the PNG. So this is the one stop that compares
 * a dynamic segment - and the comparison has to answer a wrong guess exactly
 * the way an undefined route would.
 *
 * A Route Handler that calls `notFound()` itself does NOT get there: Route
 * Handlers sit outside the page-rendering tree, so `notFound()` from inside
 * one only sets a bare 404 status with no body - verified locally, and
 * trivially distinguishable from the site's real not-found page. What
 * actually closes that gap is `dynamicParams = false` with
 * `generateStaticParams` returning only the one valid id: Next then treats
 * any other id as a route that was never generated and answers it at the
 * routing layer, before this handler ever runs, the same way a path with no
 * matching file at all is answered. The `notFound()` call below is a
 * defensive backstop only, for the case this file's static-generation
 * config is ever changed without the check being noticed.
 *
 * Deliberately GET-only. Exporting POST/PUT/DELETE/PATCH (even just to
 * answer 405) - or even a single OPTIONS export, with or without
 * `dynamic = "force-static"` alongside it - was tried and, in every case,
 * flips this route from prerendered (build output "●") to server-rendered
 * on demand ("ƒ"). Once that happens, `dynamicParams` no longer 404s an
 * unlisted id at the routing layer; the wrong-id request reaches `GET`,
 * which calls `notFound()`, which is back to the bare, bodyless 404 this
 * file exists to avoid (confirmed: 0 bytes vs ~21.9 KB for a real
 * unmatched route, in all three variants tried). Next.js does not appear to
 * offer a per-method static/dynamic split within one Route Handler file, so
 * true 404 parity and an explicit non-GET 405 cannot both be had here -
 * parity was kept, since a wrong guess disclosing nothing is the puzzle's
 * hard requirement, and a non-GET request is not part of the intended path.
 *
 * The id is carried only inside the three text chunks of the waypoint's PNG
 * (see ../../waypoint/7d8d6cddb49b49d6/_artifact.ts); nothing the site
 * serves before that names it, and nothing here echoes it back on a miss.
 */

import { notFound } from "next/navigation";

import { MESSAGE_CSS } from "../../_lib/message";
import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";

const BEACON_ID = "4f6c8a219e7d3b50";

/** Only this id is ever generated; every other id 404s before GET runs. */
export const dynamicParams = false;
export function generateStaticParams(): Array<{ id: string }> {
  return [{ id: BEACON_ID }];
}

const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">BEACON RECONSTRUCTED</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub" lang="he" dir="rtl">האות שוחזר. שום דבר מעבר לנקודה הזו עדיין לא נבנה.</p>
    <p class="msg__sub" lang="en" dir="ltr">The beacon was reconstructed. Nothing beyond this point exists yet.</p>
  </div>
</main>`;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  if (id !== BEACON_ID) {
    notFound();
  }

  return htmlResponse({
    title: "Beacon",
    lang: "en",
    dir: "ltr",
    css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}`,
    body: BODY,
  });
}
