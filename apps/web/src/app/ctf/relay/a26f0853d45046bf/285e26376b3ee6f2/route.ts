/**
 * /ctf/relay/<id>/<hop> - where a 307 from the first stop lands.
 *
 * Another literal folder, for the same reason as its parent: a wrong guess
 * here matches no route and gets the site's ordinary 404.
 *
 * This stop only makes sense if the method and the body survived the previous
 * redirect: it re-checks both, the same way the first stop did. Arriving here
 * by GET - which is what happens if a client "follows" a 307 the way it would
 * follow a 301 or 302 - is refused the same honest way as at the first stop,
 * and arriving by POST with the body dropped is refused for not carrying the
 * acknowledgement forward. Only a POST that kept everything intact is
 * answered with a 303: the redirect that, unlike a 307 or 308, RFC 9110 says
 * to follow with GET regardless of the original method.
 */

import { emptyResponse, jsonResponse, textResponse } from "../../../_lib/response";
import {
  CONTENT_TYPE,
  expectedAck,
  FINAL_HREF,
  hasJsonContentType,
  readValidAck,
  RELAY_ALLOW_HEADERS,
  RELAY_OPTIONS_HEADERS,
} from "../../_relay";

export function GET(): Response {
  return textResponse("method not allowed\n", { status: 405, headers: RELAY_ALLOW_HEADERS });
}

export function OPTIONS(): Response {
  return emptyResponse({ status: 204, headers: RELAY_OPTIONS_HEADERS });
}

export async function POST(request: Request): Promise<Response> {
  if (!hasJsonContentType(request)) {
    return textResponse("unsupported media type\n", {
      status: 415,
      headers: { "accept-post": CONTENT_TYPE },
    });
  }
  if (!(await readValidAck(request))) {
    return jsonResponse({ error: "invalid body", expect: expectedAck() }, { status: 422 });
  }
  return emptyResponse({ status: 303, headers: { location: FINAL_HREF } });
}
