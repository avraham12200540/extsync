/**
 * GET /ctf/record/<id>/<token> - the record's bytes, by the piece.
 *
 * A literal folder again, for the same reason as every other named
 * destination in this trail: the token is not compared here, it *is* the
 * route, so a wrong guess under this record matches no route and gets the
 * site's ordinary 404.
 *
 * An unranged GET answers honestly about its length and its Range support,
 * but not with the real bytes: Accept-Ranges: bytes says a Range request will
 * be honoured, and Content-Length says how long the representation is, and
 * that is the whole of what a plain GET is owed here. Every satisfiable
 * request - however wide, including a suffix or an open range that reaches
 * past the end - is capped at CHUNK_WIDTH real bytes starting from its
 * resolved position: that is a deliberate departure from a compliant static
 * file server, the same way /ctf/receipt deliberately refuses `If-Match: *`,
 * and for the same reason - a single request wide enough to cover the whole
 * resource would answer the step in one line instead of several. The cap is
 * also the one honest way to notice the connection to generation 17 without
 * the page stating it outright: nothing here ever hands back more than 17
 * bytes, no matter what is asked for.
 */

import { resolveByteRange } from "../../../_lib/range";
import { CHUNK_WIDTH, FILLER_BYTES, FRAGMENT_BYTES, TOTAL_LENGTH } from "../_fragment";

const NO_STORE_HEADERS = {
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
} as const;

export function GET(request: Request): Response {
  const resolution = resolveByteRange(request.headers.get("range"), TOTAL_LENGTH);

  if (resolution.kind === "unsatisfiable") {
    return new Response("range not satisfiable\n", {
      status: 416,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "accept-ranges": "bytes",
        "content-range": `bytes */${TOTAL_LENGTH}`,
        ...NO_STORE_HEADERS,
      },
    });
  }

  if (resolution.kind === "satisfiable") {
    const start = resolution.start;
    const end = Math.min(resolution.end, start + CHUNK_WIDTH - 1, TOTAL_LENGTH - 1);
    const slice = FRAGMENT_BYTES.subarray(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: {
        "content-type": "application/octet-stream",
        "content-length": String(slice.byteLength),
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${TOTAL_LENGTH}`,
        ...NO_STORE_HEADERS,
      },
    });
  }

  // Absent, malformed, wrong-unit, reversed or multi-range: all answered the
  // same non-informative way as no Range header at all.
  return new Response(FILLER_BYTES, {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(TOTAL_LENGTH),
      "accept-ranges": "bytes",
      ...NO_STORE_HEADERS,
    },
  });
}
