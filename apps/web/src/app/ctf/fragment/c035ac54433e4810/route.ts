/**
 * GET /ctf/fragment/<id> - where the reconstructed record pointed.
 *
 * A literal folder for the same reason as every other named destination in
 * this trail: the id is not compared here, it *is* the route, so any other id
 * under /ctf/fragment/ matches nothing and gets the site's ordinary 404.
 *
 * The id is carried only inside the reconstructed bytes at
 * /ctf/record/73a2c54841e9/5b99d79daf9f5c99; nothing the site serves before
 * that names it. This resource has more to say than its page does: a Link
 * header points at what comes next, carrying "service" rather than "related"
 * or "alternate" - the one relation in this trail that names a thing to be
 * operated on rather than a document to be read.
 */

import { MESSAGE_CSS } from "../../_lib/message";
import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";
import { RELAY_ID } from "../../relay/_relay";

const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">FRAGMENT ASSEMBLED</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub">Reading this trail has gotten you this far.</p>
    <p class="msg__sub">The next stop wants to know what you can ask of it.</p>
  </div>
</main>`;

export function GET(): Response {
  return htmlResponse(
    {
      title: "Fragment",
      lang: "en",
      dir: "ltr",
      css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}`,
      body: BODY,
    },
    {
      headers: {
        link: `</ctf/relay/${RELAY_ID}>; rel="service"`,
      },
    },
  );
}
