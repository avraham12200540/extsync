/**
 * GET /ctf/archive/<id>/<entry> - the one entry the index lists.
 *
 * Fixed bytes and nothing else: no query, no path parameter, no filesystem
 * read, so there is nothing here to point anywhere it was not meant to go. The
 * folder is named after the entry rather than matching a pattern, which keeps
 * every other name under this archive on the site's ordinary 404.
 *
 * The length and digest the index advertises come from this same buffer (see
 * ../_archive.ts), so what was promised and what arrives are the same object.
 * The response says only how many bytes there are and what to call the file;
 * what they are is left to whoever downloads them.
 */

import { bytesResponse } from "../../../_lib/response";
import { ENTRY_BYTES, ENTRY_MEDIA_TYPE, ENTRY_NAME } from "../_archive";

export function GET(): Response {
  return bytesResponse(ENTRY_BYTES, ENTRY_MEDIA_TYPE, ENTRY_NAME);
}
