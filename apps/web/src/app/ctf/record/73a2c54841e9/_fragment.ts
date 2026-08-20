/**
 * Data for the fragment step.
 *
 * The record at /ctf/record/73a2c54841e9 no longer says the entry is complete:
 * it says the record itself did not survive transfer whole, and that the
 * archive's generation number is relevant again. What that number is relevant
 * to is CHUNK_WIDTH below - imported from the archive step rather than
 * repeated as a second literal 17, so the two can never quietly drift apart.
 *
 * The raw resource's bytes live here as a string rather than a file read, for
 * the same reason the archive entry's bytes are inlined: the route that serves
 * them, and the total length it advertises, are both derived from this one
 * buffer.
 */

import { GENERATION } from "../../archive/7a2d1abf38/_archive";

/** The width of one servable slice. Not redeclared - borrowed from the step
 *  that already put this number on the page once. */
export const CHUNK_WIDTH = GENERATION;

/**
 * The raw resource's name, which is also the name of the folder that serves
 * it, so a wrong guess under this record matches no route and gets the site's
 * ordinary 404. Rename one and you must rename the other.
 */
export const RAW_TOKEN = "5b99d79daf9f5c99";

export const RAW_HREF = `/ctf/record/73a2c54841e9/${RAW_TOKEN}`;

/** Handed out only by a correctly reconstructed fragment. */
export const NEXT_ID = "c035ac54433e4810";

const FRAGMENT_TEXT =
  "fragment ok\n" +
  "chunk    17\n" +
  "total    68\n" +
  `target   ${NEXT_ID}\n` +
  "done.\n";

/** Fixed bytes, encoded once at module load. */
export const FRAGMENT_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(Buffer.from(FRAGMENT_TEXT, "utf8"));

/** Derived from FRAGMENT_BYTES, never written down separately. */
export const TOTAL_LENGTH = FRAGMENT_BYTES.byteLength;

/**
 * What an unranged GET gets instead of the real bytes: the same length, so
 * Content-Length and the "68 bytes" the record page already states agree, but
 * no information about the real content. A single repeated byte rather than
 * words, so it cannot itself be misread as a second clue.
 */
export const FILLER_BYTES: Uint8Array<ArrayBuffer> = new Uint8Array(TOTAL_LENGTH).fill(0x2e);
