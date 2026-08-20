/**
 * GET /ctf/record/<id> - where the archive's entry pointed.
 *
 * A literal folder for the same reason as every other named destination in this
 * trail: the id is not compared here, it *is* the route, so any other id under
 * /ctf/record/ matches nothing and gets the site's ordinary 404 - byte for byte
 * what a path that never existed returns. A dynamic segment calling notFound()
 * would answer with a different 404 and tell a prober that something real lives
 * here.
 *
 * The id is carried only by the archive entry; nothing the site serves before
 * that names it. The record is no longer complete: it says so, states the one
 * fact a reconstruction needs (a fixed total length), and points at the raw
 * resource via a Link header rather than a link in the text - the same
 * carrier the transfer step already used to point at the receipt.
 */

import { MESSAGE_CSS } from "../../_lib/message";
import { htmlResponse } from "../../_lib/response";
import { CTF_BASE_CSS } from "../../_lib/theme";
import { RAW_HREF } from "./_fragment";

const BODY = `<main class="ctf-view">
  <div class="msg">
    <h1 class="msg__title">RECORD FOUND</h1>
    <div class="msg__line" aria-hidden="true"></div>
    <p class="msg__sub">The record did not survive transfer whole.</p>
    <p class="msg__sub">68 bytes were logged. Generation 17, again.</p>
  </div>
</main>`;

export function GET(): Response {
  return htmlResponse(
    {
      title: "Record",
      lang: "en",
      dir: "ltr",
      css: `${CTF_BASE_CSS}\n\n${MESSAGE_CSS}`,
      body: BODY,
    },
    {
      headers: {
        link: `<${RAW_HREF}>; rel="alternate"; type="application/octet-stream"`,
      },
    },
  );
}
