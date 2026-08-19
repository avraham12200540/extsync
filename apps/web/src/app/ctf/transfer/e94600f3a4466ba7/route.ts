/**
 * GET /ctf/transfer/<token> - where the record actually went.
 *
 * The token is the folder name rather than a `[token]` segment with a
 * comparison inside, and that is the point: any other path under
 * /ctf/transfer/ matches no route at all, so a wrong guess gets the site's
 * ordinary 404 page, byte for byte identical to a path that never existed. A
 * dynamic segment calling `notFound()` would answer with an empty 404 instead,
 * and that difference alone would tell a prober that something real lives here.
 *
 * Keep the folder name equal to TOKEN in ../_record.ts: that constant is what
 * the transfer page hands to the clipboard, and the two have to agree.
 */

import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";
import { RECORD_CSS } from "../_record";

const PAGE_CSS = `
.done__wrap {
  width: 100%;
  max-width: 32rem;
  text-align: center;
}
`.trim();

const BODY = `<main class="ctf-view">
  <div class="done__wrap">
    <h1 class="done">TRANSFER COMPLETE</h1>
    <div class="done__line" aria-hidden="true"></div>
    <p class="done__sub">The record arrived intact.</p>
  </div>
</main>`;

export function GET(): Response {
  return htmlResponse({
    title: "Transfer complete",
    lang: "en",
    dir: "ltr",
    css: `${CTF_BASE_CSS}\n\n${RECORD_CSS}\n\n${PAGE_CSS}`,
    body: BODY,
  });
}
