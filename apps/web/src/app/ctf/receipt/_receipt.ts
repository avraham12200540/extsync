/**
 * The validator step.
 *
 * /ctf/transfer/<token> hands out an entity-tag with the response and says, in
 * the page text, that the record was verified against the value it was sent
 * with. /ctf/receipt then refuses to answer unless that same value comes back
 * as a precondition. The whole step lives in HTTP: no JavaScript, and nothing
 * in either document body carries the tag.
 *
 * These values exist only for the puzzle. The tag is not a real validator for
 * any representation and is never used for caching, which is also why the
 * pages stay `no-store`: the browser should not resolve any part of this on
 * its own.
 */

/** Where the transfer response points, via a Link header. */
export const RECEIPT_PATH = "/ctf/receipt";

/** A quoted entity-tag, stored with its quotes so header and comparison agree. */
export const RECORD_ETAG = '"e0d5177f7c79"';

/** Handed out by a satisfied receipt; the folder that serves the next step. */
export const ARCHIVE_ID = "7a2d1abf38";

/**
 * Strong comparison against the step's tag.
 *
 * RFC 9110 allows a list of entity-tags, so a list is accepted and any exact
 * member satisfies it. Two deliberate departures: a weak tag (`W/"..."`) never
 * matches, which is what strong comparison requires anyway, and `*` is refused
 * even though the spec would have it match any existing representation. The
 * point of this endpoint is to present the value that arrived with the record,
 * and a wildcard would skip exactly the step being asked for.
 */
export function ifMatchSatisfied(headerValue: string | null): boolean {
  if (!headerValue) return false;
  return headerValue.split(",").some((candidate) => candidate.trim() === RECORD_ETAG);
}
