/**
 * GET /ctf/archive/<id> - one resource, two representations.
 *
 * Reached by presenting the record's tag to /ctf/receipt. A literal folder
 * again, for the same reason as the transfer destination: any other path under
 * /ctf/archive/ matches no route and gets the site's ordinary 404, so nothing
 * here tells a prober that a right answer exists. The id lives in
 * ../../receipt/_receipt.ts as ARCHIVE_ID, which is what the satisfied receipt
 * hands out. Rename one and you must rename the other.
 *
 * The step is the request, not the page. The document is what a browser gets
 * and it says so, in the one line it prints about itself; ask the same URL for
 * data and it answers with the index that line implies. Nothing points at the
 * second representation: `Vary: Accept` is the only acknowledgement that the
 * response depended on what was asked for, and it is on every answer here,
 * including the refusal. There is no ?format=, no /index.json and no second
 * URL, because a second URL would make this a link to follow rather than a
 * request to compose.
 *
 * Asking for something we do not have is answered honestly with 406 rather
 * than with the page: a player who sent Accept: application/xml learns that the
 * field was read, which is the nudge the step is willing to give.
 */

import { MESSAGE_CSS } from "../../_lib/message";
import { selectRepresentation } from "../../_lib/negotiate";
import { htmlResponse, jsonResponse, textResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";
import { ARCHIVE_ID } from "../../receipt/_receipt";
import {
  ARCHIVE_CSS,
  ENTRY_HREF,
  ENTRY_LENGTH,
  ENTRY_MEDIA_TYPE,
  ENTRY_NAME,
  ENTRY_SHA256,
  GENERATION,
} from "./_archive";

const HTML = "text/html";
const JSON_TYPE = "application/json";

/** Server preference order, which also settles a request that wants both. */
const OFFERS = [HTML, JSON_TYPE] as const;

/** Every answer from this resource carries it, so caches key on the field. */
const VARY = { vary: "Accept" };

/**
 * The two metadata lines are the whole of what the page says about itself: the
 * representation it is, and a generation number that belongs to a later step.
 * A <pre> so the alignment survives without depending on the stylesheet.
 */
const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">ARCHIVE OPEN</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub">The index is available.</p>
    <pre class="msg__meta">representation   ${HTML}
generation       ${GENERATION}</pre>
  </div>
</main>`;

const MANIFEST = {
  archive: ARCHIVE_ID,
  representation: JSON_TYPE,
  generation: GENERATION,
  entries: [
    {
      filename: ENTRY_NAME,
      bytes: ENTRY_LENGTH,
      sha256: ENTRY_SHA256,
      media_type: ENTRY_MEDIA_TYPE,
      href: ENTRY_HREF,
    },
  ],
};

export function GET(request: Request): Response {
  const chosen = selectRepresentation(request.headers.get("accept"), OFFERS);

  if (chosen === JSON_TYPE) {
    return jsonResponse(MANIFEST, { headers: VARY });
  }
  if (chosen === HTML) {
    return htmlResponse(
      {
        title: "Archive",
        lang: "en",
        dir: "ltr",
        css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}\n\n${ARCHIVE_CSS}`,
        body: BODY,
      },
      { headers: VARY },
    );
  }

  return textResponse("not acceptable\n", { status: 406, headers: VARY });
}
