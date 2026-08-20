/**
 * /ctf/relay/<id>/<hop>/<final> - where a 303 from the hop lands.
 *
 * The last literal folder in the chain: a wrong guess here, like everywhere
 * else in this trail, matches no route and gets the site's ordinary 404.
 *
 * A 303 is specifically "see other" - RFC 9110 has the follow-up be GET no
 * matter what the original request was, and carry no body. So that is the
 * whole of what this stop answers to: GET gets the representation, and
 * anything that arrives as POST - which only happens if a client forced the
 * method past the 303 instead of letting it change - is refused the same
 * honest way as a GET was refused earlier in the chain.
 */

import { emptyResponse, textResponse } from "../../../../_lib/response";
import { NEXT_ID } from "../../../_relay";

const ALLOW = "GET, OPTIONS";

const BODY = "relay    ok\n" + "target   " + NEXT_ID + "\n" + "done.\n";

export function GET(): Response {
  return textResponse(BODY);
}

export function OPTIONS(): Response {
  return emptyResponse({ status: 204, headers: { allow: ALLOW } });
}

export function POST(): Response {
  return textResponse("method not allowed\n", { status: 405, headers: { allow: ALLOW } });
}
