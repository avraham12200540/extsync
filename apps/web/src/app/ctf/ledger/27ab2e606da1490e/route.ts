/**
 * GET /ctf/ledger/<id> - the constellation's ledger and proof.
 *
 * A literal folder for the same reason as every other named destination in
 * this trail: the id is not compared here, it *is* the route, so any other
 * name under /ctf/ledger/ matches no route and gets the site's ordinary 404.
 *
 * Fixed JSON and nothing else: no query, no negotiation, always the same
 * body (see ../_ledger.ts). Every method is explicit for the same reason as
 * the package route (../../package/2e954a825644f9ff/route.ts): once any
 * method beyond GET needs a real answer, Next's own OPTIONS synthesis lists
 * every exported method name, not just the ones actually accepted, so
 * writing GET, HEAD and OPTIONS out by hand keeps this file's `Allow` header
 * honest instead of leaving it to drift.
 */

import { emptyResponse, jsonResponse, textResponse } from "../../_lib/response";
import { LEDGER_BODY } from "../_ledger";

const ALLOW = "GET, HEAD, OPTIONS";
const SERIALIZED_BODY = `${JSON.stringify(LEDGER_BODY, null, 2)}\n`;
const BODY_BYTE_LENGTH = Buffer.byteLength(SERIALIZED_BODY, "utf8");

export function GET(): Response {
  return jsonResponse(LEDGER_BODY);
}

/** Same representation headers GET would send - including the real
 *  Content-Length - with no body, per RFC 9110 SS9.3.2. */
export function HEAD(): Response {
  return emptyResponse({
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-length": String(BODY_BYTE_LENGTH),
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
