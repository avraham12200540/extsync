/**
 * GET /ctf/archive/<id> - reached by presenting the record's tag to /ctf/receipt.
 *
 * A literal folder again, for the same reason as the transfer destination: any
 * other path under /ctf/archive/ matches no route and gets the site's ordinary
 * 404, so nothing here tells a prober that a right answer exists.
 *
 * The id lives in ../../receipt/_receipt.ts as ARCHIVE_ID, which is what the
 * satisfied receipt hands out. Rename one and you must rename the other.
 *
 * Nothing beyond this point is built yet.
 */

import { MESSAGE_CSS } from "../../_lib/message";
import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";

const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">ARCHIVE OPEN</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub">The index is available.</p>
  </div>
</main>`;

export function GET(): Response {
  return htmlResponse({
    title: "Archive",
    lang: "en",
    dir: "ltr",
    css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}`,
    body: BODY,
  });
}
