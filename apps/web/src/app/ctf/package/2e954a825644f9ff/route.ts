/**
 * GET /ctf/package/<id> - the beacon's enclosure.
 *
 * A literal folder for the same reason as every other named destination in
 * this trail: the id is not compared here, it *is* the route, so any other
 * name under /ctf/package/ matches no route and gets the site's ordinary
 * 404.
 *
 * Fixed bytes and nothing else: no query, no negotiation, always the same
 * `multipart/related` representation (see ../_package.ts).
 *
 * Every method below is explicit, not a mix of automatic and hand-written.
 * Tested before touching this file: with only GET exported, Next already
 * synthesizes a correct HEAD (same headers as GET, zero body bytes on the
 * wire - `curl -X HEAD` looked otherwise, but that is a curl quirk from
 * overriding the method manually rather than using `-I`; a low-level
 * `http.client` read confirmed zero bytes) and a correct OPTIONS (204,
 * `Allow: GET, HEAD, OPTIONS`) - but POST/PUT/PATCH/DELETE fell through to
 * Next's bare 405, with no `Allow` and none of this trail's no-store/noindex
 * headers. Adding POST/PUT/PATCH/DELETE to fix that changed what Next's own
 * OPTIONS synthesis reports: it lists every exported method name, so it
 * started answering `Allow: DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT` -
 * accurate about this file's exports, wrong about what the resource accepts.
 * Confirmed by testing both before and after. Writing GET, HEAD and OPTIONS
 * out by hand removes that inconsistency instead of leaving two automatic
 * behaviors to drift against four explicit ones.
 */

import { emptyResponse, multipartResponse, textResponse } from "../../_lib/response";
import { CONTENT_TYPE, PACKAGE_BYTES } from "../_package";

const ALLOW = "GET, HEAD, OPTIONS";

export function GET(): Response {
  return multipartResponse(PACKAGE_BYTES, CONTENT_TYPE);
}

/** Same representation headers GET would send - including the real
 *  Content-Length - with no body, per RFC 9110 SS9.3.2. */
export function HEAD(): Response {
  return emptyResponse({
    headers: {
      "content-type": CONTENT_TYPE,
      "content-length": String(PACKAGE_BYTES.byteLength),
    },
  });
}

export function OPTIONS(): Response {
  return emptyResponse({ status: 204, headers: { allow: ALLOW } });
}

function methodNotAllowed(): Response {
  return textResponse("method not allowed\n", { status: 405, headers: { allow: ALLOW } });
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
