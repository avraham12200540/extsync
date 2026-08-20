/**
 * /ctf/relay/<id> - the relay's first stop.
 *
 * A literal folder for the same reason as every other named destination in
 * this trail: the id is not compared here, it *is* the route, so any other id
 * under /ctf/relay/ matches nothing and gets the site's ordinary 404.
 *
 * GET is answered honestly and only that: 405, with an Allow header that
 * lists what this stop actually accepts. OPTIONS adds the one thing Allow
 * does not say - the media type a POST here must carry, via the Accept-Post
 * header. A POST that meets both requirements, and echoes this stop's own id
 * back as JSON, is answered with a 307: the redirect that RFC 9110 requires a
 * client to repeat with the same method and body, unlike a 301, 302 or 303.
 */

import { emptyResponse, jsonResponse, textResponse } from "../../_lib/response";
import {
  CONTENT_TYPE,
  expectedAck,
  hasJsonContentType,
  HOP_HREF,
  readValidAck,
  RELAY_ALLOW_HEADERS,
  RELAY_OPTIONS_HEADERS,
} from "../_relay";

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
  return emptyResponse({ status: 307, headers: { location: HOP_HREF } });
}
