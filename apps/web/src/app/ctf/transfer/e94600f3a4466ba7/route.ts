/**
 * GET /ctf/transfer/<token> - where the record went, and the step that starts there.
 *
 * The document says the record was verified against the value it was sent
 * with, and then does not contain that value: it travels in the response, as
 * an entity-tag, next to a Link header naming the resource that wants it back.
 * Reading the page is not enough; reading the response is.
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

import { MESSAGE_CSS } from "../../_lib/message";
import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";
import { RECEIPT_PATH, RECORD_ETAG } from "../../receipt/_receipt";

const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">TRANSFER COMPLETE</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub">The record arrived intact.</p>
    <p class="msg__sub">Verified against the value it was sent with.</p>
  </div>
</main>`;

export function GET(): Response {
  return htmlResponse(
    {
      title: "Transfer complete",
      lang: "en",
      dir: "ltr",
      css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}`,
      body: BODY,
    },
    {
      headers: {
        // The value the page refers to and does not print. `no-store` stays as
        // it is on every CTF page: this tag is the puzzle's, not the cache's,
        // and the browser should not resolve any part of the step by itself.
        etag: RECORD_ETAG,
        link: `<${RECEIPT_PATH}>; rel="related"`,
      },
    },
  );
}
